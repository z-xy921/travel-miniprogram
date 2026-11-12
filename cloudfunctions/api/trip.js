const { db, _ } = require('./db')
const { getTripForMember, requireOwner, assertVersion, bumpVersion, isMember, roleOf } = require('./guard')
const { buildDays, cut, formatDate, toCents, uuid } = require('./util')

const MAX_DAYS = 15
const TRANSPORTS = ['drive', 'transit']
const STATUS = ['planning', 'ongoing', 'ended']
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_DAYS = 7

function makeCode() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length))
  }
  return code
}

async function uniqueCode() {
  for (let i = 0; i < 5; i++) {
    const code = makeCode()
    const res = await db.collection('trips').where({ inviteCode: code, deletedAt: '' }).count()
    if (!res.total) return code
  }
  return makeCode()
}

function normalizeTransport(list) {
  if (!Array.isArray(list)) return []
  return TRANSPORTS.filter(function (key) {
    return list.indexOf(key) !== -1
  })
}

async function list(payload, ctx) {
  // 未完成登录（users 里还没有昵称）时一律返回空：数据按 openid 一对一隔离，不登录不给看
  if (!ctx.user.nickname) return { items: [] }

  const res = await db
    .collection('trips')
    .where({ memberOpenids: ctx.openid, deletedAt: '' })
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get()
  return { items: res.data }
}

async function get(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  return { trip: trip }
}

async function create(payload, ctx) {
  const destination = cut(payload.destination, 30)
  const title = cut(payload.title, 20) || destination
  if (!title) throw new Error('请填写行程名称')

  const startDate = cut(payload.startDate, 10)
  const endDate = cut(payload.endDate, 10)
  const days = buildDays(startDate, endDate, MAX_DAYS)
  if (!days.length) throw new Error('日期不合法：结束不能早于开始，且最多 ' + MAX_DAYS + ' 天')

  const now = Date.now()
  const trip = {
    _id: uuid(),
    ownerOpenid: ctx.openid,
    // V1.0 只有自己；V1.5 邀请后往这两个数组里加人即可
    memberOpenids: [ctx.openid],
    // 登录过的用户用真实昵称与头像；没登录保持旧占位
    members: [{ openid: ctx.openid, role: 'owner', name: ctx.user.nickname || '我', avatar: ctx.user.avatar || '', joinedAt: now }],
    title: title,
    destination: destination || title,
    startDate: startDate,
    endDate: endDate,
    days: days,
    mode: payload.mode === 'group' ? 'group' : 'solo',
    transport: normalizeTransport(payload.transport),
    budgetCents: toCents(payload.budget),
    status: 'planning',
    poiCount: 0,
    // V1.5：版本号做乐观锁，邀请码做邀请
    version: 0,
    inviteCode: '',
    inviteExpireAt: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: ''
  }

  await db.collection('trips').add({ data: trip })
  return { trip: trip }
}

async function update(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const patch = payload.patch || {}
  const data = { updatedAt: Date.now() }

  if (patch.title !== undefined) {
    const title = cut(patch.title, 20)
    if (!title) throw new Error('行程名称不能为空')
    data.title = title
  }
  if (patch.destination !== undefined) data.destination = cut(patch.destination, 30)
  if (patch.transport !== undefined) data.transport = normalizeTransport(patch.transport)
  if (patch.budget !== undefined) data.budgetCents = toCents(patch.budget)
  if (patch.status !== undefined && STATUS.indexOf(patch.status) !== -1) data.status = patch.status
  // 改日期就整段重建 days，天数永远由日期推导
  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const startDate = cut(patch.startDate || trip.startDate, 10)
    const endDate = cut(patch.endDate || trip.endDate, 10)
    const days = buildDays(startDate, endDate, MAX_DAYS)
    if (!days.length) throw new Error('日期不合法：结束不能早于开始，且最多 ' + MAX_DAYS + ' 天')

    // 减天数时先确认被取消的那几天没有地点，否则这些点位会悬空
    if (days.length < (trip.days || []).length) {
      const orphan = await db
        .collection('pois')
        .where({ tripId: trip._id, deletedAt: '', dayIndex: _.gte(days.length) })
        .count()
      if (orphan.total) {
        throw new Error('后面几天还有 ' + orphan.total + ' 个地点，先删掉或挪到前面再减天数')
      }
    }

    data.startDate = startDate
    data.endDate = endDate
    data.days = days
  }

  await assertVersion(trip, payload.version)
  await bumpVersion(trip)
  await db.collection('trips').where({ _id: trip._id }).update({ data: data })
  const fresh = await db.collection('trips').where({ _id: trip._id }).limit(1).get()
  return { trip: fresh.data[0] }
}

