const photoService = require('../../services/photo')
const { parseDate } = require('../../utils/format')

const MAX_PICK = 9

function dayLabel(day) {
  const date = parseDate(day.date)
  const short = date ? date.getMonth() + 1 + '/' + date.getDate() : ''
  return 'D' + (day.index + 1) + ' ' + short
}

function timeLabel(ts) {
  const date = new Date(Number(ts) || Date.now())
  const hour = date.getHours()
  const minute = date.getMinutes()
  return (hour < 10 ? '0' + hour : hour) + ':' + (minute < 10 ? '0' + minute : minute)
}

Page({
  data: {
    tripId: '',
    loading: true,
    error: '',
    trip: null,
    tabs: [],
    activeDay: 0,
    photos: [],
    dayPhotos: [],
    saving: false
  },

  onLoad(query) {
    this.setData({ tripId: query.tripId || '' })
  },

  onShow() {
    if (this.data.tripId) this.load()
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh()
    })
  },

  async load() {
    try {
      const res = await photoService.list(this.data.tripId)
      this.apply(res.trip, res.items || [])
      this.setData({ loading: false, error: '' })
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  onRetry() {
    this.load()
  },

  apply(trip, items) {
    const photos = items.map(function (item) {
      return Object.assign({}, item, { timeText: timeLabel(item.createdAt) })
    })

    // 日期格上顺手带上张数，不用点进去才知道哪天有照片
    const tabs = (trip.days || []).map(function (day) {
      let count = 0
      photos.forEach(function (item) {
        if (item.dayIndex === day.index) count += 1
      })
      return { index: day.index, label: dayLabel(day) + (count ? ' · ' + count : '') }
    })

    let activeDay = Number(this.data.activeDay)
    if (!isFinite(activeDay) || activeDay < 0 || activeDay >= tabs.length) activeDay = 0

    this.setData({
      trip: trip,
      tabs: tabs,
      activeDay: activeDay,
      photos: photos,
      dayPhotos: photos.filter(function (item) {
        return item.dayIndex === activeDay
      })
    })
  },

  onDayChange(e) {
    const index = Number(e.detail.index) || 0
    this.setData({
      activeDay: index,
      dayPhotos: this.data.photos.filter(function (item) {
        return item.dayIndex === index
      })
    })
  },

  onAddPhoto() {
    if (this.data.saving) return
    const that = this
    wx.chooseMedia({
      count: MAX_PICK,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        that.uploadAll(res.tempFiles || [])
      }
    })
  },

  // 逐张上传：先传云存储拿 fileID，再写一条 files 记录
  async uploadAll(files) {
    if (!files.length) return
    this.setData({ saving: true })
    wx.showLoading({ title: '上传 0/' + files.length, mask: true })

    let done = 0
    let failed = false
    const that = this
    for (let i = 0; i < files.length; i++) {
      try {
        const matched = /\.(\w+)$/.exec(files[i].tempFilePath)
        const name = Date.now() + '-' + i + (matched ? '.' + matched[1] : '.jpg')
        const uploaded = await wx.cloud.uploadFile({
          cloudPath: 'journal/' + that.data.tripId + '/' + name,
          filePath: files[i].tempFilePath
        })
        await photoService.add(that.data.tripId, uploaded.fileID, that.data.activeDay)
        done += 1
        wx.showLoading({ title: '上传 ' + done + '/' + files.length, mask: true })
      } catch (err) {
        // run() 已经弹过具体错误，这里只记一笔，接着传下一张
        failed = true
      }
    }

    wx.hideLoading()
    this.setData({ saving: false })
    if (done && !failed) wx.showToast({ title: '加了 ' + done + ' 张', icon: 'none' })
    await this.load()
  },

  // 云存储 fileID 能直接渲染，但预览大图要用临时链接
  async onPreview(e) {
    const index = Number(e.currentTarget.dataset.index) || 0
    const list = this.data.dayPhotos
    const ids = list.map(function (item) {
      return item.fileID
    })

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: ids })
      const urls = (res.fileList || []).map(function (item) {
        return item.tempFileURL
      })
      if (!urls[index]) throw new Error('no url')
      wx.previewImage({ current: urls[index], urls: urls })
    } catch (err) {
      wx.showToast({ title: '大图打不开，稍后再试', icon: 'none' })
    }
  },

  onRemovePhoto(e) {
    const item = this.data.dayPhotos[Number(e.currentTarget.dataset.index)]
    if (!item) return
    const that = this

    wx.showModal({
      title: '删掉这张照片？',
      content: '从手帐里移除这一张，云存储里的原图先保留。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: async function (res) {
        if (!res.confirm) return
        try {
          await photoService.remove(that.data.tripId, item._id)
          await that.load()
        } catch (err) {
          // run() 已经提示
        }
      }
    })
  }
})
