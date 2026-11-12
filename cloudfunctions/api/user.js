async function me(payload, ctx) {
  return {
    openid: ctx.openid,
    user: {
      nickname: ctx.user.nickname || '',
      avatar: ctx.user.avatar || '',
      defaultCurrency: ctx.user.defaultCurrency || 'CNY'
    }
  }
}

// 一键登录：users 里已有完整资料（昵称+头像）的老用户直接放行，
// 不再弹资料弹层；首次登录或资料不全的才需要完善信息。
// openid 只从服务端上下文取，账号匹配靠 openid，与设备/本地缓存无关。
async function login(payload, ctx) {
  const nickname = ctx.user.nickname || ''
  const avatar = ctx.user.avatar || ''
  return {
    openid: ctx.openid,
    hasProfile: Boolean(nickname && avatar),
    nickname: nickname,
    avatar: avatar
  }
}

// 登录/完善资料：写 users，并批量同步该用户在所有协同行程成员里的名字与头像
async function updateProfile(payload, ctx) {
  const { db } = require('./db')
  const nickname = String(payload.nickname || '').trim().slice(0, 24)
  const avatarFileID = String(payload.avatarFileID || '')
  if (!nickname) throw new Error('昵称不能为空')

  const now = Date.now()
  // ctx.user 由 start() 的 ensureUser 保证已存在，这里只需更新
  await db.collection('users').where({ openid: ctx.openid }).update({
    data: { nickname: nickname, avatar: avatarFileID, updatedAt: now }
  })

  // 云开发数据库不支持 arrayFilters（会报 -502001 No array filter found），
  // 改为一次查回该用户所在的全部行程，再并行按 _id 覆盖 members 数组。
  // 只同步成员信息，不动 updatedAt，避免登录就把行程顶到列表最前。
  const trips = await db
    .collection('trips')
    .where({ memberOpenids: ctx.openid })
    .field({ _id: true, members: true })
    .limit(100)
    .get()

  await Promise.all(
    trips.data.map(function (trip) {
      const members = (trip.members || []).map(function (member) {
        if (member.openid !== ctx.openid) return member
        return Object.assign({}, member, { name: nickname, avatar: avatarFileID })
      })
      return db.collection('trips').where({ _id: trip._id }).update({ data: { members: members } })
    })
  )

  return { openid: ctx.openid, nickname: nickname, avatar: avatarFileID }
}

module.exports = { me: me, login: login, updateProfile: updateProfile }
