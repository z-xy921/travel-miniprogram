const { call, run } = require('./cloud')

module.exports = {
  list() {
    return call('trip.list', {})
  },

  get(tripId) {
    return call('trip.get', { tripId: tripId })
  },

  create(draft) {
    return run('trip.create', draft, '创建中')
  },

  // version 是乐观锁：页面带上自己读到的版本，服务端发现过期会拒掉
  update(tripId, patch, version) {
    return run('trip.update', { tripId: tripId, patch: patch, version: version }, '保存中')
  },

  remove(tripId, version) {
    return run('trip.remove', { tripId: tripId, version: version }, '删除中')
  },

  // 复制行程：日期从今天重新起算，点位跟着搬过去
  copy(tripId) {
    return run('trip.copy', { tripId: tripId }, '复制中')
  },

  invite(tripId) {
    return run('trip.invite', { tripId: tripId }, '生成邀请')
  },

  // 静默续邀请码：详情页打开时后台调用，不弹 loading 打扰
  inviteSilent(tripId) {
    return call('trip.invite', { tripId: tripId })
  },

  join(payload) {
    return run('trip.join', payload, '加入中')
  },

  // 同行自己退出；创建者要走删除
  leave(tripId) {
    return run('trip.leave', { tripId: tripId }, '退出中')
  },

  removeMember(tripId, openid) {
    return run('trip.removeMember', { tripId: tripId, openid: openid }, '移除中')
  }
}
