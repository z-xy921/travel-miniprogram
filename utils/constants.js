// 云开发环境与集合名集中在这里，改环境只改一处
const ENV_ID = 'cloud1-d6g1dqieuca96e71f'
const CLOUD_FUNCTION = 'api'

const COLLECTIONS = {
  USERS: 'users',
  TRIPS: 'trips',
  POIS: 'pois',
  EXPENSES: 'expenses'
}

// 地点分类：只留旅行中真正会用来分组筛选的几类
const POI_CATEGORIES = ['景点', '餐饮', '住宿', '交通', '购物', '其它']

// 记账分类
const EXPENSE_CATEGORIES = ['交通', '餐饮', '门票', '住宿', '购物', '其它']

// 订阅消息模板 id：在公众平台「订阅消息」里申请后填进来，留空时页面会提示未配置
const MESSAGE_TEMPLATES = {
  tripReminder: 'iHNhBp9mABCcm5jNoUs5kP-wrP-ah1aNwvi_9lS4M3M'
}

// 停留时长选项（分钟）
const DURATIONS = [30, 60, 90, 120, 180]

const LIMITS = {
  DAYS: 15,
  POI_PER_DAY: 20,
  TITLE: 20
}

// 默认出发时间与两站之间的赶路缓冲，用于「重排时间」
const DEFAULT_START = '09:00'
const BUFFER_MIN = 30

module.exports = {
  ENV_ID,
  CLOUD_FUNCTION,
  COLLECTIONS,
  MESSAGE_TEMPLATES,
  POI_CATEGORIES,
  EXPENSE_CATEGORIES,
  DURATIONS,
  LIMITS,
  DEFAULT_START,
  BUFFER_MIN
}