// 软删除：行程和它下面的点位、账目、手帐一起标记，历史留给 V1.5 的手帐回放
// 只有创建者能删，且需要版本一致（别人刚改过时先刷新）
async function remove(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  requireOwner(trip, ctx.openid)
  assertVersion(trip, payload.version)
  await bumpVersion(trip)

  const now = Date.now()
  await db.collection('trips').where({ _id: trip._id }).update({ data: { deletedAt: now, updatedAt: now } })
  await db.collection('pois').where({ tripId: trip._id, deletedAt: '' }).update({ data: { deletedAt: now } })
  await db.collection('expenses').where({ tripId: trip._id, deletedAt: '' }).update({ data: { deletedAt: now } })
  // 手帐记录同样软删：否则文件记录会悬空，且被删行程的照片仍占着 100 张配额
  await db.collection('files').where({ tripId: trip._id, deletedAt: '' }).update({ data: { deletedAt: now } })
  return { tripId: trip._id }
}

// 邀请码 7 天有效，过期或没生成时重新给一个；同一个码不重复占用
async function invite(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  requireOwner(trip, ctx.openid)

  const now = Date.now()
  if (trip.inviteCode && Number(trip.inviteExpireAt || 0) > now) {
    return { inviteCode: trip.inviteCode, inviteExpireAt: trip.inviteExpireAt, trip: trip }
  }

  const inviteCode = await uniqueCode()
  const inviteExpireAt = now + INVITE_DAYS * 86400000
  await db
    .collection('trips')
    .where({ _id: trip._id })
    .update({ data: { inviteCode: inviteCode, inviteExpireAt: inviteExpireAt, updatedAt: now } })

  trip.inviteCode = inviteCode
  trip.inviteExpireAt = inviteExpireAt
  return { inviteCode: inviteCode, inviteExpireAt: inviteExpireAt, trip: trip }
}

// 加入：分享卡片带 tripId，或者手输邀请码
async function join(payload, ctx) {
  const tripId = cut(payload.tripId, 32)
  const code = cut(payload.code, 12).toUpperCase()
  if (!tripId && !code) throw new Error('缺少邀请信息')

  const query = tripId ? { _id: tripId, deletedAt: '' } : { inviteCode: code, deletedAt: '' }
  const res = await db.collection('trips').where(query).limit(1).get()
  const trip = res.data[0]
  if (!trip) throw new Error('行程不存在、已被删除，或邀请码不对')

  // 已在行程里的成员直接放行：自己的行程不该因为邀请码过期而打不开
  if (isMember(trip, ctx.openid)) return { trip: trip, joined: false }

  // 邀请窗口对「链接直达」和「手输码」一视同仁：没有有效期或已过期都不能加入
  const expireAt = Number(trip.inviteExpireAt || 0)
  if (!expireAt) throw new Error('这个邀请还没开通，请让创建者重新分享一次')
  if (expireAt < Date.now()) throw new Error('邀请已过期，请让创建者重新分享一次')

  // 链接里带了码就核对一遍，避免码被重置后旧链接继续有效
  if (code && trip.inviteCode && code !== trip.inviteCode) {
    throw new Error('邀请码已失效，请让创建者重新分享')
  }

  const now = Date.now()
  await db
    .collection('trips')
    .where({ _id: trip._id })
    .update({
      data: {
        memberOpenids: _.push(ctx.openid),
        members: _.push({ openid: ctx.openid, role: 'editor', name: ctx.user.nickname || '同行', avatar: ctx.user.avatar || '', joinedAt: now }),
        // 两人以上就转成 group，列表/详情可以区分单人与协同
        mode: 'group',
        version: _.inc(1),
        updatedAt: now
      }
    })

  const fresh = await db.collection('trips').where({ _id: trip._id }).limit(1).get()
  return { trip: fresh.data[0], joined: true }
}

