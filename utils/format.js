const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function parseDate(value) {
  if (!value) return null
  const parts = String(value).split('-')
  if (parts.length !== 3) return null
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  return isNaN(d.getTime()) ? null : d
}

function formatDate(date) {
  const d = date || new Date()
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-')
}

function addDays(value, n) {
  const d = parseDate(value)
  if (!d) return value
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function toDateText(value) {
  const d = parseDate(value)
  if (!d) return value || ''
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`
}

function durationText(min) {
  const m = Number(min) || 0
  if (!m) return ''
  if (m < 60) return `约 ${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `约 ${h} 小时 ${rest} 分钟` : `约 ${h} 小时`
}

// 金额一律以「分」存储，展示时才转元
function moneyText(cents) {
  const n = Number(cents) || 0
  return '¥' + (n / 100).toFixed(2)
}

function moneyPlain(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2)
}

// '12.5' → 1250，非法输入一律当 0，避免脏数据进库
function toCents(text) {
  const value = String(text === undefined || text === null ? '' : text).trim()
  if (!value) return 0
  const num = Number(value)
  if (!isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

function dayCount(start, end) {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e || e < s) return 0
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
}

function dateRangeText(start, end) {
  const s = parseDate(start)
  const e = parseDate(end)
  if (!s || !e) return ''
  if (start === end) return `${s.getMonth() + 1}月${s.getDate()}日`
  if (s.getMonth() === e.getMonth()) {
    return `${s.getMonth() + 1}月${s.getDate()}日 - ${e.getDate()}日`
  }
  return `${s.getMonth() + 1}月${s.getDate()}日 - ${e.getMonth() + 1}月${e.getDate()}日`
}

function timeToMin(text) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''))
  if (!matched) return null
  return Number(matched[1]) * 60 + Number(matched[2])
}

function minToTime(min) {
  const value = ((Math.round(Number(min) || 0) % 1440) + 1440) % 1440
  return pad(Math.floor(value / 60)) + ':' + pad(value % 60)
}

function todayText() {
  return formatDate(new Date())
}

function weekdayText(value) {
  const d = parseDate(value)
  return d ? WEEK[d.getDay()] : ''
}

module.exports = {
  pad,
  parseDate,
  formatDate,
  addDays,
  toDateText,
  durationText,
  moneyText,
  moneyPlain,
  toCents,
  dayCount,
  dateRangeText,
  timeToMin,
  minToTime,
  todayText,
  weekdayText
}
