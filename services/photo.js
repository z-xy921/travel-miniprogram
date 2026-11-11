const { call, run } = require('./cloud')

module.exports = {
  list(tripId) {
    return call('photo.list', { tripId: tripId })
  },

  add(tripId, fileID, dayIndex) {
    return run('photo.add', { tripId: tripId, fileID: fileID, dayIndex: dayIndex }, '保存照片')
  },

  remove(tripId, fileId) {
    return run('photo.remove', { tripId: tripId, fileId: fileId }, '删除中')
  }
}
