// 位置权限的统一入口：已授权直接用；没问过就弹系统授权；拒绝过就引导去设置页。
// 返回 null 表示用户最终没给权限，调用方按「没有位置」降级处理即可。

const CITIES = require('./cities').CITIES

// —— 选点回填质检 ——
// 微信选点在部分环境（尤其开发者工具、只定位到城市时）返回的 name 不是具体地点，
// 而是「浙江省杭州市西湖区」这类地址串，直接当名称存进去就没法看了。
// 行政区划后缀：剥掉后还能剩下什么，用来判断这串字是不是纯地址
const ADMIN_STRIP = /(?:特别行政区|自治区|自治州|自治县|街道|地区|新区|开发区|省|市|区|县|旗|盟|镇|乡)/g
// 名称里出现这些字，基本可以认定是具体地点（而非行政区划）
const POI_HINT = /[0-9０-９号栋幢楼层室座店馆站港塔桥寺宫陵中心广场大厦公寓小区社区酒店宾馆客栈机场车站码头景区公园博物馆图书馆剧院餐厅饭店咖啡商场超市医院大学学校]/

// 去掉空格和标点，只留文字，便于比较两串是不是同一句话
function squeeze(text) {
  return String(text || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）\[\]【】,，.。·、\-—_\/\\]/g, '')
}

// 是否只是城市/省份名：杭州、浙江
function isCityOnly(name) {
  return CITIES.some(function (city) {
    return city.name === name || city.province === name
  })
}

// 是否一串纯行政区划：杭州市、西湖区、浙江省杭州市西湖区
function isAdminChain(text) {
  const rest = text.replace(ADMIN_STRIP, '')
  if (rest === text) return false
  return !POI_HINT.test(rest)
}

// true = 没拿到具体地点名，需要让用户自己填
function isVaguePlaceName(name, address) {
  const picked = squeeze(name)
  if (!picked) return true

  const addr = squeeze(address)
  // 名称和地址是同一串（去标点后一致），说明只是地址被回填成了名称
  if (addr && picked === addr) return true

  if (isAdminChain(picked)) return true
  if (isCityOnly(picked)) return true

  return false
}

function getSetting() {
  return new Promise(function (resolve) {
    wx.getSetting({
      success: function (res) {
        resolve(res.authSetting || {})
      },
      fail: function () {
        resolve({})
      }
    })
  })
}

function openSetting() {
  return new Promise(function (resolve) {
    wx.openSetting({
      success: function (res) {
        const setting = res.authSetting || {}
        resolve(setting['scope.userLocation'] === true)
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

function askForSetting() {
  return new Promise(function (resolve) {
    wx.showModal({
      title: '需要位置权限',
      content: '用来在地图上显示你的当前位置。授权后可以随时在小程序设置里关掉。',
      confirmText: '去设置',
      success: function (res) {
        if (!res.confirm) return resolve(false)
        openSetting().then(resolve)
      },
      fail: function () {
        resolve(false)
      }
    })
  })
}

async function ensureAuthorized() {
  const setting = await getSetting()
  if (setting['scope.userLocation'] === true) return true
  if (setting['scope.userLocation'] === false) return askForSetting()

  try {
    await new Promise(function (resolve, reject) {
      wx.authorize({
        scope: 'scope.userLocation',
        success: resolve,
        fail: reject
      })
    })
    return true
  } catch (err) {
    return askForSetting()
  }
}

// 取当前位置，gcj02 与 map 组件同一套坐标，避免偏移
async function getCurrent() {
  const ok = await ensureAuthorized()
  if (!ok) return null

  try {
    const res = await new Promise(function (resolve, reject) {
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        highAccuracyExpireTime: 4000,
        success: resolve,
        fail: reject
      })
    })
    return { latitude: res.latitude, longitude: res.longitude }
  } catch (err) {
    return null
  }
}

module.exports = {
  ensureAuthorized: ensureAuthorized,
  getCurrent: getCurrent,
  isVaguePlaceName: isVaguePlaceName
}
