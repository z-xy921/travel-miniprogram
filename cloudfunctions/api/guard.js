const { db, _ } = require('./db')

function isMember(trip, openid) {
  return (trip.memberOpenids || []).indexOf(openid) !== -1
}

// 老数据可能只有 ownerOpenid，没有 role，这里统一兜底
function roleOf(trip, openid) {
  const member = (trip.members || []).filter(function (item) {
    return item.openid === openid
  })[0]
  if (member && member.role) return member.role
  return trip.ownerOpenid === openid ? 'owner' : 'editor'
}

function requireOwner(trip, openid) {
  if (roleOf(trip, openid) !== 'owner') throw new Error('只有创建者可以做这个操作')
}

function conflictError() {
  const err = new Error('这趟行程刚被别人改过，刷新一下再试')
  err.code = 'conflict'
  return err
}

// 客户端带上自己读到的版本号：版本对不上说明中间有人写过，直接拒绝
function assertVersion(trip, expected) {
  if (expected === undefined || expected === null || expected === '') return
  if (Number(expected) !== Number(trip.version || 0)) throw conflictError()
}

// 原子占位：where 带旧版本号，updated 为 0 说明有人抢先写了。
// 这样即使两个请求同时通过了 assertVersion，也只有一个能落地。
async function bumpVersion(trip) {
  const current = Number(trip.version || 0)
  const res = await db
    .collection('trips')
    .where({ _id: trip._id, version: current })
    .update({ data: { version: _.inc(1), updatedAt: Date.now() } })
  if (!res.stats.updated) throw conflictError()
  trip.version = current + 1
}

async function getTripForMember(tripId, openid) {
  if (!tripId) throw new Error('缺少行程 id')
  const res = await db
    .collection('trips')
    .where({ _id: tripId, deletedAt: '' })
    .limit(1)
    .get()

  const trip = res.data[0]
  if (!trip) throw new Error('行程不存在或已被删除')
  if (!isMember(trip, openid)) throw new Error('你没有这份行程的权限')

  // V1.0 建的老行程没有 version 字段，补 0 否则 where version:0 匹配不到
  if (typeof trip.version !== 'number') {
    trip.version = 0
    await db.collection('trips').where({ _id: trip._id }).update({ data: { version: 0 } })
  }

  // 页面需要知道自己是不是创建者：只回给调用者，不写库
  trip.myRole = roleOf(trip, openid)
  return trip
}

// 游客只读预览：凭 tripId（uuid，不可枚举）查看行程与地点，供分享进来的未登录用户浏览。
// 只给展示字段，成员名单、邀请码、openid 一律不带出去。
function sanitizeTripForPreview(trip) {
  return {
    _id: trip._id,
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    days: trip.days || [],
    mode: trip.mode,
    transport: trip.transport || [],
    budgetCents: trip.budgetCents,
    status: trip.status,
    poiCount: trip.poiCount,
    createdAt: trip.createdAt
  }
}

async function getTripForPreview(tripId) {
  if (!tripId) throw new Error('缺少行程 id')
  const res = await db
    .collection('trips')
    .where({ _id: tripId, deletedAt: '' })
    .limit(1)
    .get()

  const trip = res.data[0]
  if (!trip) throw new Error('行程不存在或已被删除')
  return sanitizeTripForPreview(trip)
}

module.exports = {
  isMember: isMember,
  roleOf: roleOf,
  requireOwner: requireOwner,
  assertVersion: assertVersion,
  bumpVersion: bumpVersion,
  conflictError: conflictError,
  getTripForMember: getTripForMember,
  getTripForPreview: getTripForPreview
}
