// 客户端生成 id：离线、重试、并发写都不会产生重复记录
function uuid() {
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return (time + random).slice(0, 24)
}

module.exports = { uuid }
