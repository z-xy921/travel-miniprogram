const expenseService = require('../../services/expense')
const { moneyText, moneyPlain, toDateText } = require('../../utils/format')

const app = getApp()

// 分类色板：图标 + 主色 + 浅底色，条形图和图例共用一套
const CATEGORY_META = {
  交通: { icon: '🚕', color: '#3b82f6', tint: '#eff6ff' },
  餐饮: { icon: '🍜', color: '#f59e0b', tint: '#fffbeb' },
  门票: { icon: '🎫', color: '#8b5cf6', tint: '#f5f3ff' },
  住宿: { icon: '🏨', color: '#10b981', tint: '#ecfdf5' },
  购物: { icon: '🛍️', color: '#ec4899', tint: '#fdf2f8' },
  其它: { icon: '🧾', color: '#94a3b8', tint: '#f1f5f9' }
}

function metaOf(category) {
  return CATEGORY_META[category] || CATEGORY_META['其它']
}

// 明细金额去掉无意义的 .00，读起来更干净
function shortMoney(cents) {
  const plain = moneyPlain(cents)
  return '¥' + (plain.slice(-3) === '.00' ? plain.slice(0, -3) : plain)
}

function groupByDate(items) {
  const map = {}
  const order = []

  items.forEach(function (item) {
    const key = item.spentAt || ''
    if (!map[key]) {
      map[key] = { date: key, dateText: toDateText(key), items: [], totalCents: 0 }
      order.push(key)
    }
    const meta = metaOf(item.category)
    // 非自己付的那几笔直接把付款人写进描述，一眼看出谁垫的
    const payer = item.paidByName || ''
    const prefix = payer && payer.indexOf('我') !== 0 ? payer + ' - ' : ''
    map[key].items.push({
      _id: item._id,
      icon: meta.icon,
      tint: meta.tint,
      note: prefix + (item.note || item.category || '—'),
      amountText: '- ' + shortMoney(item.amountCents)
    })
    map[key].totalCents += Number(item.amountCents) || 0
  })

  return order.map(function (key) {
    const group = map[key]
    return {
      date: group.date,
      dateText: group.dateText,
      items: group.items,
      totalText: shortMoney(group.totalCents)
    }
  })
}

Page({
  data: {
    tripId: '',
    trip: null,
    groups: [],
    summary: null,
    debt: null,
    loading: true,
    error: '',
    needLogin: false
  },

  onLoad(query) {
    this.setData({ tripId: query.tripId || '' })
  },

  onShow() {
    // 游客模式：账单是隐私数据，不强制跳转，只展示登录引导
    if (!app.isLogin()) {
      this.setData({ loading: false, error: '', groups: [], summary: null, debt: null, needLogin: true })
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
      const results = await Promise.all([
        expenseService.list(this.data.tripId),
        expenseService.settle(this.data.tripId)
      ])
      const res = results[0]
      const settle = results[1]
      const summary = res.summary
      const totalCents = summary.totalCents || 0

      // 结算里带 self 标记，直接取自己的垫付与应摊
      const self = (settle.members || []).filter(function (row) {
        return row.self
      })[0] || { paidCents: 0, owedCents: 0, label: '' }
      const transfers = settle.transfers || []
      const owesMe = transfers.filter(function (row) {
        return row.toLabel === self.label
      })
      const iOwe = transfers.filter(function (row) {
        return row.fromLabel === self.label
      })

      let debt = null
      if (owesMe.length) {
        debt = {
          tone: 'warn',
          text: owesMe.map(function (row) {
            return row.fromLabel + ' 欠你 ' + moneyText(row.amountCents)
          }).join('，')
        }
      } else if (iOwe.length) {
        debt = {
          tone: 'info',
          text: iOwe.map(function (row) {
            return '你欠 ' + row.toLabel + ' ' + moneyText(row.amountCents)
          }).join('，')
        }
      }

      const bars = (summary.byCategory || []).map(function (item) {
        const meta = metaOf(item.category)
        return {
          category: item.category,
          text: moneyText(item.cents),
          color: meta.color,
          width: totalCents ? Math.round((item.cents * 100) / totalCents) : 0
        }
      })

      const settleLines = ['【AA 结算】' + res.trip.title, '总支出 ' + moneyText(totalCents)]
      const transferLines = transfers.length
        ? transfers.map(function (row) {
          return row.fromLabel + ' → ' + row.toLabel + ' ' + moneyText(row.amountCents)
        })
        : ['当前已经结清，无需转账']
      const settleText = settleLines.concat(transferLines).join('\n')

      this.setData({
        trip: res.trip,
        groups: groupByDate(res.items || []),
        debt: debt,
        settleText: settleText,
        summary: {
          totalText: moneyText(totalCents),
          countText: summary.count + ' 笔',
          paidText: moneyText(self.paidCents),
          owedText: moneyText(self.owedCents),
          bars: bars,
          legend: bars
        },
        loading: false,
        error: ''
      })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  // 结算文案复制到剪贴板，粘到群里就能对账
  onCopySettle() {
    const text = this.data.settleText || ''
    if (!text) return
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '结算单已复制', icon: 'none' })
      }
    })
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
