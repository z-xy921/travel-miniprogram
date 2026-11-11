function copy(text, tip) {
  if (!text) return
  wx.setClipboardData({
    data: text,
    success() {
      // 部分基础库 setClipboardData 自带「内容已复制」提示，先藏掉再给自己的
      wx.hideToast()
      wx.showToast({ title: tip || '已复制', icon: 'none' })
    },
    fail() {
      wx.showToast({ title: '复制失败，请长按选择', icon: 'none' })
    }
  })
}

module.exports = { copy }