// 创建者可以移除同行；成员被移除后回到只有自己的列表
async function removeMember(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  requireOwner(trip, ctx.openid)

  const target = cut(payload.openid, 64)
  if (!target) throw new Error('缺少成员')
  if (target === ctx.openid) throw new Error('不能移除自己')
  if (target === trip.ownerOpenid) throw new Error('不能移除创建者')

  const memberOpenids = (trip.memberOpenids || []).filter(function (id) {
    return id !== target
  })
  const members = (trip.members || []).filter(function (item) {
    return item.openid !== target
  })

  await db
    .collection('trips')
    .where({ _id: trip._id })
    .update({
      data: {
        memberOpenids: memberOpenids,
        members: members,
        mode: members.length > 1 ? 'group' : 'solo',
        version: _.inc(1),
        updatedAt: Date.now()
      }
    })

  const fresh = await db.collection('trips').where({ _id: trip._id }).limit(1).get()
  return { trip: fresh.data[0], openid: target }
}

// 同行自己退出：创建者不能退（要么删行程）；退出是成员变化，不碰内容，所以不要版本号
async function leave(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  if (roleOf(trip, ctx.openid) === 'owner') {
    throw new Error('创建者不能退出，可以删除这趟行程')
  }

  const memberOpenids = (trip.memberOpenids || []).filter(function (id) {
    return id !== ctx.openid
  })
  const members = (trip.members || []).filter(function (item) {
    return item.openid !== ctx.openid
  })
  const reminders = (trip.reminders || []).filter(function (item) {
    return item && item.openid !== ctx.openid
  })

  await db
    .collection('trips')
    .where({ _id: trip._id })
    .update({
      data: {
        memberOpenids: memberOpenids,
        members: members,
        reminders: reminders,
        mode: members.length > 1 ? 'group' : 'solo',
        version: _.inc(1),
        updatedAt: Date.now()
      }
    })

  return { tripId: trip._id }
}

function plusDays(text, n) {
  const date = new Date(text + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

// 复制行程：日期从今天重新起算，点位整份搬过去，成员只留自己
async function copy(payload, ctx) {
  const source = await getTripForMember(payload.tripId, ctx.openid)
  const dayCount = (source.days || []).length || 1
  const startDate = formatDate(new Date())
  const endDate = plusDays(startDate, dayCount - 1)
  const days = buildDays(startDate, endDate, MAX_DAYS)
  if (!days.length) throw new Error('复制失败：日期超出上限')

  const now = Date.now()
  const tripId = uuid()
  const trip = {
    _id: tripId,
    ownerOpenid: ctx.openid,
    memberOpenids: [ctx.openid],
    members: [{ openid: ctx.openid, role: 'owner', name: ctx.user.nickname || '我', avatar: ctx.user.avatar || '', joinedAt: now }],
    title: cut(source.title + ' 副本', 20),
    destination: source.destination,
    startDate: startDate,
    endDate: endDate,
    days: days,
    mode: 'solo',
    transport: source.transport || [],
    budgetCents: Number(source.budgetCents) || 0,
    status: 'planning',
    poiCount: 0,
    version: 0,
    inviteCode: '',
    inviteExpireAt: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: ''
  }
  await db.collection('trips').add({ data: trip })

  const pois = await db
    .collection('pois')
    .where({ tripId: source._id, deletedAt: '' })
    .orderBy('order', 'asc')
    .limit(300)
    .get()

  const seq = {}
  for (let i = 0; i < pois.data.length; i++) {
    const poi = pois.data[i]
    const day = Math.max(0, Math.min(Number(poi.dayIndex) || 0, days.length - 1))
    seq[day] = (seq[day] || 0) + 1
    await db.collection('pois').add({
      data: {
        _id: uuid(),
        tripId: tripId,
        dayIndex: day,
        name: poi.name,
        address: poi.address,
        location: poi.location,
        category: poi.category,
        plannedTime: poi.plannedTime,
        durationMin: poi.durationMin,
        facts: poi.facts,
        factsPending: poi.factsPending,
        note: poi.note,
        order: (day + 1) * 100000 + seq[day] * 1000,
        createdBy: ctx.openid,
        createdAt: now,
        updatedAt: now,
        deletedAt: ''
      }
    })
  }

  if (pois.data.length) {
    await db.collection('trips').where({ _id: tripId }).update({ data: { poiCount: pois.data.length } })
    trip.poiCount = pois.data.length
  }

  return { trip: trip }
}

module.exports = {
  list: list,
  get: get,
  create: create,
  update: update,
  copy: copy,
  remove: remove,
  invite: invite,
  join: join,
  leave: leave,
  removeMember: removeMember
}
