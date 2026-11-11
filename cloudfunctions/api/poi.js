const { db } = require('./db')
const { getTripForMember, getTripForPreview, assertVersion, bumpVersion } = require('./guard')
const { cut, uuid } = require('./util')

const CATEGORIES = ['景点', '餐饮', '住宿', '交通', '购物', '其它']
const DURATIONS = [30, 60, 90, 120, 180]
const MAX_PER_DAY = 20

// order 进位到「天」上：day0 从 101000 起，day1 从 201000 起……
// 这样只按 order 单字段排序就能得到「按天 + 按序」，一个索引搞定
function baseOrder(dayIndex) {
  return (dayIndex + 1) * 100000
}

function normalizeLocation(input) {
  if (!input) return null
  const lat = Number(input.latitude)
  const lng = Number(input.longitude)
  if (!isFinite(lat) || !isFinite(lng) || !lat || !lng) return null
  return { latitude: lat, longitude: lng }
}

function normalizeFacts(input) {
  const facts = input || {}
  return {
    open: cut(facts.open, 40),
    reserve: cut(facts.reserve, 40),
    fee: cut(facts.fee, 40)
  }
}

function normalizeTime(value) {
  const text = cut(value, 5)
  return /^\d{2}:\d{2}$/.test(text) ? text : ''
}

function normalizeDuration(value) {
  const num = Number(value)
  return DURATIONS.indexOf(num) !== -1 ? num : 60
}

async function nextOrder(tripId, dayIndex) {
  const res = await db
    .collection('pois')
    .where({ tripId: tripId, dayIndex: dayIndex, deletedAt: '' })
    .orderBy('order', 'desc')
    .limit(1)
    .get()
  const last = res.data[0]
  return last ? last.order + 1000 : baseOrder(dayIndex) + 1000
}

async function refreshCount(tripId) {
  const res = await db.collection('pois').where({ tripId: tripId, deletedAt: '' }).count()
  await db
    .collection('trips')
    .where({ _id: tripId })
    .update({ data: { poiCount: res.total, updatedAt: Date.now() } })
}

// 详情页只要一次请求：顺带返回 trip，省掉一次往返。
// 非成员（含未登录游客）降级为只读预览：preview=true，前端据此隐藏全部写操作。
async function list(payload, ctx) {
  let trip = null
  let preview = false
  try {
    trip = await getTripForMember(payload.tripId, ctx.openid)
  } catch (err) {
    trip = await getTripForPreview(payload.tripId)
    preview = true
  }

  const res = await db
    .collection('pois')
    .where({ tripId: trip._id, deletedAt: '' })
    .orderBy('order', 'asc')
    .limit(300)
    .get()
  return { trip: trip, items: res.data, preview: preview }
}

async function save(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  if (!trip.days.length) throw new Error('这份行程还没有可选的天')

  const input = payload.poi || {}
  const name = cut(input.name, 30)
  if (!name) throw new Error('请填写地点名称')

  const dayIndex = Math.max(0, Math.min(Number(input.dayIndex) || 0, trip.days.length - 1))
  const now = Date.now()
  const doc = {
    tripId: trip._id,
    dayIndex: dayIndex,
    name: name,
    address: cut(input.address, 60),
    location: normalizeLocation(input.location),
    category: CATEGORIES.indexOf(input.category) !== -1 ? input.category : '其它',
    plannedTime: normalizeTime(input.plannedTime),
    durationMin: normalizeDuration(input.durationMin),
    facts: normalizeFacts(input.facts),
    // 用户手填的信息默认也标「待核实」：它来自攻略或口头消息，不是现场确认过的
    factsPending: input.factsPending !== false,
    note: cut(input.note, 200),
    updatedAt: now
  }

  let poiId = cut(input._id, 32)

  // 先只比对版本（不写），写之前再原子占位，避免白占一次版本
  assertVersion(trip, payload.version)

  if (poiId) {
    const existed = await db
      .collection('pois')
      .where({ _id: poiId, tripId: trip._id, deletedAt: '' })
      .limit(1)
      .get()
    if (!existed.data.length) throw new Error('地点不存在或已被删除')

    // 换到别的天，需要一个新的 order 排在当天末尾
    if (existed.data[0].dayIndex !== dayIndex) {
      doc.order = await nextOrder(trip._id, dayIndex)
    }
    await bumpVersion(trip)
    await db.collection('pois').where({ _id: poiId }).update({ data: doc })
  } else {
    const count = await db
      .collection('pois')
      .where({ tripId: trip._id, dayIndex: dayIndex, deletedAt: '' })
      .count()
    if (count.total >= MAX_PER_DAY) throw new Error('一天最多放 ' + MAX_PER_DAY + ' 个地点')

    poiId = uuid()
    await bumpVersion(trip)
    await db.collection('pois').add({
      data: Object.assign(
        {
          _id: poiId,
          order: await nextOrder(trip._id, dayIndex),
          createdBy: ctx.openid,
          createdAt: now,
          deletedAt: ''
        },
        doc
      )
    })
  }

  await refreshCount(trip._id)
  const fresh = await db.collection('pois').where({ _id: poiId }).limit(1).get()
  return { poi: fresh.data[0] }
}

async function remove(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const poiId = cut(payload.poiId, 32)
  if (!poiId) throw new Error('缺少地点 id')

  const now = Date.now()
  await assertVersion(trip, payload.version)
  await bumpVersion(trip)
  await db
    .collection('pois')
    .where({ _id: poiId, tripId: trip._id })
    .update({ data: { deletedAt: now, updatedAt: now } })
  await refreshCount(trip._id)
  return { poiId: poiId }
}

// items 是客户端希望得到的完整顺序：[{ _id, dayIndex, plannedTime }]
// 顺序、换天、重排时间都用这一个接口，避免多次往返造成半成功
async function reorder(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 300) : []
  await assertVersion(trip, payload.version)
  await bumpVersion(trip)
  const now = Date.now()
  const seq = {}

  const tasks = items.map(function (item) {
    const id = cut(item && item._id, 32)
    if (!id) return null
    const day = Math.max(0, Math.min(Number(item.dayIndex) || 0, trip.days.length - 1))
    seq[day] = (seq[day] || 0) + 1

    const data = {
      dayIndex: day,
      order: baseOrder(day) + seq[day] * 1000,
      updatedAt: now
    }
    const time = normalizeTime(item.plannedTime)
    if (time) data.plannedTime = time

    return db.collection('pois').where({ _id: id, tripId: trip._id }).update({ data: data })
  })

  await Promise.all(tasks.filter(Boolean))
  return { updated: items.length }
}

module.exports = {
  list: list,
  save: save,
  remove: remove,
  reorder: reorder
}
