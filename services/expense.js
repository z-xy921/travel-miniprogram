const { call, run } = require('./cloud')

module.exports = {
  list(tripId) {
    return call('expense.list', { tripId: tripId })
  },

  // 记账 Tab 用：一次拿到所有行程的花费合计
  overview() {
    return call('expense.overview')
  },

  save(tripId, expense) {
    return run('expense.save', { tripId: tripId, expense: expense }, '保存中')
  },

  remove(tripId, expenseId) {
    return run('expense.remove', { tripId: tripId, expenseId: expenseId }, '删除中')
  },

  // AA 结算：服务端算实付/应摊/差额与转账建议
  settle(tripId) {
    return call('expense.settle', { tripId: tripId })
  }
}
