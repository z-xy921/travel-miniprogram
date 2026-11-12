const poiService = require('../../services/poi')
const tripService = require('../../services/trip')
const location = require('../../utils/location')
const { matchCity, searchCities } = require('../../utils/cities')
const { DURATIONS, POI_CATEGORIES } = require('../../utils/constants')

function emptyForm(time) {
  return {
    name: '',
    address: '',
    location: null,
    category: '景点',
    plannedTime: time || '',
    durationMin: 60,
    facts: { open: '', reserve: '', fee: '' },
    factsPending: true,
    note: ''
  }
}

// 选点偏离目的地城市的判定阈值（km）：超过视为定位漂移或选错城市
const DEVIATION_KM = 150

// 两点球面距离（km）
function distanceKm(a, b) {
  const rad = Math.PI / 180
  const dLat = (a.latitude - b.latitude) * rad
  const dLng = (a.longitude - b.longitude) * rad
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * 6371 * Math.asin(Math.sqrt(s))
}

function coordText(location) {
  if (!location || !location.latitude) return ''
  return Number(location.latitude).toFixed(4) + ', ' + Number(location.longitude).toFixed(4)
}

Page({
  data: {
    tripId: '',
    dayIndex: 0,
    poiId: '',
    categories: POI_CATEGORIES,
    durations: DURATIONS,
    form: emptyForm(''),
    dayText: 'D1',
    located: false,
    saving: false,
    // 行程版本号：保存时带回去，发现过期就让用户选覆盖还是放弃
    version: 0,
    coordText: '',
    // 选点地图的初始中心，避免异地规划时地图落在你当前所在城市
    center: null,
    cityText: '',
    // 顶部那行极小的「定位参考」文案，城市选择收进弹层，不再占一个表单项
    cityHint: '我的当前位置',
    showCity: false,
    cityQuery: '',
    cityOptions: [],
    pickedName: '',
    pickedAddress: ''
  },

  onLoad(query) {
    const poiId = query.poiId || ''
    const dayIndex = Number(query.day) || 0
    this.setData({
      tripId: query.tripId || '',
      dayIndex: dayIndex,
      poiId: poiId,
      dayText: 'D' + (dayIndex + 1),
      form: emptyForm(query.time || '')
    })
    wx.setNavigationBarTitle({ title: poiId ? '编辑地点' : '添加地点' })
    this.load()
  },

  // 一次请求同时拿到 trip 和已有地点：既用于编辑回填，也用于推算选点中心
  async load() {
    try {
      const res = await poiService.list(this.data.tripId)
      const trip = res.trip || {}
      const items = res.items || []

      this.setData({ version: trip.version || 0 })

      // 选点初始视野与偏离校验的基础数据
      this.pois = items
      this.destination = trip.destination || trip.title || ''
      const city = matchCity(this.destination)
      this.cityCenter = city ? { latitude: city.latitude, longitude: city.longitude } : null

      const dayCenter = this.nearestDayCenter()
      let center = dayCenter
      let cityText = ''
      if (!center && this.cityCenter) {
        center = this.cityCenter
        cityText = city.name
      }

      if (!this.data.poiId) {
        this.setData({
          center: center,
          cityText: cityText,
          cityHint: cityText || (dayCenter ? '行程已有地点附近' : '我的当前位置')
        })
        return
      }

      const poi = items.filter(function (item) {
        return item._id === this.data.poiId
      })[0]
      if (!poi) throw new Error('地点不存在或已被删除')

      if (poi.location && poi.location.latitude) {
        center = { latitude: poi.location.latitude, longitude: poi.location.longitude }
        cityText = ''
      }

      this.setData({
        dayIndex: poi.dayIndex,
        dayText: 'D' + (poi.dayIndex + 1),
        located: !!poi.location,
        coordText: coordText(poi.location),
        center: center,
        cityText: cityText,
        pickedName: poi.name || '',
        pickedAddress: poi.address || '',
        form: {
          name: poi.name,
          address: poi.address || '',
          location: poi.location || null,
          category: poi.category || '景点',
          plannedTime: poi.plannedTime || '',
          durationMin: poi.durationMin || 60,
          facts: Object.assign({ open: '', reserve: '', fee: '' }, poi.facts || {}),
          factsPending: poi.factsPending !== false,
          note: poi.note || ''
        }
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onFactInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['form.facts.' + key]: e.detail.value })
  },

  onCategory(e) {
    this.setData({ 'form.category': e.currentTarget.dataset.key })
  },

  onDuration(e) {
    this.setData({ 'form.durationMin': Number(e.currentTarget.dataset.key) })
  },

  onTime(e) {
    this.setData({ 'form.plannedTime': e.detail.value })
  },

  onPending(e) {
    this.setData({ 'form.factsPending': e.detail.value })
  },

  onOpenCity() {
    this.setData({ showCity: true })
  },

  onCloseCity() {
    this.setData({ showCity: false, cityQuery: '', cityOptions: [] })
  },

  onCityInput(e) {
    const value = e.detail.value
    this.setData({ cityQuery: value, cityOptions: searchCities(value) })
  },

  // 选了城市只改「地图从哪打开」，不写入地点本身
  onPickCity(e) {
    const city = matchCity(e.currentTarget.dataset.name)
    if (!city) return
    this.setData({
      center: { latitude: city.latitude, longitude: city.longitude },
      cityText: city.name,
      cityHint: city.name,
      showCity: false,
      cityQuery: '',
      cityOptions: []
    })
  },

  // 优先级 A：与当前编辑日最接近的、已有坐标的地点。
  // 同一天取行程顺序最后一站（下一站通常离它最近）；当天没点则取天数间隔最小的那天的点
  nearestDayCenter() {
    const dayIndex = this.data.dayIndex
    const located = (this.pois || []).filter(function (poi) {
      return poi.location && poi.location.latitude
    })
    if (!located.length) return null

    const sameDay = located.filter(function (poi) {
      return poi.dayIndex === dayIndex
    })
    if (sameDay.length) {
      return sameDay.reduce(function (a, b) {
        return (b.order || 0) > (a.order || 0) ? b : a
      }).location
    }

    let best = located[0]
    let bestGap = Math.abs((best.dayIndex || 0) - dayIndex)
    located.forEach(function (poi) {
      const gap = Math.abs((poi.dayIndex || 0) - dayIndex)
      if (gap < bestGap || (gap === bestGap && (poi.order || 0) > (best.order || 0))) {
        best = poi
        bestGap = gap
      }
    })
    return best.location
  },

  // 兜底：目的地城市中心（本地城市表），匹配不到返回 null（chooseLocation 会用默认视野）
  fallbackCityCenter() {
    if (this.cityCenter) return this.cityCenter
    const city = matchCity(this.destination || '')
    return city ? { latitude: city.latitude, longitude: city.longitude } : null
  },

  async onChooseLocation() {
    if (this.choosing) return
    this.choosing = true

    try {
      // 初始视野优先级：正在编辑的点位 > 我的当前位置（主动申请授权）> 当天/相邻天已有点位 > 目的地城市中心
      // location.getCurrent 内部处理授权：没问过会弹授权框，拒绝过会引导去设置，拿不到就降级
      let center = this.data.form.location
      if (!center) center = await location.getCurrent()
      if (!center) center = this.nearestDayCenter()
      if (!center) center = this.fallbackCityCenter()

      const that = this
      const options = {
        success: function (res) {
          that.applyPicked(res)
        },
        fail: function (err) {
          that.onPickFail(err)
        },
        complete: function () {
          that.choosing = false
        }
      }
      if (center) {
        options.latitude = center.latitude
        options.longitude = center.longitude
      }

      wx.chooseLocation(options)
    } catch (err) {
      this.choosing = false
      this.onPickFail(err)
    }
  },

  // 选点结果直接写回名称和地址；如果你自己改过，就保留你的写法
  applyPicked(res) {
    const form = this.data.form
    const resName = String(res.name || '').trim()
    const resAddress = String(res.address || '').trim()
    // 只回填到城市级、或压根没给名称时，当作没拿到具体地点名
    const vague = location.isVaguePlaceName(resName, resAddress)
    const picked = { latitude: res.latitude, longitude: res.longitude }

    // 偏离目的地城市过远：常见于定位漂移、或用户在别的城市打开了选点
    const offTarget = !!(this.cityCenter && picked.latitude && distanceKm(picked, this.cityCenter) > DEVIATION_KM)
    if (!resName || !resAddress || vague || offTarget) {
      console.warn('[poi/edit] 选点结果异常', {
        name: resName,
        address: resAddress,
        offTarget: offTarget,
        expectedCityCenter: this.cityCenter
      })
    }

    const nameEdited = !!form.name && form.name !== this.data.pickedName
    const addressEdited = !!form.address && form.address !== this.data.pickedAddress

    const pickedName = vague ? '' : resName
    const pickedAddress = resAddress || resName
    const needManualName = vague && !nameEdited

    this.setData({
      'form.name': nameEdited ? form.name : pickedName,
      'form.address': addressEdited ? form.address : pickedAddress,
      'form.location': picked,
      located: true,
      coordText: coordText(picked),
      pickedName: pickedName,
      pickedAddress: pickedAddress,
      center: picked
    })

    if (needManualName || offTarget) {
      wx.showToast({ title: '若定位偏差过大，请手动输入地址', icon: 'none', duration: 3000 })
    }
  },

  onPickFail(err) {
    const msg = (err && err.errMsg) || ''
    if (/cancel/.test(msg)) return

    if (/auth|deny|permission/i.test(msg)) {
      wx.showModal({
        title: '需要位置权限',
        content: '打开地图选点要用到位置权限。去设置里打开后，再点一次「选点」即可。',
        confirmText: '去设置',
        success: function (res) {
          if (res.confirm) wx.openSetting({})
        }
      })
      return
    }

    wx.showModal({
      title: '没能打开地图',
      content: '可以先手动填写名称和地址；没选点的地点不会出现在地图上。',
      showCancel: false
    })
  },

  onClearLocation() {
    // 清掉坐标后，选点会重新从「我的当前位置」开始
    this.setData({
      'form.location': null,
      located: false,
      coordText: '',
      cityText: '',
      cityHint: '我的当前位置'
    })
  },

  async onSave() {
    if (this.data.saving) return
    const form = this.data.form
    if (!form.name.trim()) {
      wx.showToast({ title: '请填写地点名称', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      await poiService.save(this.data.tripId, {
        _id: this.data.poiId,
        dayIndex: this.data.dayIndex,
        name: form.name,
        address: form.address,
        location: form.location,
        category: form.category,
        plannedTime: form.plannedTime,
        durationMin: form.durationMin,
        facts: form.facts,
        factsPending: form.factsPending,
        note: form.note
      }, this.data.version)
      wx.navigateBack()
    } catch (err) {
      this.setData({ saving: false })
      if (err.code === 'conflict') this.onSaveConflict()
    }
  },

  // 表单页不能用通用冲突处理（load 会冲掉输入），只重新取版本号
  onSaveConflict() {
    const that = this
    wx.showModal({
      title: '这趟行程刚被改过',
      content: '「仍然保存」会用你现在填的内容覆盖对方的改动；「放弃」则返回不保存。',
      confirmText: '仍然保存',
      cancelText: '放弃',
      success: async function (res) {
        if (!res.confirm) {
          wx.navigateBack()
          return
        }
        try {
          const out = await tripService.get(that.data.tripId)
          that.setData({ version: out.trip.version })
          that.onSave()
        } catch (err) {
          // 已提示
        }
      }
    })
  },

  onRemove() {
    const that = this
    let retried = false

    const doRemove = async function () {
      try {
        await poiService.remove(that.data.tripId, that.data.poiId, that.data.version)
        wx.navigateBack()
      } catch (err) {
        // 别人刚改过：取一次新版本自动重试，只重试一次
        if (err.code === 'conflict' && !retried) {
          retried = true
          try {
            const out = await tripService.get(that.data.tripId)
            that.setData({ version: out.trip.version })
            doRemove()
          } catch (inner) {
            // 已提示
          }
        }
      }
    }

    wx.showModal({
      title: '删除这个地点？',
      content: '删除后可以重新添加，其它地点不受影响。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: function (res) {
        if (res.confirm) doRemove()
      }
    })
  }
})
