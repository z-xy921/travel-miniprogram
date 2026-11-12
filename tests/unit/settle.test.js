// 单元测试：AA 均摊（evenSplits）+ 双指针最少转账（buildSettlement）
// 被测对象是从 cloudfunctions/api/expense.js 抽出的纯算法模块 settle-core.js，
// 云函数与测试共用同一份实现——这里测过的就是线上跑的。

const { evenSplits, buildSettlement } = require('../../cloudfunctions/api/settle-core')

// —— 测试脚手架：造一个三人行程和若干笔账目 ——

const OPENIDS = ['oA', 'oB', 'oC']

function makeTrip() {
  return {
    _id: 'trip-1',
    memberOpenids: OPENIDS.slice(),
    members: [
      { openid: 'oA', name: '阿喆', role: 'owner' },
      { openid: 'oB', name: '小北', role: 'editor' },
      { openid: 'oC', name: '老周', role: 'editor' }
    ]
  }
}

// 一笔账：amountCents 金额（分）、paidBy 付款人、splits 分摊明细
function expense(amountCents, paidBy, splits, extra) {
  return Object.assign(
    { amountCents: amountCents, paidBy: paidBy, splits: splits },
    extra || {}
  )
}

// 构造结算入参，labels/order/ctx 按 expense.settle 的真实调用方式拼装
function settle(items, selfOpenid) {
  const trip = makeTrip()
  const labels = {}
  trip.members.forEach(function (m) {
    labels[m.openid] = m.name
  })
  return buildSettlement({
    trip: trip,
    items: items,
    labels: labels,
    order: trip.memberOpenids.slice(),
    ctx: { openid: selfOpenid || 'oA' }
  })
}

// —— evenSplits 均摊 ——

describe('evenSplits：均摊算法', () => {
  test('整除时每人金额相同', () => {
    expect(evenSplits(['oA', 'oB'], 10000)).toEqual([
      { openid: 'oA', amountCents: 5000 },
      { openid: 'oB', amountCents: 5000 }
    ])
  })

  test('除不尽的零头给第一个人，且合计精确等于总额', () => {
    // 100 元 = 10000 分，分给 3 人：3333 × 3 = 9999，剩 1 分给第一人
    const result = evenSplits(OPENIDS, 10000)
    expect(result.map(function (item) { return item.amountCents })).toEqual([3334, 3333, 3333])
    const sum = result.reduce(function (total, item) { return total + item.amountCents }, 0)
    expect(sum).toBe(10000)
  })

  test('单人承担时拿全部金额', () => {
    expect(evenSplits(['oB'], 88)).toEqual([{ openid: 'oB', amountCents: 88 }])
  })

  test('空成员列表返回空数组（不抛错）', () => {
    expect(evenSplits([], 1000)).toEqual([])
  })

  test('不修改传入的 openids 数组', () => {
    const ids = ['oA', 'oB']
    evenSplits(ids, 100)
    expect(ids).toEqual(['oA', 'oB'])
  })

  // —— 极端边界 ——

  test('金额为 0 时每人分得 0，不报错', () => {
    const result = evenSplits(OPENIDS, 0)
    expect(result).toEqual([
      { openid: 'oA', amountCents: 0 },
      { openid: 'oB', amountCents: 0 },
      { openid: 'oC', amountCents: 0 }
    ])
    const sum = result.reduce(function (total, item) { return total + item.amountCents }, 0)
    expect(sum).toBe(0)
  })

  test('成员数组为空 / undefined 时兜底返回空数组（不抛错）', () => {
    expect(evenSplits([], 10000)).toEqual([])
    expect(evenSplits(undefined, 10000)).toEqual([])
    expect(evenSplits(null, 0)).toEqual([])
  })
})

// —— buildSettlement：余额计算 ——

