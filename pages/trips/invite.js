const tripService = require('../../services/trip')

function expireText(ts) {
  if (!ts) return ''
  const date = new Date(Number(ts))
  return date.getMonth() + 1 + '/' + date.getDate()
}

Page({
  data: {
    tripId: '',
    loading: true,
    error: '',
    trip: null,
    isOwner: false,
    inviteCode: '',
    expireText: '',
    memberCount: 1,
    members: []
  },

  onLoad(query) {
    this.setData({ tripId: (query && query.id) || '' })
  },

  onShow() {
    if (this.data.tripId) this.load()
  },

  async load() {
    try {
      const res = await tripService.get(this.data.tripId)
      await this.apply(res.trip)
      this.setData({ loading: false, error: '' })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  async apply(trip) {
    const isOwner = trip.myRole === 'owner'
    this.setData({
      trip: trip,
      isOwner: isOwner,
      memberCount: Math.max(1, (trip.members || []).length),
      members: (trip.members || []).map(function (item) {
        // 登录过的成员有真实昵称/头像；老数据回退到 openid 尾号
        const nickname = item.name && item.name !== '我' && item.name !== '同行' ? item.name : ''
        return {
          openid: item.openid,
          name: nickname || '成员 ' + String(item.openid || '').slice(-4).toUpperCase(),
          avatar: item.avatar || '',
          roleText: item.role === 'owner' ? '创建者' : '同行',
          isOwner: item.role === 'owner'
        }
      })
    })

    if (!isOwner) return

    // 只有创建者能生成邀请码；没生成或已过期时服务端会给新的
    try {
      const inv = await tripService.invite(trip._id)
      this.setData({ inviteCode: inv.inviteCode, expireText: expireText(inv.inviteExpireAt) })
    } catch (err) {
      // run() 已提示
    }
  },

  onRetry() {
    this.load()
  },

  onCopy() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  onRemoveMember(e) {
    const that = this
    const openid = e.currentTarget.dataset.openid
    if (!openid) return

    wx.showModal({
      title: '移除这位同行？',
      content: '移除后他看不到这趟行程，之前的改动会保留。',
      confirmText: '移除',
      confirmColor: '#b91c1c',
      success: async function (res) {
        if (!res.confirm) return
        try {
          const out = await tripService.removeMember(that.data.tripId, openid)
          await that.apply(out.trip)
        } catch (err) {
          // run() 已提示
        }
      }
    })
  },

  // 退出后这趟就从列表消失，直接回行程 Tab，避免详情页再报没权限
  onLeave() {
    const that = this
    wx.showModal({
      title: '退出这趟行程？',
      content: '退出后你看不到这趟的安排，之前加的地点和账目会留给其他人。',
      confirmText: '退出',
      confirmColor: '#b91c1c',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await tripService.leave(that.data.tripId)
          wx.switchTab({ url: '/pages/trips/list' })
        } catch (err) {
          // run() 已提示
        }
      }
    })
  },

  // 分享卡片直达加入页：对方点开就知道要加入哪一趟
  onShareAppMessage() {
    const trip = this.data.trip
    return {
      title: trip ? '一起排「' + trip.title + '」的行程' : '一起排行程',
      path: '/pages/trips/join?id=' + this.data.tripId
    }
  }
})
