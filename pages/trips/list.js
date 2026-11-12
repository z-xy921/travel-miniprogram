const tripService = require('../../services/trip')
const { parseDate } = require('../../utils/format')

const app = getApp()

// 11.12 - 11.14，卡片上只给紧凑写法
function shortRange(start, end) {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return ''
  return (s.getMonth() + 1) + '.' + s.getDate() + ' - ' + (e.getMonth() + 1) + '.' + e.getDate()
}

function toCard(trip) {
  const people = (trip.members || []).length || 1
  return {
    _id: trip._id,
    title: trip.title,
    // 城市用目的地字段，老数据没填就用标题兜底
    tag: trip.destination || trip.title,
    metaText: [shortRange(trip.startDate, trip.endDate), people + '人'].join(' · '),
    poiText: (trip.poiCount || 0) + ' 个地点'
  }
}

Page({
  data: {
    loading: true,
    error: '',
    trips: [],
    needLogin: false,
    tripCount: 0
  },

  onShow() {
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