describe('buildSettlement：每人差额（实付 - 应摊）', () => {
  test('单人垫付全部、三人平摊：付款人多出两份，其余各欠一份', () => {
    // A 付 300 元，三人平摊，每人 100 元
    const result = settle([expense(30000, 'oA', evenSplits(OPENIDS, 30000))])

    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oA.balanceCents).toBe(20000)   // +200 元（应收）
    expect(byId.oB.balanceCents).toBe(-10000)  // -100 元（应付）
    expect(byId.oC.balanceCents).toBe(-10000)
    expect(result.totalCents).toBe(30000)
  })

  test('零头分摊也能对上账（100 元 3 人）', () => {
    const result = settle([expense(10000, 'oA', evenSplits(OPENIDS, 10000))])
    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    // A 实付 10000，应摊 3334 → +6666
    expect(byId.oA.balanceCents).toBe(10000 - 3334)
    // B、C 各应摊 3333
    expect(byId.oB.balanceCents).toBe(-3333)
    expect(byId.oC.balanceCents).toBe(-3333)
    // 余额恒等式：所有差额之和必须为 0
    const sum = result.members.reduce(function (total, row) { return total + row.balanceCents }, 0)
    expect(sum).toBe(0)
  })

  test('自付自摊的账目不产生差额', () => {
    // A 付 50 元、只摊给自己
    const result = settle([expense(5000, 'oA', [{ openid: 'oA', amountCents: 5000 }])])
    result.members.forEach(function (row) {
      expect(row.balanceCents).toBe(0)
    })
    expect(result.transfers).toEqual([])
  })

  test('splits 为空数组时回退为「付款人自担」（不算给别人）', () => {
    const result = settle([expense(6000, 'oB', [])])
    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oB.balanceCents).toBe(0)
    expect(byId.oA.balanceCents).toBe(0)
    expect(byId.oC.balanceCents).toBe(0)
  })

  test('老数据（只有 splitWith、无 splits）按人数均摊', () => {
    // A 付 90 元，splitWith 标记 B、C：B、C 各欠 45 元，A 应收 90 元
    const result = settle([expense(9000, 'oA', null, { splitWith: ['oB', 'oC'] })])
    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oA.balanceCents).toBe(9000)
    expect(byId.oB.balanceCents).toBe(-4500)
    expect(byId.oC.balanceCents).toBe(-4500)
  })
})

// —— buildSettlement：双指针最少转账 ——

