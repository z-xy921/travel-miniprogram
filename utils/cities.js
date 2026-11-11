// 城市坐标表：只用来把选点地图先定位到目的地城市，精度到市中心即可。
// 不接第三方地理编码，避免域名白名单和 Key 泄露（同「前端不直连第三方接口」的约定）。
const CITIES = [
  { name: '北京', province: '北京', latitude: 39.9042, longitude: 116.4074 },
  { name: '天津', province: '天津', latitude: 39.0842, longitude: 117.2010 },
  { name: '上海', province: '上海', latitude: 31.2304, longitude: 121.4737 },
  { name: '重庆', province: '重庆', latitude: 29.5630, longitude: 106.5516 },
  { name: '石家庄', province: '河北', latitude: 38.0428, longitude: 114.5149 },
  { name: '秦皇岛', province: '河北', latitude: 39.9354, longitude: 119.5996 },
  { name: '承德', province: '河北', latitude: 40.9515, longitude: 117.9634 },
  { name: '太原', province: '山西', latitude: 37.8706, longitude: 112.5489 },
  { name: '大同', province: '山西', latitude: 40.0768, longitude: 113.3001 },
  { name: '平遥', province: '山西', latitude: 37.1892, longitude: 112.1747 },
  { name: '呼和浩特', province: '内蒙古', latitude: 40.8424, longitude: 111.7490 },
  { name: '沈阳', province: '辽宁', latitude: 41.8057, longitude: 123.4315 },
  { name: '大连', province: '辽宁', latitude: 38.9140, longitude: 121.6147 },
  { name: '长春', province: '吉林', latitude: 43.8171, longitude: 125.3235 },
  { name: '哈尔滨', province: '黑龙江', latitude: 45.8038, longitude: 126.5350 },
  { name: '南京', province: '江苏', latitude: 32.0603, longitude: 118.7969 },
  { name: '苏州', province: '江苏', latitude: 31.2989, longitude: 120.5853 },
  { name: '无锡', province: '江苏', latitude: 31.4912, longitude: 120.3119 },
  { name: '扬州', province: '江苏', latitude: 32.3942, longitude: 119.4129 },
  { name: '常州', province: '江苏', latitude: 31.8107, longitude: 119.9740 },
  { name: '南通', province: '江苏', latitude: 31.9802, longitude: 120.8943 },
  { name: '徐州', province: '江苏', latitude: 34.2044, longitude: 117.2841 },
  { name: '杭州', province: '浙江', latitude: 30.2741, longitude: 120.1551 },
  { name: '宁波', province: '浙江', latitude: 29.8683, longitude: 121.5440 },
  { name: '绍兴', province: '浙江', latitude: 30.0023, longitude: 120.5810 },
  { name: '温州', province: '浙江', latitude: 27.9938, longitude: 120.6994 },
  { name: '嘉兴', province: '浙江', latitude: 30.7522, longitude: 120.7555 },
  { name: '湖州', province: '浙江', latitude: 30.8927, longitude: 120.0866 },
  { name: '舟山', province: '浙江', latitude: 29.9853, longitude: 122.2072 },
  { name: '金华', province: '浙江', latitude: 29.0784, longitude: 119.6474 },
  { name: '台州', province: '浙江', latitude: 28.6564, longitude: 121.4208 },
  { name: '合肥', province: '安徽', latitude: 31.8206, longitude: 117.2272 },
  { name: '芜湖', province: '安徽', latitude: 31.3526, longitude: 118.4329 },
  { name: '黄山', province: '安徽', latitude: 29.7147, longitude: 118.3374 },
  { name: '福州', province: '福建', latitude: 26.0745, longitude: 119.2965 },
  { name: '厦门', province: '福建', latitude: 24.4798, longitude: 118.0894 },
  { name: '泉州', province: '福建', latitude: 24.8741, longitude: 118.6757 },
  { name: '南昌', province: '江西', latitude: 28.6820, longitude: 115.8579 },
  { name: '景德镇', province: '江西', latitude: 29.2688, longitude: 117.1784 },
  { name: '婺源', province: '江西', latitude: 29.2480, longitude: 117.8615 },
  { name: '上饶', province: '江西', latitude: 28.4544, longitude: 117.9710 },
  { name: '济南', province: '山东', latitude: 36.6512, longitude: 117.1201 },
  { name: '青岛', province: '山东', latitude: 36.0671, longitude: 120.3826 },
  { name: '烟台', province: '山东', latitude: 37.4638, longitude: 121.4479 },
  { name: '威海', province: '山东', latitude: 37.5131, longitude: 122.1204 },
  { name: '泰安', province: '山东', latitude: 36.1949, longitude: 117.0879 },
  { name: '曲阜', province: '山东', latitude: 35.5800, longitude: 116.9865 },
  { name: '郑州', province: '河南', latitude: 34.7466, longitude: 113.6253 },
  { name: '洛阳', province: '河南', latitude: 34.6197, longitude: 112.4540 },
  { name: '开封', province: '河南', latitude: 34.7971, longitude: 114.3076 },
  { name: '武汉', province: '湖北', latitude: 30.5928, longitude: 114.3055 },
  { name: '宜昌', province: '湖北', latitude: 30.6919, longitude: 111.2865 },
  { name: '恩施', province: '湖北', latitude: 30.2720, longitude: 109.4880 },
  { name: '长沙', province: '湖南', latitude: 28.2282, longitude: 112.9388 },
  { name: '张家界', province: '湖南', latitude: 29.1167, longitude: 110.4791 },
  { name: '凤凰', province: '湖南', latitude: 27.9483, longitude: 109.5998 },
  { name: '广州', province: '广东', latitude: 23.1291, longitude: 113.2644 },
  { name: '深圳', province: '广东', latitude: 22.5431, longitude: 114.0579 },
  { name: '珠海', province: '广东', latitude: 22.2710, longitude: 113.5767 },
  { name: '佛山', province: '广东', latitude: 23.0217, longitude: 113.1219 },
  { name: '汕头', province: '广东', latitude: 23.3541, longitude: 116.6820 },
  { name: '惠州', province: '广东', latitude: 23.1115, longitude: 114.4152 },
  { name: '南宁', province: '广西', latitude: 22.8170, longitude: 108.3665 },
  { name: '桂林', province: '广西', latitude: 25.2340, longitude: 110.1800 },
  { name: '阳朔', province: '广西', latitude: 24.7780, longitude: 110.4970 },
  { name: '北海', province: '广西', latitude: 21.4811, longitude: 109.1204 },
  { name: '海口', province: '海南', latitude: 20.0440, longitude: 110.1999 },
  { name: '三亚', province: '海南', latitude: 18.2528, longitude: 109.5119 },
  { name: '万宁', province: '海南', latitude: 18.7953, longitude: 110.3897 },
  { name: '成都', province: '四川', latitude: 30.5728, longitude: 104.0668 },
  { name: '绵阳', province: '四川', latitude: 31.4675, longitude: 104.6796 },
  { name: '乐山', province: '四川', latitude: 29.5521, longitude: 103.7654 },
  { name: '宜宾', province: '四川', latitude: 28.7513, longitude: 104.6432 },
  { name: '九寨沟', province: '四川', latitude: 33.2600, longitude: 103.9180 },
  { name: '稻城', province: '四川', latitude: 29.0370, longitude: 100.2980 },
  { name: '贵阳', province: '贵州', latitude: 26.6470, longitude: 106.6302 },
  { name: '遵义', province: '贵州', latitude: 27.7257, longitude: 106.9273 },
  { name: '昆明', province: '云南', latitude: 24.8801, longitude: 102.8329 },
  { name: '大理', province: '云南', latitude: 25.6065, longitude: 100.2676 },
  { name: '丽江', province: '云南', latitude: 26.8721, longitude: 100.2299 },
  { name: '香格里拉', province: '云南', latitude: 27.8269, longitude: 99.7065 },
  { name: '腾冲', province: '云南', latitude: 25.0205, longitude: 98.4970 },
  { name: '西双版纳', province: '云南', latitude: 22.0017, longitude: 100.7978 },
  { name: '拉萨', province: '西藏', latitude: 29.6520, longitude: 91.1721 },
  { name: '林芝', province: '西藏', latitude: 29.6490, longitude: 94.3617 },
  { name: '西安', province: '陕西', latitude: 34.3416, longitude: 108.9398 },
  { name: '延安', province: '陕西', latitude: 36.5853, longitude: 109.4898 },
  { name: '宝鸡', province: '陕西', latitude: 34.3619, longitude: 107.2373 },
  { name: '兰州', province: '甘肃', latitude: 36.0611, longitude: 103.8343 },
  { name: '敦煌', province: '甘肃', latitude: 40.1421, longitude: 94.6619 },
  { name: '张掖', province: '甘肃', latitude: 38.9257, longitude: 100.4498 },
  { name: '西宁', province: '青海', latitude: 36.6171, longitude: 101.7782 },
  { name: '银川', province: '宁夏', latitude: 38.4872, longitude: 106.2309 },
  { name: '乌鲁木齐', province: '新疆', latitude: 43.8256, longitude: 87.6168 },
  { name: '吐鲁番', province: '新疆', latitude: 42.9513, longitude: 89.1895 },
  { name: '喀什', province: '新疆', latitude: 39.4704, longitude: 75.9898 },
  { name: '伊宁', province: '新疆', latitude: 43.9167, longitude: 81.3244 }
]

function normalize(text) {
  return String(text || '').replace(/[\s省市区县]/g, '')
}

// 「杭州」「杭州市」「杭州西湖」都能命中杭州
function matchCity(text) {
  const key = normalize(text)
  if (!key) return null
  const exact = CITIES.filter(function (city) {
    return normalize(city.name) === key
  })[0]
  if (exact) return exact
  return (
    CITIES.filter(function (city) {
      return key.indexOf(normalize(city.name)) !== -1
    })[0] || null
  )
}

// 城市名或省份都能搜，最多给 8 条
function searchCities(keyword) {
  const key = normalize(keyword)
  if (!key) return []
  return CITIES.filter(function (city) {
    return normalize(city.name).indexOf(key) !== -1 || normalize(city.province).indexOf(key) !== -1
  })
    .slice(0, 8)
    .map(function (city) {
      return {
        name: city.name,
        province: city.province,
        sub: city.province === city.name ? '' : city.province
      }
    })
}

module.exports = {
  CITIES: CITIES,
  matchCity: matchCity,
  searchCities: searchCities
}
