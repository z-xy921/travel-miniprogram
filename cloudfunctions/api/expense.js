const { db, _, $ } = require('./db')
const { getTripForMember } = require('./guard')
const { cut, formatDate, toCents, uuid } = require('./util')

const CATEGORIES = ['交通', '餐饮', '门票', '住宿', '购物', '其它']
const MAX_ITEMS = 300

function normalizeDate(value) {
  const text = cut(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

// 汇总在服务端算一次，前端和明细永远对得上
function summarize(items) {
  let totalCents = 0
  const bucket = {}

  items.forEach(function (item) {
    const cents = Number(item.amountCents) || 0
    totalCents += cents
    bucket[item.category] = (bucket[item.category] || 0) + cents
  })

  const byCategory = Object.keys(bucket)
    .map(function (key) {
      return { category: key, cents: bucket[key] }
    })
    .sort(function (a, b) {
      return b.cents - a.cents
    })

  return { totalCents: totalCents, count: items.length, byCategory: byCategory }
}

// 成员展示名：有登录昵称优先用昵称，旧数据回退到角色 + openid 后四位
function memberLabel(member, selfOpenid) {
  const rawName = member && member.name
  const name = rawName && rawName !== '我' && rawName !== '同行' ? rawName : ''
  const tail = String((member && member.openid) || '').slice(-4).toUpperCase()
  if (member && member.openid === selfOpenid) return name ? '我（' + name + '）' : '我 (' + tail + ')'
  if (name) return name + (member.role === 'owner' ? '（创建者）' : '')
  if (member && member.role === 'owner') return '创建者 (' + tail + ')'
  return '同行 (' + tail + ')'
}

function memberMap(trip, selfOpenid) {
  const map = {}
  ;(trip.members || []).forEach(function (item) {
    map[item.openid] = memberLabel(item, selfOpenid)
  })
  return map
}

// 均摊：分到「分」，除不尽的零头给第一个人，保证合计刚好等于金额
function evenSplits(openids, amountCents) {
  const list = openids.slice()
  const count = list.length
  if (!count) return []
  const base = Math.floor(amountCents / count)
  const rest = amountCents - base * count
  return list.map(function (openid, index) {
    return { openid: openid, amountCents: base + (index === 0 ? rest : 0) }
  })
}

// splits 由客户端传 [{openid, amount(元)}]；不传就按全部成员均摊
function normalizeSplits(trip, input, amountCents) {
  const memberIds = (trip.memberOpenids || []).slice()
  const raw = Array.isArray(input) ? input : []
  const seen = {}

  const splits = []
  raw.forEach(function (item) {
    const openid = cut(item && item.openid, 64)
    if (!openid || seen[openid] || memberIds.indexOf(openid) === -1) return
    seen[openid] = true
    splits.push({ openid: openid, amountCents: toCents(item.amount) })
  })

  if (!splits.length) return evenSplits(memberIds, amountCents)

  const sum = splits.reduce(function (total, item) {
    return total + item.amountCents
  }, 0)
  if (sum !== amountCents) {
    throw new Error('分摊合计和金额不一致：差 ' + ((amountCents - sum) / 100).toFixed(2) + ' 元')
  }
  return splits
}

async function list(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const res = await db
    .collection('expenses')
    .where({ tripId: trip._id, deletedAt: '' })
    .orderBy('spentAt', 'desc')
    .limit(MAX_ITEMS)
    .get()

  const items = res.data.slice().sort(function (a, b) {
    if (a.spentAt === b.spentAt) return (b.createdAt || 0) - (a.createdAt || 0)
    return a.spentAt < b.spentAt ? 1 : -1
  })

  return { trip: trip, items: items, summary: summarize(items) }
}

// 记账 Tab：我所有行程的花费合计（一次聚合，不逐条拉明细）
async function overview(payload, ctx) {
  const trips = await db
    .collection('trips')
    .where({ memberOpenids: ctx.openid, deletedAt: '' })
    .field({ _id: true })
    .limit(200)
    .get()

  const ids = trips.data.map(function (item) {
    return item._id
  })
  if (!ids.length) return { items: [] }

  const res = await db
    .collection('expenses')
    .aggregate()
    .match({ tripId: _.in(ids), deletedAt: '' })
    .group({ _id: '$tripId', totalCents: $.sum('$amountCents'), count: $.sum(1) })
    .end()

  const items = res.list.map(function (row) {
    return { tripId: row._id, totalCents: row.totalCents, count: row.count }
  })
  return { items: items }
}

async function save(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const input = payload.expense || {}
  const amountCents = toCents(input.amount)
  if (amountCents <= 0) throw new Error('请填写大于 0 的金额')

  // 付款人必须是成员，没传就是自己
  const memberIds = trip.memberOpenids || [ctx.openid]
  const paidBy = memberIds.indexOf(cut(input.paidBy, 64)) !== -1 ? cut(input.paidBy, 64) : ctx.openid
  const labels = memberMap(trip, ctx.openid)
  const splits = normalizeSplits(trip, input.splits, amountCents)

  const now = Date.now()
  const doc = {
    tripId: trip._id,
    amountCents: amountCents,
    currency: 'CNY',
    category: CATEGORIES.indexOf(input.category) !== -1 ? input.category : '其它',
    paidBy: paidBy,
    paidByName: labels[paidBy] || '我',
    // splitWith 保留给老数据兼容，新逻辑看 splits
    splitWith: splits.map(function (item) {
      return item.openid
    }),
    splits: splits,
    spentAt: normalizeDate(input.spentAt) || formatDate(new Date()),
    note: cut(input.note, 100),
    updatedAt: now
  }

  let expenseId = cut(input._id, 32)

  if (expenseId) {
    const existed = await db
      .collection('expenses')
      .where({ _id: expenseId, tripId: trip._id, deletedAt: '' })
      .limit(1)
      .get()
    if (!existed.data.length) throw new Error('这笔记录不存在或已被删除')
    await db.collection('expenses').where({ _id: expenseId }).update({ data: doc })
  } else {
    expenseId = uuid()
    await db.collection('expenses').add({
      data: Object.assign(
        { _id: expenseId, createdBy: ctx.openid, createdAt: now, deletedAt: '' },
        doc
      )
    })
  }

  const fresh = await db.collection('expenses').where({ _id: expenseId }).limit(1).get()
  return { expense: fresh.data[0] }
}

async function remove(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const expenseId = cut(payload.expenseId, 32)
  if (!expenseId) throw new Error('缺少账目 id')

  const now = Date.now()
  await db
    .collection('expenses')
    .where({ _id: expenseId, tripId: trip._id })
    .update({ data: { deletedAt: now, updatedAt: now } })
  return { expenseId: expenseId }
}

// AA 结算：每人「实付 - 应摊 = 差额」，再做最省笔数的转账建议
async function settle(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const res = await db
    .collection('expenses')
    .where({ tripId: trip._id, deletedAt: '' })
    .limit(MAX_ITEMS)
    .get()

  return buildSettlement({
    trip: trip,
    items: res.data,
    labels: memberMap(trip, ctx.openid),
    order: (trip.memberOpenids || []).slice(),
    ctx: ctx
  })
}

// 单独抽出来，默认老账目（只有 splitWith）也能算出结果
function buildSettlement(input) {
  const trip = input.trip
  const labels = input.labels
  const selfOpenid = input.ctx.openid
  const order = input.order
  const items = input.items || []

  const paid = {}
  const owed = {}

  function ensure(openid) {
    if (order.indexOf(openid) === -1) order.push(openid)
    if (paid[openid] === undefined) paid[openid] = 0
    if (owed[openid] === undefined) owed[openid] = 0
  }

  order.forEach(ensure)

  items.forEach(function (item) {
    const amount = Number(item.amountCents) || 0
    const payer = item.paidBy || item.createdBy || selfOpenid
    ensure(payer)
    paid[payer] += amount

    const splits = Array.isArray(item.splits) && item.splits.length ? item.splits : null
    if (splits) {
      splits.forEach(function (row) {
        const openid = row.openid
        if (!openid) return
        ensure(openid)
        owed[openid] += Number(row.amountCents) || 0
      })
      return
    }

    // 老数据：只有 splitWith，按人数均摊
    let list = (item.splitOpenids || item.splitWith || []).filter(Boolean)
    if (!list.length) list = [payer]
    list.forEach(ensure)
    const base = Math.floor(amount / list.length)
    const rest = amount - base * list.length
    list.forEach(function (openid, index) {
      owed[openid] += base + (index === 0 ? rest : 0)
    })
  })

  const rows = order.map(function (openid) {
    const balance = paid[openid] - owed[openid]
    return {
      openid: openid,
      self: openid === selfOpenid,
      label: labels[openid] || '已移除 (' + String(openid).slice(-4).toUpperCase() + ')',
      paidCents: paid[openid],
      owedCents: owed[openid],
      balanceCents: balance
    }
  })

  const debtors = rows
    .filter(function (row) {
      return row.balanceCents < 0
    })
    .map(function (row) {
      return { label: row.label, left: row.balanceCents }
    })
  const creditors = rows
    .filter(function (row) {
      return row.balanceCents > 0
    })
    .map(function (row) {
      return { label: row.label, left: row.balanceCents }
    })

  const transfers = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].left, creditors[j].left)
    if (amount > 0) {
      transfers.push({
        fromLabel: debtors[i].label,
        toLabel: creditors[j].label,
        amountCents: amount
      })
    }
    debtors[i].left += amount
    creditors[j].left -= amount
    if (debtors[i].left === 0) i++
    if (creditors[j].left === 0) j++
  }

  const totalCents = rows.reduce(function (sum, row) {
    return sum + row.paidCents
  }, 0)

  return {
    tripId: trip._id,
    memberCount: trip.memberOpenids ? trip.memberOpenids.length : 1,
    totalCents: totalCents,
    members: rows,
    transfers: transfers
  }
}

module.exports = {
  list: list,
  overview: overview,
  save: save,
  remove: remove,
  settle: settle
}
