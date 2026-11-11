const poiService = require('../../services/poi')
const tripService = require('../../services/trip')
const notifyService = require('../../services/notify')
const conflict = require('../../utils/conflict')
const { requestReminder } = require('../../utils/subscribe')
const { dateRangeText, durationText, timeToMin, minToTime, addDays, parseDate, moneyText } = require('../../utils/format')
const { DEFAULT_START, BUFFER_MIN, MESSAGE_TEMPLATES } = require('../../utils/constants')

const app = getApp()

const FACT_LABELS = [
  { key: 'open', label: '营业时间' },
  { key: 'reserve', label: '预约' },
  { key: 'fee', label: '费用' }
]

const STATUS_TEXT = { planning: '规划中', ongoing: '进行中', ended: '已结束' }

function dayLabel(day) {
  const date = parseDate(day.date)
  const short = date ? date.getMonth() + 1 + '/' + date.getDate() : ''
  return 'D' + (day.index + 1) + ' ' + short
}

// 展示字段只在页面算一次，WXML 里不做运算
function enrich(poi) {
  const facts = poi.facts || {}
  return Object.assign({}, poi, {
    durationText: durationText(poi.durationMin),
    factsList: FACT_LABELS.filter(function (item) {
      return facts[item.key]
    }).map(function (item) {
      return { key: item.key, label: item.label, value: facts[item.key] }
    })
  })
}

