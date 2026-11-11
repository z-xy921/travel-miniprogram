const expenseService = require('../../services/expense')
const { moneyText, toDateText } = require('../../utils/format')

const app = getApp()

function groupByDate(items) {
  const map = {}
  const order = []

  items.forEach(function (item) {
    const key = item.spentAt || ''
    if (!map[key]) {
      map[key] = { date: key, dateText: toDateText(key), items: [], totalCents: 0 }
      order.push(key)
    }
    // 非自己付的那几笔直接把付款人写进描述，一眼看出谁垫的
    const payer = item.paidByName || ''
    const prefix = payer && payer.indexOf('我') !== 0 ? payer + ' · ' : ''
    map[key].items.push({
      _id: item._id,
      category: item.category,
      note: prefix + (item.note || '—'),
      amountText: moneyText(item.amountCents)
    })
    map[key].totalCents += item.amountCents
  })

  return order.map(function (key) {
    const group = map[key]
    return {
      date: group.date,
      dateText: group.dateText,
      items: group.items,
      totalText: moneyText(group.totalCents)
    }
  })
}

// 预算只在填过时才算：没填就不显示进度条，避免“预算 0 已超支”的怪话
function budgetOf(trip, totalCents) {
  const budget = Number(trip.budgetCents) || 0
  if (!budget) return null
  const left = budget - totalCents
  return {
    budgetText: moneyText(budget),
    leftText: moneyText(Math.abs(left)),
    exceeded: left < 0,
    percent: Math.min(100, Math.round((totalCents * 100) / budget))
  }
}

Page({
  data: {
    tripId: '',
    trip: null,
    groups: [],
    summary: null,
    loading: true,
    error: '',
    needLogin: false,
    showSettle: false,
    settle: null
  },

  onLoad(query) {
    this.setData({ tripId: query.tripId || '' })
  },

  onShow() {
    // 游客模式：账单是隐私数据，不强制跳转，只展示登录引导
    if (!app.isLogin()) {
      this.setData({ loading: false, error: '', groups: [], summary: null, needLogin: true })
      return
    }
    this.setData({ needLogin: false })
    if (this.data.tripId) this.load()
  },

  onGoLogin() {
    app.gotoLogin()
  },

  async load() {
    try {
      const res = await expenseService.list(this.data.tripId)
      const summary = res.summary
      const totalCents = summary.totalCents || 0

      this.setData({
        trip: res.trip,
        groups: groupByDate(res.items || []),
        summary: {
          totalText: moneyText(totalCents),
          countText: summary.count + ' 笔',
          dayAvgText: moneyText(Math.round(totalCents / ((res.trip.days || []).length || 1))),
          bars: (summary.byCategory || []).map(function (item) {
            return {
              category: item.category,
              text: moneyText(item.cents),
              width: totalCents ? Math.round((item.cents * 100) / totalCents) : 0
            }
          }),
          budget: budgetOf(res.trip, totalCents)
        },
        loading: false,
        error: '',
        // 明细变了，结算结果也不能用旧的
        settle: null
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/expense/add?tripId=' + this.data.tripId })
  },

  // 点一条就改：复用记账页，带 expenseId 进去就是编辑
  onEdit(e) {
    wx.navigateTo({
      url: '/pages/expense/add?tripId=' + this.data.tripId + '&expenseId=' + e.currentTarget.dataset.id
    })
  },

  async onToggleSettle() {
    if (this.data.showSettle) {
      this.setData({ showSettle: false })
      return
    }

    if (!this.data.settle) {
      try {
        const res = await expenseService.settle(this.data.tripId)
        this.setData({ settle: this.formatSettle(res) })
      } catch (err) {
        return
      }
    }
    this.setData({ showSettle: true })
  },

  formatSettle(res) {
    return {
      members: (res.members || []).map(function (item) {
        return {
          openid: item.openid,
          label: item.label,
          paidText: moneyText(item.paidCents),
          owedText: moneyText(item.owedCents),
          balanceText: (item.balanceCents > 0 ? '+' : item.balanceCents < 0 ? '-' : '') + moneyText(Math.abs(item.balanceCents)),
          owe: item.balanceCents < 0
        }
      }),
      transfers: (res.transfers || []).map(function (item, index) {
        return {
          key: 't' + index,
          text: item.fromLabel + ' 给 ' + item.toLabel + ' ' + moneyText(item.amountCents)
        }
      })
    }
  },

  onRemove(e) {
    const that = this
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这笔记录？',
      content: '删除后统计会立刻更新。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await expenseService.remove(that.data.tripId, id)
          await that.load()
          wx.showToast({ title: '已删除', icon: 'none' })
        } catch (err) {
          // 已提示
        }
      }
    })
  },

  onRetry() {
    this.load()
  }
})
