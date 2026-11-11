const tripService = require('../../services/trip')
const { dateRangeText, todayText } = require('../../utils/format')

const app = getApp()

// 状态优先看手动标记的 ended，否则按日期推导（不用用户记得去改）
function statusOf(trip) {
  if (trip.status === 'ended') return { text: '已结束', cls: 'badge-neutral' }
  const today = todayText()
  if (today < trip.startDate) return { text: '未出发', cls: 'badge-pending' }
  if (today > trip.endDate) return { text: '已结束', cls: 'badge-neutral' }
  return { text: '进行中', cls: 'badge-done' }
}

function toCard(trip) {
  const status = statusOf(trip)
  const people = (trip.members || []).length || 1
  return {
    _id: trip._id,
    title: trip.title,
    dateText: dateRangeText(trip.startDate, trip.endDate),
    daysText: (trip.days || []).length + ' 天',
    poiText: '已排 ' + (trip.poiCount || 0) + ' 个地点',
    statusText: status.text,
    statusClass: status.cls,
    modeText: people > 1 ? people + ' 人同行' : ''
  }
}

Page({
  data: {
    loading: true,
    error: '',
    trips: [],
    needLogin: false,
    tripCount: 0,
    avatar: ''
  },

  onShow() {
    const info = app.globalData.userInfo || null
    this.setData({ avatar: (info && info.avatar) || '' })
    // 行程按 openid 一对一归属：未登录不拉数据，展示登录引导
    if (!app.isLogin()) {
      this.setData({ loading: false, error: '', trips: [], needLogin: true, tripCount: 0 })
      return
    }
    this.setData({ needLogin: false })
    this.load()
  },

  onGoLogin() {
    app.gotoLogin()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const res = await tripService.list()
      const items = (res.items || []).map(toCard)
      this.setData({
        trips: items,
        tripCount: items.length,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  onCreate() {
    // 游客模式：不强制跳转，点写操作时弹窗确认
    if (!app.checkLogin({ modal: { title: '需要登录', content: '需要登录才能创建行程，是否前往登录？' } })) return
    wx.navigateTo({ url: '/pages/trips/create' })
  },

  onOpen(e) {
    wx.navigateTo({ url: '/pages/trip/detail?id=' + e.currentTarget.dataset.id })
  },

  onRetry() {
    this.load()
  },

  // 分享占位：V1.5 做邀请码后，这里改成带上行程 id 的邀请链接
  onShareAppMessage() {
    return {
      title: '用「旅行计划」把每天的路排清楚',
      path: '/pages/trips/list'
    }
  }
})
