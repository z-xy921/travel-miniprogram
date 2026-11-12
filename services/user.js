const { call } = require('./cloud')

module.exports = {
  me() {
    return call('user.me')
  },

  // 一键登录：云端按 openid 查 users，资料齐全直接放行
  login() {
    return call('user.login').catch(function (err) {
      // 兜底：云端还没部署 user.login（旧版路由表）时，退回 user.me 判断资料是否完整
      if (/未知操作/.test(err.message || '')) {
        return me().then(function (res) {
          return {
            openid: res.openid,
            hasProfile: Boolean(res.user.nickname && res.user.avatar),
            nickname: res.user.nickname || '',
            avatar: res.user.avatar || ''
          }
        })
      }
      throw err
    })
  },

  // 登录/完善资料：云端写 users 并同步协同行程成员的名字与头像
  updateProfile(payload) {
    return call('user.updateProfile', payload)
  }
}
