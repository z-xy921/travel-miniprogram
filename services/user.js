const { call } = require('./cloud')

module.exports = {
  me() {
    return call('user.me')
  },

  // 登录/完善资料：云端写 users 并同步协同行程成员的名字与头像
  updateProfile(payload) {
    return call('user.updateProfile', payload)
  }
}
