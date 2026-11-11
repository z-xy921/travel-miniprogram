// 版本冲突的统一交互：先刷新拿到新版本，用户选「仍然保存」再用新版本重试一次
// page 需要有 load()；retry 必须是读 this.data 最新状态的动作，不能是旧闭包
function handle(err, page, retry) {
  if (!err || err.code !== 'conflict') return false

  wx.showModal({
    title: '有人刚改过这趟行程',
    content: '「仍然保存」会用你现在的改动覆盖对方；「刷新」则放弃这次的改动。',
    confirmText: '仍然保存',
    cancelText: '刷新',
    success: async function (res) {
      await page.load()
      if (res.confirm) retry()
    }
  })
  return true
}

module.exports = { handle: handle }
