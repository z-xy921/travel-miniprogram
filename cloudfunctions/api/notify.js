const cloud = require('wx-server-sdk')
const { db } = require('./db')
const { getTripForMember } = require('./guard')
const { cut, formatDate } = require('./util')

// 模板字段名要和公众平台「出发提醒」模板里的字段一一对应。
// 如果模板用的是 thing2 / date1 之类，只改这三行，不用动发送逻辑。
const FIELDS = { title: 'thing1', date: 'date2', tip: 'thing3' }
const TIP_TEXT = '出发前一天提醒，点开看这趟安排'
const MAX_TRIPS = 100

function plusDays(text, n) {
  const date = new Date(text + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

// 模板数据：thing ≤20 字，date 只接受日期/时间格式，多写文字会被微信拒
function buildData(trip) {
  const data = {}
  data[FIELDS.title] = { value: cut(trip.title, 20) }
  data[FIELDS.date] = { value: cut(trip.startDate, 10) }
  data[FIELDS.tip] = { value: TIP_TEXT }
  return data
}

// 授权记录：一次点「出发提醒」只换一条推送机会，所以同一个 openid 只留一条
async function subscribe(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const templateId = cut(payload.templateId, 100)
  if (!templateId) throw new Error('还没有配置订阅消息模板')

  const now = Date.now()
  const reminders = (trip.reminders || []).filter(function (item) {
    return item && item.openid !== ctx.openid
  })
  reminders.push({ openid: ctx.openid, templateId: templateId, at: now })

  await db
    .collection('trips')
    .where({ _id: trip._id })
    .update({ data: { reminders: reminders, updatedAt: now } })

  return { count: reminders.length }
}

// 定时触发器每天 20:00 调这里（不走 action 路由，见 index.js）：
// 只找「明天出发」的行程，给还没发过的人各发一条
async function sendDue() {
  const tomorrow = plusDays(formatDate(new Date()), 1)
  const res = await db
    .collection('trips')
    .where({ startDate: tomorrow, deletedAt: '' })
    .limit(MAX_TRIPS)
    .get()

  let sent = 0
  let failed = 0

  for (let i = 0; i < res.data.length; i++) {
    const trip = res.data[i]
    const pending = (trip.reminders || []).filter(function (item) {
      return item && item.openid && item.templateId && !item.sentAt
    })
    if (!pending.length) continue

    for (let j = 0; j < pending.length; j++) {
      const item = pending[j]
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: item.openid,
          templateId: item.templateId,
          page: 'pages/trip/detail?id=' + trip._id,
          data: buildData(trip)
        })
        sent += 1
      } catch (err) {
        failed += 1
        // 字段名对不上（47003）或授权已用完，都会走这里；只记日志，不每天重试打扰用户
        console.error(
          '[notify] send failed',
          trip._id,
          item.openid,
          (err && err.errCode) || '',
          (err && err.errMsg) || (err && err.message) || ''
        )
      }
      // 无论成功失败都标记：这次授权已经用掉了
      item.sentAt = Date.now()
    }

    await db.collection('trips').where({ _id: trip._id }).update({ data: { reminders: trip.reminders } })
  }

  return { date: tomorrow, trips: res.data.length, sent: sent, failed: failed }
}

module.exports = {
  subscribe: subscribe,
  sendDue: sendDue
}
