const tripService = require('../../services/trip')

const app = getApp()

Page({
  data: {
    tripId: '',
    code: '',
    loading: false,
    error: ''
  },

  onLoad(query) {
    const tripId = (query && query.id) || ''
    // 分享链接会带 code：服务端用它核对邀请是否过期/是否被重置
    const code = String((query && query.code) || '').toUpperCase()
    this.setData({ tripId: tripId, code: code })
    // 从分享卡片进来：不用手输码，直接加入
    if (tripId) this.join(code ? { tripId: tripId, code: code } : { tripId: tripId })
  },

  onCode(e) {
    this.setData({ code: String(e.detail.value || '').toUpperCase(), error: '' })
  },

  onManual() {
    const code = (this.data.code || '').trim()
    if (code.length !== 6) {
      wx.showToast({ title: '邀请码是 6 位', icon: 'none' })
      return
    }
    this.join({ code: code })
  },

  async join(payload) {
    // 加入涉及 openid 写入，未登录先引导登录（分享卡片自动加入也会被拦住，登录返回后可点重试）
    if (!app.checkLogin({ tip: '加入行程前请先登录' })) return
    if (this.joining) return
    this.joining = true
    this.setData({ loading: true, error: '' })

    try {
      const res = await tripService.join(payload)
      this.joining = false
      this.setData({ loading: false })
      wx.redirectTo({ url: '/pages/trip/detail?id=' + res.trip._id })
    } catch (err) {
      this.joining = false
      this.setData({ loading: false, error: err.message || '加入失败' })
    }
  },

  onRetry() {
    if (this.data.tripId) this.join({ tripId: this.data.tripId })
    else this.onManual()
  },

  onHome() {
    wx.switchTab({ url: '/pages/trips/list' })
  }
})
