// 结算 / 均摊的纯算法模块：不依赖数据库和微信 API，
// 云函数和单元测试（tests/unit/settle.test.js）共用同一份实现，避免两处逻辑漂移。

// 均摊：分到「分」，除不尽的零头给第一个人，保证合计刚好等于金额。
// openids 兜底为空数组：调用方传空/漏传时不抛错，返回 []（amountCents = 0 也安全）。
function evenSplits(openids, amountCents) {
  const list = Array.isArray(openids) ? openids.slice() : []
  const count = list.length
  if (!count) return []
  const base = Math.floor(amountCents / count)
  const rest = amountCents - base * count
  return list.map(function (openid, index) {
    return { openid: openid, amountCents: base + (index === 0 ? rest : 0) }
  })
}

// AA 结算核心：每人「实付 - 应摊 = 差额」，再做最省笔数的转账建议
// input: { trip, items, labels, order, ctx: { openid } }
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

  // 双指针：欠款人队列 × 债权人队列，每次转移两边差额的较小值，
  // 一方清零就推进另一边的指针，得到最少笔数的转账方案
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
  evenSplits: evenSplits,
  buildSettlement: buildSettlement
}
