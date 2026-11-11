const { CLOUD_FUNCTION } = require('../utils/constants')

// 所有写操作都走云函数：前端不直连数据库，
// 这样 V1.5 加「成员/权限」时只改服务端，不动页面。
function call(action, payload) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION,
      data: {
        action: action,
        payload: payload || {}
      },
      success(res) {
        const result = res && res.result
        if (result && result.ok) {
          resolve(result.data)
          return
        }
        const message = (result && result.message) || '服务暂时不可用'
        const err = new Error(message)
        // conflict 之类需要页面换不同处理方式，单独带出来
        err.code = (result && result.code) || ''
        reject(err)
      },
      fail() {
        reject(new Error('网络异常，请检查网络后重试'))
      }
    })
  })
}

// 带 loading 的调用：失败统一 toast，页面只写成功分支
async function run(action, payload, loadingText) {
  wx.showLoading({ title: loadingText || '处理中', mask: true })
  try {
    const data = await call(action, payload)
    wx.hideLoading()
    return data
  } catch (err) {
    wx.hideLoading()
    // 版本冲突要弹选择框，不能先 toast 一次打扰用户
    if (err.code !== 'conflict') {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
    throw err
  }
}

module.exports = { call, run }
