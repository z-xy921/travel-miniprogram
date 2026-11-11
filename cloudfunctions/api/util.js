function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function parseDate(value) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!matched) return null
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function formatDate(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-')
}

// 行程天数由起止日期推导，客户端不传天数，避免两边算不一致
function buildDays(startDate, endDate, maxDays) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!start || !end || end < start) return []

  const total = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  if (total > maxDays) return []

  const days = []
  for (let i = 0; i < total; i++) {
    const d = new Date(start.getTime())
    d.setDate(start.getDate() + i)
    days.push({ index: i, date: formatDate(d) })
  }
  return days
}

function uuid() {
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return (time + random).slice(0, 24)
}

function cut(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return text.length > max ? text.slice(0, max) : text
}

// 金额统一「分」存储
function toCents(value) {
  const num = Number(value)
  if (!isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

module.exports = {
  pad: pad,
  parseDate: parseDate,
  formatDate: formatDate,
  buildDays: buildDays,
  uuid: uuid,
  cut: cut,
  toCents: toCents
}