describe('buildSettlement：双指针转账方案', () => {
  test('单人垫付：两笔转账，全部转给付款人', () => {
    const result = settle([expense(30000, 'oA', evenSplits(OPENIDS, 30000))])
    expect(result.transfers).toHaveLength(2)
    expect(result.transfers).toEqual([
      { fromLabel: '小北', toLabel: '阿喆', amountCents: 10000 },
      { fromLabel: '老周', toLabel: '阿喆', amountCents: 10000 }
    ])
  })

  test('债务人与债权人不一一对应时，双指针自动拆分金额', () => {
    // 两笔账凑出目标差额：A +9000，B -1000，C -8000
    //   第一笔：A 付 15000，三人平摊 5000 → A +10000, B -5000, C -5000
    //   第二笔：B 付 6000，摊 A 1000、B 2000、C 3000 → A +9000, B -1000, C -8000
    const trip = makeTrip()
    const result = buildSettlement({
      trip: trip,
      items: [
        expense(15000, 'oA', [{ openid: 'oA', amountCents: 5000 }, { openid: 'oB', amountCents: 5000 }, { openid: 'oC', amountCents: 5000 }]),
        expense(6000, 'oB', [{ openid: 'oA', amountCents: 1000 }, { openid: 'oB', amountCents: 2000 }, { openid: 'oC', amountCents: 3000 }])
      ],
      labels: { oA: '阿喆', oB: '小北', oC: '老周' },
      order: OPENIDS.slice(),
      ctx: { openid: 'oA' }
    })

    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oA.balanceCents).toBe(9000)
    expect(byId.oB.balanceCents).toBe(-1000)
    expect(byId.oC.balanceCents).toBe(-8000)

    // 双指针：C→A 8000、B→A 1000，共 2 笔（只有 1 个债权人，2 笔已是最少）
    expect(result.transfers).toHaveLength(2)
    const sum = result.transfers.reduce(function (total, item) { return total + item.amountCents }, 0)
    expect(sum).toBe(9000)
  })

  test('多债务人多债权人：双指针逐笔清零，笔数最少', () => {
    // 目标差额：A +100、B +50、C -80、D -70（单位分）
    // 4 人行程 + 一笔 4 人自担各异的账即可构造
    const trip = {
      _id: 'trip-2',
      memberOpenids: ['oA', 'oB', 'oC', 'oD'],
      members: ['oA', 'oB', 'oC', 'oD'].map(function (openid, index) {
        return { openid: openid, name: '成员' + (index + 1), role: 'owner' }
      })
    }
    // A 付 100+50=150 分：摊 A 0、B 0、C 80、D 70
    // B 补一笔自付自摊 100 分摊给自己（不影响他人）
    const result = buildSettlement({
      trip: trip,
      items: [
        expense(150, 'oA', [
          { openid: 'oC', amountCents: 80 },
          { openid: 'oD', amountCents: 70 }
        ]),
        expense(100, 'oB', [{ openid: 'oB', amountCents: 100 }])
      ],
      labels: { oA: '成员1', oB: '成员2', oC: '成员3', oD: '成员4' },
      order: trip.memberOpenids.slice(),
      ctx: { openid: 'oA' }
    })

    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oA.balanceCents).toBe(150)   // 付 150，摊 0
    expect(byId.oB.balanceCents).toBe(0)     // 付 100，摊 100
    expect(byId.oC.balanceCents).toBe(-80)
    expect(byId.oD.balanceCents).toBe(-70)

    // 最少笔数 = 2：C→A 80、D→A 70
    expect(result.transfers).toHaveLength(2)
    expect(result.transfers).toEqual([
      { fromLabel: '成员3', toLabel: '成员1', amountCents: 80 },
      { fromLabel: '成员4', toLabel: '成员1', amountCents: 70 }
    ])
  })

  test('交叉债务：双指针会产生中间拆分笔（笔数仍最少）', () => {
    // 差额：A +100、B +50、C -80、D -70（构造出「C 要同时付给 A 和 B」的情形）
    const trip = {
      _id: 'trip-3',
      memberOpenids: ['oA', 'oB', 'oC', 'oD'],
      members: ['oA', 'oB', 'oC', 'oD'].map(function (openid, index) {
        return { openid: openid, name: '成' + (index + 1), role: 'owner' }
      })
    }
    // 第一笔：A 付 200，摊 A 0、B 0、C 120、D 80 → A +200, C -120, D -80
    // 第二笔：B 付 100，摊 A 100（其余自担 0）→ B -100, A -100 → A 净 +100
    // 等等——B 付 100 摊给 A 100：B 应摊 100 但实付 100 → B 余额 0？
    // 修正：第二笔 B 付 50，摊 A 100（B 多替 A 出 50 又自己担 0）→ B = -100+50 = -50
    // 重新凑：目标 A +100、B +50、C -80、D -70
    //   第一笔 A 付 250：摊 C 80、D 70、B 50、A 50 → A +200, B -50, C -80, D -70
    //   第二笔 B 付 100：摊 B 0、A 100 → A +100, B +50
    const result = buildSettlement({
      trip: trip,
      items: [
        expense(250, 'oA', [
          { openid: 'oA', amountCents: 50 },
          { openid: 'oB', amountCents: 50 },
          { openid: 'oC', amountCents: 80 },
          { openid: 'oD', amountCents: 70 }
        ]),
        expense(100, 'oB', [{ openid: 'oA', amountCents: 100 }])
      ],
      labels: { oA: '成1', oB: '成2', oC: '成3', oD: '成4' },
      order: trip.memberOpenids.slice(),
      ctx: { openid: 'oA' }
    })

    const byId = {}
    result.members.forEach(function (row) { byId[row.openid] = row })
    expect(byId.oA.balanceCents).toBe(100)
    expect(byId.oB.balanceCents).toBe(50)
    expect(byId.oC.balanceCents).toBe(-80)
    expect(byId.oD.balanceCents).toBe(-70)

    // 双指针运行轨迹：
    //   C(-80) × A(+100) → C→A 80（C 清零，A 剩 20）
    //   D(-70) × A(+20)  → D→A 20（A 清零，D 剩 -50）
    //   D(-50) × B(+50)  → D→B 50（双双清零）
    // 共 3 笔 = 4 人两两清算的最优解
    expect(result.transfers).toEqual([
      { fromLabel: '成3', toLabel: '成1', amountCents: 80 },
      { fromLabel: '成4', toLabel: '成1', amountCents: 20 },
      { fromLabel: '成4', toLabel: '成2', amountCents: 50 }
    ])
  })

  test('转账总额守恒：所有转账之和 = 所有应收之和 = 所有应付之和', () => {
    const items = [
      expense(30000, 'oA', evenSplits(OPENIDS, 30000)),
      expense(15800, 'oB', [{ openid: 'oA', amountCents: 3000 }, { openid: 'oB', amountCents: 5400 }, { openid: 'oC', amountCents: 7400 }]),
      expense(9700, 'oC', [{ openid: 'oA', amountCents: 3234 }, { openid: 'oB', amountCents: 3233 }, { openid: 'oC', amountCents: 3233 }])
    ]
    const result = settle(items)

    const payTotal = result.transfers.reduce(function (total, item) { return total + item.amountCents }, 0)
    const receiveTotal = result.members.reduce(function (total, row) {
      return total + (row.balanceCents > 0 ? row.balanceCents : 0)
    }, 0)
    const oweTotal = result.members.reduce(function (total, row) {
      return total + (row.balanceCents < 0 ? -row.balanceCents : 0)
    }, 0)

    expect(payTotal).toBe(receiveTotal)
    expect(payTotal).toBe(oweTotal)
  })

  test('没有账目时不产生转账', () => {
    const result = settle([])
    expect(result.transfers).toEqual([])
    expect(result.totalCents).toBe(0)
    expect(result.members).toHaveLength(3)
  })

  test('所有人互不相欠（各自平账）时不产生任何转账', () => {
    // A 垫付 100 分摊 50、B 垫付 100 分摊 50：每人实付 = 应摊，余额全为 0
    const result = settle([
      expense(100, 'oA', [{ openid: 'oA', amountCents: 50 }, { openid: 'oB', amountCents: 50 }]),
      expense(100, 'oB', [{ openid: 'oA', amountCents: 50 }, { openid: 'oB', amountCents: 50 }])
    ])
    result.members.forEach(function (row) {
      expect(row.balanceCents).toBe(0)
    })
    expect(result.transfers).toEqual([])
  })
})
