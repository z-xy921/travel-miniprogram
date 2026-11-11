const { call, run } = require('./cloud')

module.exports = {
  list(tripId) {
    return call('poi.list', { tripId: tripId })
  },

  // version：调用方带上当前行程版本，服务端版本不一致会返回 conflict
  save(tripId, poi, version) {
    return run('poi.save', { tripId: tripId, poi: poi, version: version }, '保存中')
  },

  remove(tripId, poiId, version) {
    return run('poi.remove', { tripId: tripId, poiId: poiId, version: version }, '删除中')
  },

  // 顺序或时间变了，一次提交本天全部点位，避免部分成功
  reorder(tripId, items, version) {
    return call('poi.reorder', { tripId: tripId, items: items, version: version })
  }
}
