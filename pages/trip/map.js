const poiService = require('../../services/poi')
const location = require('../../utils/location')
const { parseDate } = require('../../utils/format')

function dayLabel(day) {
  const date = parseDate(day.date)
  const short = date ? date.getMonth() + 1 + '/' + date.getDate() : ''
  return 'D' + (day.index + 1) + ' ' + short
}

Page({
  data: {
    tripId: '',
    loading: true,
    error: '',
    tabs: [],
    activeDay: 0,
    markers: [],
    center: { latitude: 31.2304, longitude: 121.4737 },
    scale: 12,
    placed: 0,
    total: 0,
    current: null,
    // 位置权限用户自己点开才请求，不在进页时弹授权
    showMine: false
  },

  onLoad(query) {
    this.setData({
      tripId: query.tripId || '',
      activeDay: Number(query.day) || 0
    })
    this.load()
  },

  async load() {
    try {
      const res = await poiService.list(this.data.tripId)
      this.trip = res.trip
      this.pois = res.items || []
      this.setData({
        // day-tabs 需要 { index, label }
        tabs: (res.trip.days || []).map(function (day) {
          return { index: day.index, label: dayLabel(day) }
        }),
        loading: false,
        error: ''
      })
      this.render()
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败' })
    }
  },

  // 只画有坐标的点：没坐标的诚实告诉用户，不猜位置
  render() {
    const activeDay = Number(this.data.activeDay) || 0
    const dayList = this.pois.filter(function (poi) {
      return poi.dayIndex === activeDay
    })
    const located = dayList.filter(function (poi) {
      return poi.location && poi.location.latitude
    })

    const markers = located.map(function (poi, index) {
      return {
        id: index + 1,
        latitude: poi.location.latitude,
        longitude: poi.location.longitude,
        width: 24,
        height: 32,
        callout: {
          content: index + 1 + '. ' + poi.name,
          color: '#1f2328',
          fontSize: 12,
          bgColor: '#ffffff',
          padding: 6,
          borderRadius: 6,
          display: 'ALWAYS'
        }
      }
    })

    let center = this.data.center
    if (located.length) {
      let lat = 0
      let lng = 0
      located.forEach(function (poi) {
        lat += poi.location.latitude
        lng += poi.location.longitude
      })
      center = { latitude: lat / located.length, longitude: lng / located.length }
    }

    this.dayList = located
    this.setData({
      markers: markers,
      center: center,
      placed: located.length,
      total: dayList.length,
      current: null
    })
  },

  onDayChange(e) {
    this.setData({ activeDay: Number(e.detail.index) || 0 })
    this.render()
  },

  onMarkerTap(e) {
    const poi = this.dayList[e.detail.markerId - 1]
    if (poi) this.setData({ current: poi })
  },

  onCloseCard() {
    this.setData({ current: null })
  },

  // 用户主动要看自己位置时才要授权；拒绝了也能继续看行程点位
  async onLocateMe() {
    if (this.locating) return
    this.locating = true
    try {
      const pos = await location.getCurrent()
      if (!pos) return
      this.setData({ showMine: true })
      wx.createMapContext('tripMap', this).moveToLocation({
        latitude: pos.latitude,
        longitude: pos.longitude
      })
    } finally {
      this.locating = false
    }
  },

  onNavigate() {
    const poi = this.data.current
    if (!poi || !poi.location) return
    wx.openLocation({
      latitude: poi.location.latitude,
      longitude: poi.location.longitude,
      name: poi.name,
      address: poi.address || '',
      scale: 18
    })
  }
})
