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
    saving: false,
    // 批量上传的进度，用一个弹窗展示，不再逐张弹 loading
    uploading: false,
    uploadDone: 0,
    uploadTotal: 0,
    uploadPercent: 0,
    // 相册式管理模式：勾选多张后一次性删除
    isManaging: false,
    selectedPhotos: [],
    // 当前天是否已全部勾选，用于顶部「全选/取消全选」
    isAllSelected: false,
    deleting: false,
    // Day 胶囊滚动条：两端箭头只在有内容被截断时出现
    showLeftArrow: false,
    showRightArrow: true,
    dayScrollLeft: 0,
    dayScrollInto: ''
  },

  onLoad(query) {
    this.setData({ tripId: query.tripId || '' })
    // 滚动状态放实例上，bindscroll 高频触发，不能每帧 setData
    this.dayScrollLeft = 0
    this.dayMax = 0
    this.dayWidth = 0
  },

  onReady() {
    this.measureTabs()
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

  // 给当天照片打上选中标记，WXML 里不能调函数，只能预计算
  markSelected(list, ids) {
    return list.map(function (item) {
      return Object.assign({}, item, { selected: ids.indexOf(item._id) >= 0 })
    })
  },

  // 当天视图的统一出口：勾选标记 + 「是否全选」，所有入口都走这里，状态不会漂
  computeDayView(dayIndex, allPhotos) {
    const source = allPhotos || this.data.photos
    const dayList = source.filter(function (item) {
      return item.dayIndex === dayIndex
    })
    const marked = this.markSelected(dayList, this.data.selectedPhotos)
    const allSelected = dayList.length > 0 && marked.every(function (item) {
      return item.selected
    })
    return { dayPhotos: marked, isAllSelected: allSelected }
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

    const view = this.computeDayView(activeDay, photos)

    this.setData({
      trip: trip,
      tabs: tabs,
      activeDay: activeDay,
      photos: photos,
      dayPhotos: view.dayPhotos,
      isAllSelected: view.isAllSelected,
      dayScrollInto: 'day-' + activeDay
    })
    // 天数变化后胶囊总宽会变，等渲染完重新量一次
    wx.nextTick(() => this.measureTabs())
  },

  // 页面内联的胶囊 tab 直接给 dataset.index，保留 detail 兼容写法
  onDayChange(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.index
      : e && e.detail && e.detail.index
    const index = Number(raw) || 0
    const view = this.computeDayView(index)
    this.setData({
      activeDay: index,
      dayPhotos: view.dayPhotos,
      isAllSelected: view.isAllSelected,
      dayScrollInto: 'day-' + index
    })
  },

  // —— Day 滚动条：箭头显隐 + 点击滑动 ——
  measureTabs() {
    const query = wx.createSelectorQuery()
    query.select('.day-scroll').boundingClientRect()
    query.select('.day-track').boundingClientRect()
    query.exec((res) => {
      if (!res || !res[0] || !res[1]) return
      this.dayWidth = res[0].width || 0
      this.dayMax = Math.max((res[1].width || 0) - this.dayWidth, 0)
      this.syncArrows(this.dayScrollLeft, this.dayMax)
    })
  },

  // 只有跨越阈值才 setData，避免滚动过程疯狂重渲染
  syncArrows(scrollLeft, max) {
    const showLeft = scrollLeft > 4
    const showRight = max > 4 && scrollLeft < max - 4
    if (showLeft !== this.data.showLeftArrow || showRight !== this.data.showRightArrow) {
      this.setData({ showLeftArrow: showLeft, showRightArrow: showRight })
    }
  },

  onDayScroll(e) {
    const detail = e.detail || {}
    this.dayScrollLeft = detail.scrollLeft || 0
    this.dayMax = Math.max((detail.scrollWidth || 0) - this.dayWidth, 0)
    this.syncArrows(this.dayScrollLeft, this.dayMax)
  },

  // 点箭头：往左/右挪一屏的 2/3，clamp 在合法区间，scroll-left 自带动画
  onArrowTap(e) {
    if (this.data.uploading) return
    const dir = e.currentTarget.dataset.dir === 'left' ? -1 : 1
    const step = Math.max(this.dayWidth * 2 / 3, 120)
    const target = Math.min(Math.max(this.dayScrollLeft + dir * step, 0), this.dayMax)
    if (Math.abs(target - this.dayScrollLeft) < 1) return
    this.dayScrollLeft = target
    this.setData({ dayScrollLeft: target })
  },

  // —— 管理模式 ——
  onToggleManage() {
    this.setData({
      isManaging: !this.data.isManaging,
      selectedPhotos: []
    })
    this.refreshSelection()
  },

  // 选中集合变化后，重算当前天的标记和「是否全选」
  refreshSelection() {
    const view = this.computeDayView(this.data.activeDay)
    this.setData({
      dayPhotos: view.dayPhotos,
      isAllSelected: view.isAllSelected
    })
  },

  // 全选只作用于当前天：选 = 补齐当天所有照片；取消全选 = 清空勾选
  onToggleSelectAll() {
    const ids = this.data.selectedPhotos.slice()
    if (this.data.isAllSelected) {
      this.setData({ selectedPhotos: [] })
    } else {
      this.data.photos.forEach(function (item) {
        if (item.dayIndex === this.data.activeDay && ids.indexOf(item._id) < 0) {
          ids.push(item._id)
        }
      }, this)
      this.setData({ selectedPhotos: ids })
    }
    this.refreshSelection()
  },

  // 管理态点照片 = 勾选/取消；浏览态点照片 = 预览大图
  onPhotoTap(e) {
    if (this.data.isManaging) {
      const id = e.currentTarget.dataset.id
      const ids = this.data.selectedPhotos.slice()
      const pos = ids.indexOf(id)
      if (pos >= 0) ids.splice(pos, 1)
      else ids.push(id)
      this.setData({ selectedPhotos: ids })
      this.refreshSelection()
      return
    }
    this.onPreview(e)
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

  // 上传期间挡住底层滚动，避免遮罩后面的页面跟着动
  preventTouchMove() {},

  // 逐张上传：先传云存储拿 fileID，再写一条 files 记录。
  // 全程只在 data 里维护 uploading，绝不调用 wx.showLoading，避免逐张闪烁
  async uploadAll(files) {
    if (!files.length) return
    const total = files.length
    this.setData({
      saving: true,
      uploading: true,
      uploadDone: 0,
      uploadTotal: total,
      uploadPercent: 0
    })

    let success = 0
    const that = this
    for (let i = 0; i < total; i++) {
      try {
        const matched = /\.(\w+)$/.exec(files[i].tempFilePath)
        const name = Date.now() + '-' + i + (matched ? '.' + matched[1] : '.jpg')
        const uploaded = await wx.cloud.uploadFile({
          cloudPath: 'journal/' + that.data.tripId + '/' + name,
          filePath: files[i].tempFilePath
        })
        await photoService.add(that.data.tripId, uploaded.fileID, that.data.activeDay)
        success += 1
      } catch (err) {
        // run() 已经弹过具体错误，这里只记失败张数，接着传下一张
      }
      // 进度按“已处理”推进，失败的也算跑过，不会卡在半路
      that.setData({
        uploadDone: i + 1,
        uploadPercent: Math.round(((i + 1) / total) * 100)
      })
    }

    const failed = total - success
    this.setData({ saving: false, uploading: false })
    if (failed > 0) {
      wx.showToast({ title: '有 ' + failed + ' 张照片上传失败，请重试', icon: 'none' })
    } else {
      wx.showToast({ title: '加了 ' + success + ' 张', icon: 'none' })
    }
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

  // 批量删除：一次确认，循环调现有接口，全跑完再统一反馈
  onDeleteSelected() {
    const ids = this.data.selectedPhotos
    if (!ids.length || this.data.deleting) return
    const that = this

    wx.showModal({
      title: '删除照片',
      content: '确定要删除选中的 ' + ids.length + ' 张照片吗？',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: async function (res) {
        if (!res.confirm) return
        that.setData({ deleting: true })
        wx.showLoading({ title: '删除中', mask: true })

        let failed = 0
        for (let i = 0; i < ids.length; i++) {
          try {
            await photoService.remove(that.data.tripId, ids[i])
          } catch (err) {
            failed += 1
          }
        }

        wx.hideLoading()
        that.setData({ deleting: false })
        if (failed > 0) {
          wx.showToast({ title: failed + ' 张删除失败，请重试', icon: 'none' })
        }
        that.setData({ isManaging: false, selectedPhotos: [] })
        await that.load()
      }
    })
  }
})
