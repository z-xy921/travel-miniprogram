const tripService = require('../services/trip')
const expenseService = require('../services/expense')
const { moneyText } = require('../utils/format')

const app = getApp()

Page({
  data: {
    loading: true,
    userInfo: null,
    tripCount: 0,
    expenseCount: 0,
    totalText: '¥0.00'
  },

  onShow() {
    const userInfo = app.globalData.userInfo || null
    this.setData({ userInfo: userInfo })
    // 游客模式：不拉数据，统计显示 0（横线在下划线字体下像下划线，视觉差）
    if (!app.isLogin()) {
      this.setData({ loading: false, tripCount: 0, expenseCount: 0, totalText: '¥0' })
      return
    }
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

      let totalCents = 0
      let count = 0
      stats.forEach(function (item) {
        totalCents += item.totalCents || 0
        count += item.count || 0
      })

      this.setData({
        loading: false,
        tripCount: trips.length,
        expenseCount: count,
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

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后创建行程、加入行程、记账需要重新登录',
      confirmText: '退出',
      success: (res) => {
        if (res.confirm) {
          app.logout()
          // 游客模式：退出后不拉数据，统计回到 0
          this.setData({ userInfo: null, tripCount: 0, expenseCount: 0, totalText: '¥0' })
        }
      }
    })
  },

  onInvite() {
    // 游客模式：不强制跳转，弹窗确认后再去登录
    if (!app.checkLogin({ modal: { title: '需要登录', content: '加入别人的行程前请先登录，是否前往登录？' } })) return
    wx.navigateTo({ url: '/pages/trips/join' })
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about' })
  }
})
