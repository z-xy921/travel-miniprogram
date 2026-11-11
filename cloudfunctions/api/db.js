const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

const COLLECTIONS = ['users', 'trips', 'pois', 'expenses', 'files']

let ensured = null

// 集合不存在时自动创建（幂等），首次调用后一直复用同一个 Promise。
// 索引无法通过 API 创建，数据量上来后在控制台补：pois(tripId,dayIndex,order)、expenses(tripId,spentAt)。
function ensureCollections() {
  if (!ensured) {
    ensured = Promise.all(
      COLLECTIONS.map(function (name) {
        return db.createCollection(name).catch(function () {
          // 已存在会报错，直接忽略
          return null
        })
      })
    )
  }
  return ensured
}

async function ensureUser(openid) {
  const users = db.collection('users')
  const existed = await users.where({ openid: openid }).limit(1).get()
  if (existed.data.length) return existed.data[0]

  const now = Date.now()
  const user = {
    openid: openid,
    nickname: '',
    defaultCurrency: 'CNY',
    createdAt: now,
    updatedAt: now
  }
  await users.add({ data: user })
  return user
}

// 每个请求都从这里拿到身份，永不相信前端传上来的 openid
async function start() {
  await ensureCollections()
  const openid = cloud.getWXContext().OPENID
  if (!openid) throw new Error('没有获取到用户身份，请在微信中打开小程序')
  const user = await ensureUser(openid)
  return { openid: openid, user: user }
}

// 定时触发器等没有用户身份的入口：只保证集合存在
async function ready() {
  await ensureCollections()
}

module.exports = { db: db, _: _, $: $, COLLECTIONS: COLLECTIONS, start: start, ready: ready }
