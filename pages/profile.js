const tripService = require('../services/trip')
const expenseService = require('../services/expense')
const { moneyText } = require('../utils/format')

const app = getApp()

// openid 只展示后 8 位，够辨识又不暴露完整身份
function idText(openid) {
  const tail = String(openid || '').slice(-8).toUpperCase()
  return tail ? 'ID · ' + tail : '已登录'
}

Page({
  data: {
    loading: true,
    userInfo: null,
    cityCount: 0,
    tripCount: 0,
    totalText: '¥0',
    idText: '登录后同步你的旅行'
  },

  onShow() {
    const userInfo = app.globalData.userInfo || null
    // 游客模式：不拉数据，看板显示 0
    if (!app.isLogin()) {
      this.setData({
        userInfo: null,
        cityCount: 0,
        tripCount: 0,
        totalText: '¥0',
        idText: '登录后同步你的旅行'
      })
      return
    }
    this.setData({ userInfo: userInfo, idText: idText(app.globalData.openid) })
    this.load()
  },

  // 头部区域：未登录时点了就去登录
  onHeadTap() {
    if (!this.data.userInfo) this.onLogin()
  },

  async load() {
    try {
      const results = await Promise.all([
        tripService.list(),
        expenseService.overview()
      ])
      const trips = results[0].items || []
      const stats = results[1].items || []

      // 去过城市按目的地去重，没填目的地的老行程用标题兜底
      const seen = {}
      let cityCount = 0
      trips.forEach(function (trip) {
        const city = String(trip.destination || trip.title || '').trim()
        if (!city || seen[city]) return
        seen[city] = true
        cityCount++
      })

      let totalCents = 0
      stats.forEach(function (item) {
        totalCents += item.totalCents || 0
      })

      this.setData({
        loading: false,
        cityCount: cityCount,
        tripCount: trips.length,
        totalText: moneyText(totalCents)
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  // 未登录时引导去登录页；登录成功 navigateBack 回来，onShow 会自动刷新
  onLogin() {
    app.gotoLogin()
  },

  onInvite() {
    // 游客模式：不强制跳转，弹窗确认后再去登录
    if (!app.checkLogin({ modal: { title: '需要登录', content: '加入别人的行程前请先登录，是否前往登录？' } })) return
    wx.navigateTo({ url: '/pages/trips/join' })
  },

  onPrivacy() {
    wx.showModal({
      title: '隐私协议',
      content: '我们只保存你主动填写的行程、地点与账目数据，用于在你的微信账号下同步；不会用于广告推送，也不会向第三方出售。你可随时退出登录停止同步。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  // 只清本地缓存，保留登录态，避免用户莫名其妙被登出
  onClearCache() {
    const that = this
    wx.showModal({
      title: '清除本地缓存',
      content: '会清掉本地临时数据，已同步到云端的行程和账目不受影响。',
      confirmText: '清除',
      success: function (res) {
        if (!res.confirm) return
        const info = app.globalData.userInfo
        wx.clearStorageSync()
        if (info) wx.setStorageSync('userInfo', info)
        wx.showToast({ title: '已清除本地缓存', icon: 'none' })
        that.load()
      }
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后创建行程、加入行程、记账需要重新登录',
      confirmText: '退出',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          // 游客模式：退出后不拉数据，看板回到 0
          this.setData({
            userInfo: null,
            cityCount: 0,
            tripCount: 0,
            totalText: '¥0',
            idText: '登录后同步你的旅行'
          })
        }
      }
    })
  }
})
