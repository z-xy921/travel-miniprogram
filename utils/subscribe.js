const { MESSAGE_TEMPLATES } = require('./constants')

// 订阅消息必须「用户点一下」才能申请，且一次授权只换一条推送。
// 模板 id 没配置时直接说清楚，不假装已经开好。
function requestReminder() {
  const templateId = MESSAGE_TEMPLATES.tripReminder

  if (!templateId) {
    wx.showModal({
      title: '提醒还没配置',
      content:
        '订阅消息要先去微信公众平台申请模板，把模板 id 填到 utils/constants.js 的 MESSAGE_TEMPLATES.tripReminder。现在点这个按钮只会把授权记录留下，不会真的发消息。',
      showCancel: false
    })
    return Promise.resolve('missing')
  }

  return new Promise(function (resolve) {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: function (res) {
        resolve(res[templateId] === 'accept' ? 'accept' : 'reject')
      },
      fail: function () {
        resolve('fail')
      }
    })
  })
}

module.exports = { requestReminder: requestReminder }
