const { db } = require('./db')
const { getTripForMember } = require('./guard')
const { cut, uuid } = require('./util')

const MAX_PHOTOS = 100

// 手帐照片：只存云存储 fileID，图片地址由小程序端直接用 fileID 渲染
async function list(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const res = await db
    .collection('files')
    .where({ tripId: trip._id, deletedAt: '' })
    .orderBy('createdAt', 'asc')
    .limit(MAX_PHOTOS)
    .get()
  return { trip: trip, items: res.data }
}

async function add(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const fileID = cut(payload.fileID, 300)
  if (!fileID) throw new Error('缺少文件')

  const count = await db.collection('files').where({ tripId: trip._id, deletedAt: '' }).count()
  if (count.total >= MAX_PHOTOS) throw new Error('一趟行程最多放 ' + MAX_PHOTOS + ' 张照片')

  const now = Date.now()
  const doc = {
    _id: uuid(),
    tripId: trip._id,
    poiId: cut(payload.poiId, 32),
    dayIndex: Math.max(0, Number(payload.dayIndex) || 0),
    fileID: fileID,
    type: 'photo',
    createdBy: ctx.openid,
    createdAt: now,
    deletedAt: ''
  }
  await db.collection('files').add({ data: doc })
  return { file: doc }
}

// 只软删记录；云存储里的原图先留着，避免误删无法恢复
async function remove(payload, ctx) {
  const trip = await getTripForMember(payload.tripId, ctx.openid)
  const fileId = cut(payload.fileId, 32)
  if (!fileId) throw new Error('缺少照片 id')

  const existed = await db
    .collection('files')
    .where({ _id: fileId, tripId: trip._id, deletedAt: '' })
    .limit(1)
    .get()
  if (!existed.data.length) throw new Error('照片不存在或已被删除')

  await db.collection('files').where({ _id: fileId }).update({ data: { deletedAt: Date.now() } })
  return { fileId: fileId }
}

module.exports = {
  list: list,
  add: add,
  remove: remove
}