Page({
  data: {
    tripId: '',
    loading: true,
    error: '',
    trip: null,
    tabs: [],
    activeDay: 0,
    pois: [],
    dayPois: [],
    editing: false,
    canRemoveLastDay: false,
    memberCount: 1,
    isOwner: false,
    // 只读预览：游客或非成员打开分享的行程，能看到地点和时间轴，但不能改
    readonly: false
  },

  onLoad(query) {
    this.setData({ tripId: query.id || '' })
  },

  onShow() {
    if (this.data.tripId) this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  async load() {
    try {
      const res = await poiService.list(this.data.tripId)
      this.setData({ readonly: !!res.preview })
      this.apply(res.trip, res.items || [])
      this.setData({ loading: false, error: '' })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  // 只读模式下的写操作统一拦在这里：不强制跳转，弹窗说明并引导登录
  guardWrite() {
    if (!this.data.readonly) return true
    if (app.isLogin()) {
      wx.showModal({
        title: '只读预览',
        content: '这是别人分享的行程，加入后才能编辑。',
        showCancel: false
      })
      return false
    }
    app.checkLogin({ modal: { title: '需要登录', content: '需要登录才能编辑行程，是否前往登录？' } })
    return false
  },

  onRetry() {
    this.load()
  },

  // 创建者转发 = 邀请（点开直接加入）；成员转发仍是占位，不扩人
  onShareAppMessage() {
    const trip = this.data.trip
    if (!trip) {
      return { title: '用「旅行计划」把每天的路排清楚', path: '/pages/trips/list' }
    }
    return {
      title: this.data.isOwner ? '一起排「' + trip.title + '」的行程' : '我在排「' + trip.title + '」的行程',
      path: this.data.isOwner ? '/pages/trips/join?id=' + trip._id : '/pages/trips/list'
    }
  },

  apply(trip, pois) {
    const items = (pois || []).map(enrich)
    // day-tabs 需要 { index, label }，不能只传字符串
    const tabs = (trip.days || []).map(function (day) {
      return { index: day.index, label: dayLabel(day) }
    })
    let activeDay = Number(this.data.activeDay)
    if (!isFinite(activeDay) || activeDay < 0 || activeDay >= tabs.length) activeDay = 0

    // 只有最后一天空着才允许减，避免把已有地点悬空成孤儿数据
    const lastIndex = tabs.length - 1
    const canRemoveLastDay = tabs.length > 1 && !items.some(function (poi) {
      return poi.dayIndex === lastIndex
    })

    this.setData({
      trip: Object.assign({}, trip, {
        dateText: dateRangeText(trip.startDate, trip.endDate)
      }),
      tabs: tabs,
      activeDay: activeDay,
      canRemoveLastDay: canRemoveLastDay,
      memberCount: Math.max(1, (trip.members || []).length),
      isOwner: (trip.myRole || (this.data.trip && this.data.trip.myRole)) === 'owner',
      // 预算只存不用是不诚实的，详情页至少要把数字摆出来
      budgetText: Number(trip.budgetCents) ? moneyText(trip.budgetCents) : '',
      statusText: STATUS_TEXT[trip.status] || '规划中',
      statusAction: trip.status === 'ended' ? '重新打开这趟' : '标记为已结束',
      pois: items,
      dayPois: items.filter(function (poi) {
        return poi.dayIndex === activeDay
      })
    })
  },

  onDayChange(e) {
    const index = Number(e.detail.index) || 0
    this.setData({
      activeDay: index,
      editing: false,
      dayPois: this.data.pois.filter(function (poi) {
        return poi.dayIndex === index
      })
    })
  },

  onAdd() {
    if (!this.guardWrite()) return
    const list = this.data.dayPois
    const last = list[list.length - 1]
    let time = DEFAULT_START

    // 默认时间 = 上一站开始 + 停留 + 赶路缓冲，省掉每次手填
    if (last) {
      const start = timeToMin(last.plannedTime)
      const base = start === null ? timeToMin(DEFAULT_START) : start
      time = minToTime(base + (last.durationMin || 60) + BUFFER_MIN)
    }

    wx.navigateTo({
      url: '/pages/poi/edit?tripId=' + this.data.tripId + '&day=' + this.data.activeDay + '&time=' + time
    })
  },

  onOpenMap() {
    wx.navigateTo({
      url: '/pages/trip/map?tripId=' + this.data.tripId + '&day=' + this.data.activeDay
    })
  },

  onOpenInvite() {
    if (!this.guardWrite()) return
    wx.navigateTo({
      url: '/pages/trips/invite?id=' + this.data.tripId
    })
  },

  onEditPoi(e) {
    wx.navigateTo({
      url: '/pages/poi/edit?tripId=' + this.data.tripId + '&day=' + this.data.activeDay + '&poiId=' + e.detail.id
    })
  },

  // 编辑复用新建页，带 id 进去就是编辑模式
  onEditTrip() {
    if (!this.guardWrite()) return
    wx.navigateTo({
      url: '/pages/trips/create?id=' + this.data.tripId
    })
  },

  onOpenJournal() {
    if (!this.guardWrite()) return
    wx.navigateTo({
      url: '/pages/trip/journal?tripId=' + this.data.tripId
    })
  },

  // 订阅消息一次授权只换一条推送：先申请授权，再把模板 id 记到行程上
  async onRemind() {
    const trip = this.data.trip
    if (!trip) return
    if (!this.guardWrite()) return

    const result = await requestReminder()
    if (result === 'missing') return
    if (result !== 'accept') {
      wx.showToast({ title: '没有开启提醒', icon: 'none' })
      return
    }

    try {
      await notifyService.subscribe(trip._id, MESSAGE_TEMPLATES.tripReminder)
      wx.showToast({ title: '出发前一天 20:00 提醒你', icon: 'none' })
    } catch (err) {
      // run() 已经提示错误，这里不再重复
    }
  },

  // 复制：日期从今天重新起算，点位整份搬过去，同行的人不跟过来
  onCopyTrip() {
    const trip = this.data.trip
    if (!trip) return
    if (!this.guardWrite()) return
    const that = this

    wx.showModal({
      title: '复制这趟行程？',
      content: '日期从今天重新起算，地点会整份搬过去；同行的人不会跟到新行程。',
      confirmText: '复制',
      success: async function (res) {
        if (!res.confirm) return
        try {
          const out = await tripService.copy(trip._id)
          wx.redirectTo({ url: '/pages/trip/detail?id=' + out.trip._id })
        } catch (err) {
          that.load()
        }
      }
    })
  },

  onToggleEdit() {
    if (!this.guardWrite()) return
    this.setData({ editing: !this.data.editing })
  },

  // 「待核实」是给自己看的提醒：点一下表示现场已经确认过
  async onToggleFacts(e) {
    const that = this
    const id = e.detail.id
    if (!that.guardWrite()) return

    const submit = async function () {
      const poi = that.data.pois.filter(function (item) {
        return item._id === id
      })[0]
      if (!poi) return
      try {
        await poiService.save(
          that.data.tripId,
          Object.assign({}, poi, { factsPending: !poi.factsPending }),
          that.data.trip.version
        )
        await that.load()
      } catch (err) {
        // 冲突时让用户选：刷新放弃本次，或用最新版本重试一次；其它错误 run() 已提示
        conflict.handle(err, that, submit)
      }
    }

    submit()
  },

  onUp(e) {
    this.move(e.detail.id, -1)
  },

  onDown(e) {
    this.move(e.detail.id, 1)
  },

  async move(id, delta) {
    const list = this.data.dayPois.slice()
    let index = -1
    list.forEach(function (item, i) {
      if (item._id === id) index = i
    })
    const target = index + delta
    if (index < 0 || target < 0 || target >= list.length) return

    const tmp = list[index]
    list[index] = list[target]
    list[target] = tmp
    await this.commit(list)
  },

  // 先本地生效再提交，弱网下也能立刻看到结果
  async commit(dayList) {
    if (!this.guardWrite()) return
    const activeDay = this.data.activeDay
    const merged = this.data.pois
      .filter(function (poi) {
        return poi.dayIndex !== activeDay
      })
      .concat(dayList)
      .sort(function (a, b) {
        return a.dayIndex - b.dayIndex
      })

    this.setData({ pois: merged, dayPois: dayList })

    try {
      await poiService.reorder(
        this.data.tripId,
        merged.map(function (poi) {
          return { _id: poi._id, dayIndex: poi.dayIndex, plannedTime: poi.plannedTime }
        }),
        this.data.trip.version
      )
      await this.load()
    } catch (err) {
      const that = this
      if (!conflict.handle(err, that, function () { that.commit(dayList) })) {
        await this.load()
      }
    }
  },

  // 按顺序把时间重排：09:00 起，每站 = 停留时长 + 30 分钟缓冲
  onReschedule() {
    if (!this.data.dayPois.length) return
    if (!this.guardWrite()) return
    let cursor = timeToMin(DEFAULT_START)
    const next = this.data.dayPois.map(function (poi) {
      const item = Object.assign({}, poi, { plannedTime: minToTime(cursor) })
      cursor += (poi.durationMin || 60) + BUFFER_MIN
      return item
    })
    this.commit(next)
  },

  onRemovePoi(e) {
    const that = this
    const id = e.detail.id
    if (!that.guardWrite()) return

    const submit = async function () {
      try {
        await poiService.remove(that.data.tripId, id, that.data.trip.version)
        await that.load()
        wx.showToast({ title: '已删除', icon: 'none' })
      } catch (err) {
        conflict.handle(err, that, submit)
      }
    }

    wx.showModal({
      title: '删除这个地点？',
      content: '删除后可以重新添加，其它地点不受影响。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: function (res) {
        if (res.confirm) submit()
      }
    })
  },

  async onAddDay() {
    const trip = this.data.trip
    if (!trip) return
    if (!this.guardWrite()) return
    try {
      const res = await tripService.update(trip._id, {
        endDate: addDays(trip.endDate, 1)
      }, trip.version)
      this.apply(res.trip, this.data.pois)
    } catch (err) {
      await this.afterTripWrite(err)
    }
  },

  // 误点了「加一天」可以退回来：最后一天没有地点时才能减
  async onRemoveDay() {
    const trip = this.data.trip
    if (!trip || !this.data.canRemoveLastDay) return
    if (!this.guardWrite()) return
    try {
      const res = await tripService.update(trip._id, {
        endDate: addDays(trip.endDate, -1)
      }, trip.version)
      this.apply(res.trip, this.data.pois)
    } catch (err) {
      await this.afterTripWrite(err)
    }
  },

  // 加/减天不做自动重试：对方可能已经改过日期，重试会多算一天
  async afterTripWrite(err) {
    if (err && err.code === 'conflict') {
      await this.load()
      wx.showToast({ title: '行程刚被改过，已刷新', icon: 'none' })
    }
  },

  // 结束/重开只改 status，不改日期；结束后列表卡片会跟着变
  async onToggleStatus() {
    const trip = this.data.trip
    if (!trip) return
    if (!this.guardWrite()) return
    const status = trip.status === 'ended' ? 'planning' : 'ended'
    try {
      const res = await tripService.update(trip._id, { status: status }, trip.version)
      this.apply(res.trip, this.data.pois)
    } catch (err) {
      await this.afterTripWrite(err)
    }
  },

  onRemoveTrip() {
    const trip = this.data.trip
    if (!trip) return
    const that = this

    const submit = async function () {
      try {
        await tripService.remove(trip._id, that.data.trip.version)
        wx.navigateBack()
      } catch (err) {
        that.afterTripWrite(err)
      }
    }

    wx.showModal({
      title: '删除这个行程？',
      content: '「' + trip.title + '」下的地点和账目会一起删掉，之后列表和记账里都看不到。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: function (res) {
        if (res.confirm) submit()
      }
    })
  }
})
