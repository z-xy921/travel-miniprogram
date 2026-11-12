const userService = require('../../services/user')

const app = getApp()

// chooseAvatar 在开发者工具里可能给到网络头像，上传前先兜底转成本地临时文件
function pickUploadPath(path) {
  if (/^https?:/i.test(path)) {
    return new Promise(function (resolve, reject) {
      wx.downloadFile({
        url: path,
        success(res) {
          resolve(res.tempFilePath)
        },
        fail() {
          reject(new Error('头像下载失败，请重新选择'))
        }
      })
    })
  }
  return Promise.resolve(path)
}

function goHome() {
  wx.switchTab({ url: '/pages/trips/list' })
}

Page({
  data: {
    agreed: false,
    showProfileModal: false,
    avatarUrl: '',
    nickname: '',
    submitting: false,
    // 一键登录的云端校验进行中
    checking: false,
    redirect: ''
  },

  onLoad(query) {
    // 登录页现在是启动页：老用户（已登录或之前选过“先逛逛”）直接进首页，不再看登录页
    const stack = getCurrentPages()
    const isEntry = stack.length <= 1
    if (isEntry && (app.isLogin() || wx.getStorageSync('loginSkipped'))) {
      wx.switchTab({ url: '/pages/trips/list' })
      return
    }
    // 被 checkLogin 拦截跳进来时，来源页记录在 app 里，登录成功后 navigateBack 返回
    this.setData({ redirect: (query && query.redirect) || app.consumeRedirect() })
  },

  onAgreeChange(e) {
    this.setData({ agreed: (e.detail.value || []).length > 0 })
  },

  // 一键登录：先问云端这个 openid 有没有完整资料。
  // 老用户（之前登录过、云端 users 里有昵称+头像）直接放行进首页；
  // 首次登录才弹「完善个人信息」弹层，弹层里顺带预填云端已有的昵称。
  async onTapLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    if (this.data.checking || this.data.submitting) return

    this.setData({ checking: true })
    wx.showLoading({ title: '登录中...', mask: true })

    try {
      const res = await userService.login()
      wx.hideLoading()

      if (res.hasProfile) {
        app.setUser({
          hasLogin: true,
          openid: res.openid,
          nickname: res.nickname,
          avatar: res.avatar
        })
        wx.removeStorageSync('loginSkipped')
        wx.showToast({ title: '欢迎回来', icon: 'success' })

        const redirect = this.data.redirect
        setTimeout(function () {
          if (redirect) wx.navigateBack({ fail: goHome })
          else goHome()
        }, 600)
        return
      }

      this.setData({
        checking: false,
        nickname: res.nickname || '',
        showProfileModal: true
      })
    } catch (err) {
      wx.hideLoading()
      this.setData({ checking: false })
      wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' })
    }
  },

  // 跳过登录：允许浏览，但创建/加入行程、记账等写操作仍会被 checkLogin 拦截
  onTapSkip() {
    wx.setStorageSync('loginSkipped', true)
    wx.switchTab({ url: '/pages/trips/list' })
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  // input type=nickname：键盘输入与微信快捷填入都要能取到值
  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onNicknameBlur(e) {
    this.setData({ nickname: e.detail.value || this.data.nickname })
  },

  onTapMaskClose() {
    if (!this.data.submitting) this.setData({ showProfileModal: false })
  },

  noop() {},

  async onTapConfirm() {
    if (this.data.submitting) return
    const nickname = (this.data.nickname || '').trim()
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (!this.data.avatarUrl) {
      wx.showToast({ title: '请选择头像', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '登录中...', mask: true })

    try {
      const filePath = await pickUploadPath(this.data.avatarUrl)
      const ext = (/\.(\w+)$/.exec(filePath) || [])[1] || 'png'
      const upload = await new Promise(function (resolve, reject) {
        wx.cloud.uploadFile({
          cloudPath: 'avatars/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext,
          filePath: filePath,
          success: resolve,
          fail() {
            reject(new Error('头像上传失败，请重试'))
          }
        })
      })

      const res = await userService.updateProfile({
        nickname: nickname,
        avatarFileID: upload.fileID
      })

      app.setUser({
        hasLogin: true,
        openid: res.openid,
        nickname: nickname,
        avatar: upload.fileID
      })
      wx.removeStorageSync('loginSkipped')

      wx.hideLoading()
      wx.showToast({ title: '登录成功', icon: 'success' })

      const redirect = this.data.redirect
      setTimeout(function () {
        if (redirect) {
          // 来源页（含 tab 页）还在页面栈里，返回即触发 onShow 自动刷新
          wx.navigateBack({ fail: goHome })
        } else {
          goHome()
        }
      }, 800)
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' })
    }
  }
})
