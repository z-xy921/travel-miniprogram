const { call } = require('./cloud')

module.exports = {
  list(tripId) {
    return call('photo.list', { tripId: tripId })
  },

  // 批量上传由页面自己的进度弹窗接管，这里必须静默：
  // 用 run() 会在每张照片上弹一次 loading，选 6 张就闪 6 次
  add(tripId, fileID, dayIndex) {
    return call('photo.add', { tripId: tripId, fileID: fileID, dayIndex: dayIndex })
  },

  // 批量删除是循环调用，loading 由页面统一弹一次，这里保持静默
  remove(tripId, fileId) {
    return call('photo.remove', { tripId: tripId, fileId: fileId })
  }
}
