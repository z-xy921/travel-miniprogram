const expenseService = require('../../services/expense')
const tripService = require('../../services/trip')
const userService = require('../../services/user')
const { EXPENSE_CATEGORIES } = require('../../utils/constants')
const { moneyText, todayText, toCents } = require('../../utils/format')

function labelOf(member, selfOpenid) {
  const rawName = member.name
  const name = rawName && rawName !== '我' && rawName !== '同行' ? rawName : ''
  const tail = String(member.openid || '').slice(-4).toUpperCase()
  if (member.openid === selfOpenid) return name ? '我（' + name + '）' : '我 (' + tail + ')'
  if (name) return name + (member.role === 'owner' ? '（创建者）' : '')
  return (member.role === 'owner' ? '创建者 ' : '同行 ') + '(' + tail + ')'
}

Page({
  data: {
    tripId: '',
    expenseId: '',
    tripTitle: '',
    amount: '',
    amountText: '¥0.00',
    category: '餐饮',
    categories: EXPENSE_CATEGORIES,
    spentAt: todayText(),
    quick: [10, 20, 50, 100],
    note: '',
    saving: false,
    // AA：付款人 + 每人份额，单人行程时只有自己一行
    members: [],
    payerLabels: [],
    payerIndex: 0,
    splits: [],
    splitStatusText: '',
    splitBalanced: true
  },

  onLoad(query) {
    this.setData({ tripId: query.tripId || '', expenseId: query.expenseId || '' })
    if (query.expenseId) wx.setNavigationBarTitle({ title: '改这一笔' })
    this.loadTrip()
  },

  async loadTrip() {
    try {
      const results = await Promise.all([
        tripService.get(this.data.tripId),
        userService.me().catch(function () {
          return { openid: '' }
        })
      ])
      const trip = results[0].trip
      const selfOpenid = (results[1] && results[1].openid) || ''
      const members = trip.members || []
      let payerIndex = 0
      members.forEach(function (item, index) {
        if (item.openid === selfOpenid) payerIndex = index
      })

      this.setData({
        tripTitle: trip.title,
        members: members,
        payerLabels: members.map(function (item) {
          return labelOf(item, selfOpenid)
        }),
        payerIndex: payerIndex,
        splits: members.map(function (item) {
          return {
            openid: item.openid,
            label: labelOf(item, selfOpenid),
            checked: true,
            amountText: ''
          }
        })
      })
      this.recalcSplits()
      if (this.data.expenseId) this.loadExpense()
    } catch (err) {
      // 分摊只是辅助信息，行程拿不到时按单人记一笔即可
    }
  },

  // 编辑模式：把这一笔回填，付款人与各人份额都还原（老数据按 splitWith 均摊）
  async loadExpense() {
    const self = this
    try {
      const res = await expenseService.list(this.data.tripId)
      const item = (res.items || []).filter(function (row) {
        return row._id === self.data.expenseId
      })[0]
      if (!item) return

      const shares = {}
      if (Array.isArray(item.splits) && item.splits.length) {
        item.splits.forEach(function (row) {
          shares[row.openid] = Number(row.amountCents) || 0
        })
      } else {
        const list = (item.splitWith || []).filter(Boolean)
        const count = list.length || 1
        const base = Math.floor(item.amountCents / count)
        const rest = item.amountCents - base * count
        list.forEach(function (openid, index) {
          shares[openid] = base + (index === 0 ? rest : 0)
        })
      }

      const payerIndex = this.data.members
        .map(function (row) {
          return row.openid
        })
        .indexOf(item.paidBy)

      this.setData({
        amount: (item.amountCents / 100).toFixed(2),
        amountText: moneyText(item.amountCents),
        category: item.category || '其它',
        spentAt: item.spentAt || todayText(),
        note: item.note || '',
        payerIndex: payerIndex < 0 ? this.data.payerIndex : payerIndex,
        splits: this.data.splits.map(function (row) {
          const cents = shares[row.openid]
          return {
            openid: row.openid,
            label: row.label,
            checked: cents !== undefined,
            amountText: cents === undefined ? '' : (cents / 100).toFixed(2)
          }
        })
      })
      this.refreshStatus()
    } catch (err) {
      // 取不到就当成新记一笔，保存时仍是新增
    }
  },

  onAmount(e) {
    const amount = e.detail.value
    this.setData({ amount: amount, amountText: moneyText(toCents(amount)) })
    this.recalcSplits()
  },

  onQuick(e) {
    const value = e.currentTarget.dataset.value
    this.setData({ amount: String(value), amountText: moneyText(toCents(value)) })
    this.recalcSplits()
  },

  onCategory(e) {
    this.setData({ category: e.currentTarget.dataset.key })
  },

  onDate(e) {
    this.setData({ spentAt: e.detail.value })
  },

  onNote(e) {
    this.setData({ note: e.detail.value })
  },

  onPayer(e) {
    this.setData({ payerIndex: Number(e.detail.value) || 0 })
  },

  // 金额或参与人变化时重新均摊，除不尽的零头给第一个人
  recalcSplits() {
    if (!this.data.splits.length) {
      this.refreshStatus()
      return
    }

    const cents = toCents(this.data.amount)
    const checked = this.data.splits.filter(function (item) {
      return item.checked
    })
    const count = checked.length
    const base = count ? Math.floor(cents / count) : 0
    const rest = count ? cents - base * count : 0
    let seen = 0

    const splits = this.data.splits.map(function (item) {
      if (!item.checked) return Object.assign({}, item, { amountText: '' })
      const value = base + (seen === 0 ? rest : 0)
      seen++
      return Object.assign({}, item, { amountText: (value / 100).toFixed(2) })
    })

    this.setData({ splits: splits })
    this.refreshStatus()
  },

  // 手动改过份额后只提示差额，不自动抹平
  onSplitAmount(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ ['splits[' + index + '].amountText']: e.detail.value })
    this.refreshStatus()
  },

  onToggleSplit(e) {
    const index = Number(e.currentTarget.dataset.index)
    const checked = !this.data.splits[index].checked
    this.setData({ ['splits[' + index + '].checked']: checked })
    this.recalcSplits()
  },

  refreshStatus() {
    const total = toCents(this.data.amount)
    const sum = this.data.splits.reduce(function (acc, item) {
      return acc + (item.checked ? toCents(item.amountText) : 0)
    }, 0)
    const diff = total - sum
    const anyChecked = this.data.splits.some(function (item) {
      return item.checked
    })

    let text = ''
    if (!total) text = '先填金额'
    else if (!this.data.splits.length) text = '单人记录'
    else if (!anyChecked) text = '至少勾一个人'
    else if (diff === 0) text = '正好分完'
    else if (diff > 0) text = '还差 ' + moneyText(diff)
    else text = '多了 ' + moneyText(-diff)

    this.setData({ splitStatusText: text, splitBalanced: total > 0 && diff === 0 })
  },

  async onSave() {
    if (this.data.saving) return
    if (!toCents(this.data.amount)) {
      wx.showToast({ title: '请填写大于 0 的金额', icon: 'none' })
      return
    }

    const checked = this.data.splits.filter(function (item) {
      return item.checked
    })
    if (this.data.splits.length && !checked.length) {
      wx.showToast({ title: '至少要勾一个分摊的人', icon: 'none' })
      return
    }
    if (this.data.splits.length && !this.data.splitBalanced) {
      wx.showToast({ title: '分摊合计要等于金额（' + this.data.splitStatusText + '）', icon: 'none' })
      return
    }

    const payer = this.data.members[this.data.payerIndex]

    this.setData({ saving: true })
    try {
      await expenseService.save(this.data.tripId, {
        _id: this.data.expenseId,
        amount: this.data.amount,
        category: this.data.category,
        spentAt: this.data.spentAt,
        note: this.data.note,
        paidBy: payer ? payer.openid : '',
        splits: checked.map(function (item) {
          return { openid: item.openid, amount: item.amountText }
        })
      })
      wx.navigateBack()
    } catch (err) {
      this.setData({ saving: false })
    }
  }
})
