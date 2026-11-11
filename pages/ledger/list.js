const tripService = require('../../services/trip')
const expenseService = require('../../services/expense')
const { dateRangeText, moneyText } = require('../../utils/format')

const app = getApp()

Page({
  data: {
    loading: true,
    error: '',
    rows: [],
    needLogin: false,
    totalText: '¥0.00',
    countText: '0 笔',
    headSub: '按行程管理每一笔花费'
  },

  onShow() {
    // 游客模式：账单是隐私数据，不强制跳转，只展示登录引导
    if (!app.isLogin()) {
      this.setData({
        loading: false,
        error: '',
        rows: [],
        needLogin: true,
        totalText: '¥0.00',
        countText: '0 笔',
        headSub: '登录后查看你的账单'
      })
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
      const results = await Promise.all([tripService.list(), expenseService.overview()])
      const trips = results[0].items || []
      const stats = results[1].items || []

      const totals = {}
      let totalCents = 0
      let count = 0
      stats.forEach(function (item) {
        totals[item.tripId] = item
        totalCents += item.totalCents || 0
        count += item.count || 0
      })

      const rows = trips.map(function (trip) {
        const stat = totals[trip._id] || { totalCents: 0, count: 0 }
        return {
          _id: trip._id,
          title: trip.title,
          dateText: dateRangeText(trip.startDate, trip.endDate),
          totalText: moneyText(stat.totalCents),
          countText: stat.count + ' 笔'
        }
      })

      const moneyTotal = moneyText(totalCents)
      this.setData({
        rows: rows,
        totalText: moneyTotal,
        countText: count + ' 笔',
        headSub: '共 ' + count + ' 笔 · 累计 ' + moneyTotal,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  onOpen(e) {
    wx.navigateTo({ url: '/pages/expense/list?tripId=' + e.currentTarget.dataset.id })
  },

  onCreateTrip() {
    wx.switchTab({ url: '/pages/trips/list' })
  },

  onRetry() {
    this.load()
  }
})
