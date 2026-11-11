const { ENV_ID } = require('./utils/constants')

// 本地登录态缓存的 key：存 { hasLogin, openid, nickname, avatar }
const USER_KEY = 'userInfo'

App({
  globalData: {
    envId: ENV_ID,
    openid: '',
    cloudReady: false,
    userInfo: null,
    // 被 checkLogin 拦截时记下来源页，登录成功后 navigateBack 返回原页面
    loginRedirect: ''
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请把调试基础库调到 2.2.3 以上')
      return
    }
    wx.cloud.init({
      env: ENV_ID,
      traceUser: true
    })
    this.globalData.cloudReady = true
    this.restoreLogin()
  },

  // 冷启动只读一次本地缓存恢复登录态
  restoreLogin() {
    const info = wx.getStorageSync(USER_KEY)
    if (info && info.hasLogin && info.openid) {
      this.globalData.userInfo = info
      this.globalData.openid = info.openid
    }
  },

  isLogin() {
    return !!(this.globalData.userInfo && this.globalData.userInfo.hasLogin)
  },

  setUser(info) {
    this.globalData.userInfo = info
    this.globalData.openid = info.openid || ''
    wx.setStorageSync(USER_KEY, info)
  },

  logout() {
    this.globalData.userInfo = null
    this.globalData.openid = ''
    wx.removeStorageSync(USER_KEY)
    // 退出后允许先随便看看，不再一进首页就弹登录
    wx.setStorageSync('loginSkipped', true)
  },

  // 写操作（创建/加入行程、记账等）前的登录拦截；浏览页面放行
  // opts.modal 传 { title, content } 时先弹窗确认再跳登录，否则 toast 后直接跳
  checkLogin(opts) {
    if (this.isLogin()) return true
    const o = opts || {}
    const that = this

    if (o.modal) {
      wx.showModal({
        title: o.modal.title || '需要登录',
        content: o.modal.content || '该操作需要登录后才能使用',
        confirmText: '去登录',
        success(res) {
          if (res.confirm) that.gotoLogin()
        }
      })
      return false
    }

    if (o.tip) wx.showToast({ title: o.tip, icon: 'none' })
    this.gotoLogin()
    return false
  },

  // 跳到登录页并记录来源页；已在登录页时防重复入栈
  gotoLogin() {
    const pages = getCurrentPages()
    const current = pages[pages.length - 1]
    if (current && current.route === 'pages/login/login') return
    if (current) this.globalData.loginRedirect = '/' + current.route
    wx.navigateTo({ url: '/pages/login/login' })
  },

  consumeRedirect() {
    const redirect = this.globalData.loginRedirect
    this.globalData.loginRedirect = ''
    return redirect
  }
})
