const tripService = require('../../services/trip')
const { addDays, todayText, dayCount, moneyPlain } = require('../../utils/format')

Page({
  data: {
    tripId: '',
    version: 0,
    editing: false,
    // 单人 / 结伴：结伴只是先占个标记，真正的成员还是要在详情页邀请
    mode: 'solo',
    destination: '',
    title: '',
    startDate: todayText(),
    endDate: addDays(todayText(), 1),
    daysText: '2 天',
    transports: [
      { key: 'drive', label: '自驾', active: false },
      { key: 'transit', label: '公共交通', active: false }
    ],
    budget: '',
    submitting: false
  },

  // 带 ?id= 进来就是编辑已存在的行程
  onLoad(query) {
    if (!query || !query.id) return
    this.setData({ tripId: query.id, editing: true })
    wx.setNavigationBarTitle({ title: '编辑行程' })
    this.loadTrip()
  },

  async loadTrip() {
    try {
      const res = await tripService.get(this.data.tripId)
      const trip = res.trip
      const active = trip.transport || []
      this.setData({
        version: Number(trip.version) || 0,
        mode: trip.mode === 'group' ? 'group' : 'solo',
        destination: trip.destination || '',
        title: trip.title || '',
        startDate: trip.startDate,
        endDate: trip.endDate,
        daysText: this.daysTextOf(trip.startDate, trip.endDate),
        transports: this.data.transports.map(function (item) {
          return { key: item.key, label: item.label, active: active.indexOf(item.key) !== -1 }
        }),
        budget: Number(trip.budgetCents) ? moneyPlain(trip.budgetCents) : ''
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onStartDate(e) {
    const startDate = e.detail.value
    const endDate = this.data.endDate < startDate ? startDate : this.data.endDate
    this.setData({
      startDate: startDate,
      endDate: endDate,
      daysText: this.daysTextOf(startDate, endDate)
    })
  },

  onEndDate(e) {
    const endDate = e.detail.value
    this.setData({
      endDate: endDate,
      daysText: this.daysTextOf(this.data.startDate, endDate)
    })
  },

  daysTextOf(startDate, endDate) {
    const count = dayCount(startDate, endDate)
    return count ? count + ' 天' : '日期有误'
  },

  onTransport(e) {
    const key = e.currentTarget.dataset.key
    const transports = this.data.transports.map(function (item) {
      if (item.key !== key) return item
      return { key: item.key, label: item.label, active: !item.active }
    })
    this.setData({ transports: transports })
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.mode === 'group' ? 'group' : 'solo'
    this.setData({ mode: mode })
  },

  // 创建后的分流：结伴先问一句要不要马上邀请，单人直接进详情
  afterCreate(trip) {
    const tripId = trip._id
    const toDetail = function () {
      wx.redirectTo({ url: '/pages/trip/detail?id=' + tripId })
    }

    // mode 以服务端落库结果为准，不看本地选中态
    if (trip.mode !== 'group') {
      toDetail()
      return
    }

    wx.showModal({
      title: '行程创建成功',
      content: '是否立即邀请同伴一起规划？',
      confirmText: '去邀请',
      cancelText: '稍后',
      success(res) {
        if (res.confirm) {
          wx.redirectTo({ url: '/pages/trips/invite?id=' + tripId })
          return
        }
        toDetail()
      }
    })
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!this.data.destination.trim()) {
      wx.showToast({ title: '请先填写目的地', icon: 'none' })
      return
    }

    const draft = {
      destination: this.data.destination,
      // 名称留空时退回用目的地，和新建时的默认值一致
      title: this.data.title.trim() || this.data.destination.trim(),
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      transport: this.data.transports
        .filter(function (item) {
          return item.active
        })
        .map(function (item) {
          return item.key
        }),
      budget: this.data.budget
    }

    this.setData({ submitting: true })
    try {
      if (this.data.editing) {
        await tripService.update(this.data.tripId, draft, this.data.version)
        wx.navigateBack()
        return
      }
      const res = await tripService.create(Object.assign({ mode: this.data.mode }, draft))
      this.afterCreate(res.trip)
    } catch (err) {
      this.setData({ submitting: false })
      // 冲突时不覆盖对方：只重取版本号，用户再点一次保存即可
      if (err && err.code === 'conflict') {
        try {
          const fresh = await tripService.get(this.data.tripId)
          this.setData({ version: Number(fresh.trip.version) || 0 })
        } catch (e) {
          // 取不到就保持原样，下次保存仍会被拦
        }
        wx.showToast({ title: '行程刚被同行改过，请再点一次保存', icon: 'none' })
      }
    }
  }
})
