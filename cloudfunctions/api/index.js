const { start, ready } = require('./db')

const userHandler = require('./user')
const tripHandler = require('./trip')
const poiHandler = require('./poi')
const expenseHandler = require('./expense')
const photoHandler = require('./photo')
const notifyHandler = require('./notify')

// 单个云函数 + action 路由：只部署一次，权限与校验集中在一处
const routes = {
  'user.me': userHandler.me,
  'user.updateProfile': userHandler.updateProfile,

  'trip.list': tripHandler.list,
  'trip.get': tripHandler.get,
  'trip.create': tripHandler.create,
  'trip.update': tripHandler.update,
  'trip.copy': tripHandler.copy,
  'trip.remove': tripHandler.remove,
  'trip.invite': tripHandler.invite,
  'trip.join': tripHandler.join,
  'trip.leave': tripHandler.leave,
  'trip.removeMember': tripHandler.removeMember,

  'poi.list': poiHandler.list,
  'poi.save': poiHandler.save,
  'poi.remove': poiHandler.remove,
  'poi.reorder': poiHandler.reorder,

  'expense.list': expenseHandler.list,
  'expense.overview': expenseHandler.overview,
  'expense.save': expenseHandler.save,
  'expense.remove': expenseHandler.remove,
  'expense.settle': expenseHandler.settle,

  'photo.list': photoHandler.list,
  'photo.add': photoHandler.add,
  'photo.remove': photoHandler.remove,

  'notify.subscribe': notifyHandler.subscribe
}

exports.main = async function (event) {
  // 定时触发器没有 action、也没有用户身份，单独走一条路
  if (event && (event.Type === 'Timer' || event.TriggerName)) {
    try {
      await ready()
      const data = await notifyHandler.sendDue()
      return { ok: true, data: data }
    } catch (err) {
      console.error('[api] timer', event && event.TriggerName, err)
      return { ok: false, message: (err && err.message) || '定时任务失败' }
    }
  }

  const action = event && event.action
  const handler = routes[action]
  if (!handler) {
    return { ok: false, message: '未知操作：' + action }
  }

  try {
    // openid 只从服务端上下文取，前端传什么都不认
    const ctx = await start()
    const data = await handler((event && event.payload) || {}, ctx)
    return { ok: true, data: data === undefined ? null : data }
  } catch (err) {
    console.error('[api]', action, err)
    return {
      ok: false,
      // code 只用于客户端分派（如 conflict → 提示刷新），权限与校验仍以 message 为准
      code: (err && err.code) || '',
      message: (err && err.message) || '服务异常，请稍后重试'
    }
  }
}
