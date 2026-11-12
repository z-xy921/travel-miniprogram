# 旅行计划 · 功能逻辑全览

> 面向维护者的功能文档：按模块整理每个板块「做什么、怎么运转、关键规则」。
> 与代码的对应关系尽量精确到文件与函数，改动功能时请同步更新本文。

---

## 1. 项目概览

### 1.1 技术形态

- **微信小程序 + 云开发**（TCB），无自建服务器。
- **后端**：单云函数 `api`（`cloudfunctions/api/`），内部按 `action` 字符串路由；另有一个定时触发器入口（`Timer`），不走 action 路由。
- **前端分层**：`pages/*`（页面）→ `services/*`（业务接口封装）→ `services/cloud.js`（云调用统一出口）。
- **数据库**：云开发文档型数据库，5 个集合（见 §3）。

### 1.2 页面清单（`app.json` 注册）

| 页面 | 文件 | 说明 |
|---|---|---|
| 登录 | `pages/login/login` | 启动页，微信一键登录 + 资料完善弹层 |
| 行程列表 | `pages/trips/list` | Tab「行程」 |
| 新建/编辑行程 | `pages/trips/create` | 创建与编辑复用 |
| 邀请 | `pages/trips/invite` | 生成邀请码 + 分享 |
| 加入行程 | `pages/trips/join` | 分享卡片直达 / 手输邀请码 |
| 行程详情 | `pages/trip/detail` | 时间轴 + 操作中心 |
| 地图 | `pages/trip/map` | 按天看点位分布 |
| 旅行手帐 | `pages/trip/journal` | 按天照片相册 |
| 添加/编辑地点 | `pages/poi/edit` | 地图选点 + 信息表单 |
| 账本 | `pages/ledger/list` | Tab「记账」，按行程聚合账单 |
| 行程账单 | `pages/expense/list` | 单趟行程的明细 + 结算 |
| 记一笔 | `pages/expense/add` | 账目录入/编辑 |
| 我的 | `pages/profile` | 统计看板 + 登录/退出（文件在 pages 根目录） |
| 关于 | `pages/about` | 协议与说明 |

> 注：`pages/index`、`pages/day`、`pages/my`、`pages/overview` 目录未注册在 `app.json`，属于未挂载的历史遗留目录。

### 1.3 tabBar

`行程`（trips/list）· `记账`（ledger/list）· `我的`（profile），主色 `#2563eb`。

### 1.4 关键全局配置（`utils/constants.js`）

| 常量 | 值 | 用途 |
|---|---|---|
| `ENV_ID` | `cloud1-d6g1dqieuca96e71f` | 云环境 ID，换环境只改这里 |
| `CLOUD_FUNCTION` | `api` | 云函数名 |
| `MESSAGE_TEMPLATES.tripReminder` | （模板 id） | 出发提醒订阅消息模板 |
| `POI_CATEGORIES` | 景点/餐饮/住宿/交通/购物/其它 | 地点分类白名单 |
| `EXPENSE_CATEGORIES` | 交通/餐饮/门票/住宿/购物/其它 | 记账分类白名单 |
| `DURATIONS` | 30/60/90/120/180 分钟 | 停留时长选项 |
| `LIMITS` | DAYS 15 / POI_PER_DAY 20 / TITLE 20 | 数量上限 |
| `DEFAULT_START` / `BUFFER_MIN` | 09:00 / 30 | 重排时间的起点与赶路缓冲 |

---

## 2. 后端架构（`cloudfunctions/api`）

### 2.1 入口与路由（`index.js`）

`exports.main` 三条路径：

1. **定时触发器**：`event.Type === 'Timer'` → `notify.sendDue()`（每天 20:00 发出发提醒）。
2. **action 路由**：`user.* / trip.* / poi.* / expense.* / photo.* / notify.*`，全部 action：

| 组 | action |
|---|---|
| user | `user.me` · `user.login` · `user.updateProfile` |
| trip | `trip.list` · `trip.get` · `trip.create` · `trip.update` · `trip.copy` · `trip.remove` · `trip.invite` · `trip.join` · `trip.leave` · `trip.removeMember` |
| poi | `poi.list` · `poi.save` · `poi.remove` · `poi.reorder` |
| expense | `expense.list` · `expense.overview` · `expense.save` · `expense.remove` · `expense.settle` |
| photo | `photo.list` · `photo.add` · `photo.remove` |
| notify | `notify.subscribe` |

3. 返回格式统一 `{ ok, data | code, message }`；`code` 只用于客户端分流（如 `conflict`），权限与校验信息以 `message` 为准。

### 2.2 身份与建档（`db.js`）

- `start()`：每个请求执行 → `ensureCollections()`（集合不存在则创建，幂等）→ `openid = getWXContext().OPENID`（**永不信任前端传的 openid**）→ `ensureUser(openid)`（users 无记录则建档：`nickname:'' / avatar:'' / defaultCurrency:'CNY'`）→ 返回 `ctx = { openid, user }`。
- `ready()`：定时器等无身份入口使用，只保证集合存在。
- `util.js`：`cut`（截断字符串）、`toCents`（元转分）、`formatDate`、`buildDays`（起止日期 → days 数组，上限 15 天）、`uuid`（随机 id）。

### 2.3 权限与并发（`guard.js`）

| 函数 | 逻辑 |
|---|---|
| `isMember` | `trip.memberOpenids` 包含 openid |
| `roleOf` | `members[].role` 优先，老数据回退 `ownerOpenid` 判定，默认 `editor` |
| `requireOwner` | 非 owner 抛「只有创建者可以做这个操作」 |
| `assertVersion` | 客户端回传的 version 与库中不一致 → `conflict` |
| `bumpVersion` | 原子占位：`where({_id, version: 旧值})` + `version: _.inc(1)`，updated=0 即冲突（两个并发请求只有一个能落地） |
| `getTripForMember` | 查行程（软删过滤）→ 校验成员 → 老数据补 `version:0` → 注入 `myRole` |
| `getTripForPreview` / `sanitizeTripForPreview` | 游客只读预览，只回展示字段，**不带成员名单、邀请码、openid** |

---

## 3. 数据模型

### users
`openid`（主键语义）、`nickname`、`avatar`（云存储 fileID）、`defaultCurrency`、`createdAt/updatedAt`。

### trips
`_id`(uuid)、`ownerOpenid`、`memberOpenids[]`、`members[]`（`{openid, role, name, avatar, joinedAt}`，冗余昵称头像便于展示）、`title`(≤20)、`destination`(≤30)、`startDate/endDate`、`days[]`（`{index, date}`，服务端推导）、`mode`（solo/group）、`transport[]`（drive/transit 白名单）、`budgetCents`、`status`（planning/ongoing/ended）、`poiCount`、`inviteCode`、`inviteExpireAt`、`reminders[]`（`{openid, templateId, at, sentAt}`）、`version`、`createdAt/updatedAt/deletedAt`。

### pois
`tripId`、`dayIndex`、`order`（进位编码见 §6）、`name`(≤30)、`address`(≤60)、`location`（`{latitude, longitude}`）、`category`、`plannedTime`（HH:mm）、`durationMin`（30-180 白名单）、`facts`（`{open, reserve, fee}` 各 ≤40）、`factsPending`（默认 true）、`note`(≤200)、`createdBy`、`version` 由 trip 承载、`createdAt/updatedAt/deletedAt`。

### expenses
`tripId`、`amountCents`、`currency:'CNY'`、`category`、`paidBy`、`paidByName`、`splits[]`（`{openid, amountCents}`）、`splitWith[]`（老数据兼容）、`spentAt`（YYYY-MM-DD）、`note`(≤100)、`createdBy`、`version`（CAS 用）、`createdAt/updatedAt/deletedAt`。

### files（手帐照片）
`tripId`、`poiId`（预留关联）、`dayIndex`、`fileID`（云存储）、`type:'photo'`、`createdBy`、`createdAt/deletedAt`。

---

## 4. 账号与登录（`pages/login` + `services/user`）

### 4.1 登录态管理（`app.js`）

- **缓存**：`userInfo = { hasLogin, openid, nickname, avatar }` 存 storage（key `userInfo`），冷启动 `restoreLogin()` 恢复；`isLogin()` 全局判断。
- **写操作拦截 `checkLogin(opts)`**：已登录放行；未登录时支持两种形态——`{tip}` toast 后跳登录页，或 `{modal:{title,content}}` 先弹窗确认；`gotoLogin()` 记录来源页到 `loginRedirect`，登录成功后 `navigateBack` 返回。
- **游客模式**：「暂不登录」写 `loginSkipped`，可浏览列表/详情/账本引导页；各 Tab 页在 `onShow` 判断未登录时展示登录引导而非报错。

### 4.2 一键登录分流（`user.login`）

点「微信一键登录」（需先勾选协议）：

1. 调 `user.login` → 云端按 openid 读 users，返回 `hasProfile = Boolean(nickname && avatar)` 及资料。
2. `hasProfile === true`（老用户，换手机/清缓存也适用，账号匹配靠 openid）→ `app.setUser` 恢复本地登录态，toast「欢迎回来」，回到来源页或首页。
3. `hasProfile === false`（首次登录或资料不全）→ 弹「完善个人信息」半屏弹层，云端已有昵称会预填。
4. 兼容旧版云函数：`user.login` 返回「未知操作」时，前端降级用 `user.me` 的资料做相同判断。

### 4.3 资料完善（`user.updateProfile`）

- 头像：`<button open-type="chooseAvatar">`（微信官方规范）；网络头像先 `downloadFile` 转本地再上传 `avatars/` 云存储。
- 昵称：`<input type="nickname">`，支持键盘快捷填入；服务端截 24 字。
- **成员信息同步**：写 users 后，一次查回该用户所在的所有行程（`memberOpenids` 匹配，limit 100），并行覆盖各行程 `members[]` 中自己的 `name/avatar`；**不更新 trips.updatedAt**，避免登录动作把行程顶到列表最前。

### 4.4 退出

`app.logout()` 清本地缓存并写 `loginSkipped`（允许游客浏览）；云端 users 记录保留。

---

## 5. 行程列表与创建（`pages/trips/*` + `trip.*`）

### 5.1 列表页（`pages/trips/list`）

- `trip.list`：`memberOpenids` 匹配 + `deletedAt:''`，按 `updatedAt` 倒序，`limit(50)`；**未登录（users 无昵称）直接返回空**——数据按 openid 一对一隔离。
- 卡片字段：标题、城市标签（目的地，老数据用标题兜底）、紧凑日期（`11.12 - 11.14`）、人数、地点数；页面顶部统计行程总数。
- FAB「新建行程」经 `checkLogin` 弹窗拦截；下拉刷新；页面级分享为通用文案（不扩人）。

### 5.2 新建 / 编辑（`pages/trips/create`）

- **三张卡片**：出行模式（solo 🧍 / group 👥，选中态渐变蓝，编辑态隐藏）→ 地点与名称 → 日期（双 picker，起→止）+ 交通 chips + 预算（¥ 前置）。
- **前端校验**：目的地必填；名称留空回退目的地；结束早于开始时纠正/提示。
- **服务端归一化（`trip.create`）**：`title` 截 20 字（不能再空）、`destination` 截 30、`budgetCents = toCents(budget)`、`transport` 白名单过滤、**`days = buildDays(startDate, endDate, 15)`——天数永远由日期推导，客户端不能传**。
- **落库初值**：`memberOpenids=[自己]`、`members=[{role:'owner', name:昵称||'我', avatar}]`、`status:'planning'`、`poiCount:0`、`version:0`、`inviteCode:''`。
- **创建后分流**：以服务端落库的 `mode` 为准——group 弹窗「是否立即邀请同伴？」（去邀请页 / 稍后进详情），solo 直接 `redirectTo` 详情页（表单页被替换，返回键不回表单）。
- **编辑模式**（`?id=`）：`trip.get` 回填（含 `mode`），提交走 `trip.update(patch, version)`；成功 `navigateBack`；冲突时只重取版本号 + toast「再点一次保存」，**不自动重试不覆盖**。

### 5.3 行程本体编辑（`trip.update`）

- 可改：title、destination、transport、budgetCents、status、startDate/endDate。
- **改日期 = `buildDays` 整段重建 days**；缩短天数前统计 `dayIndex >= 新天数` 的点位数，有点位则报错「先删掉或挪到前面再减天数」。
- 详情页「加一天/减一天」= `endDate ±1`；减天要求最后一天无点位（`canRemoveLastDay`，本地也预判）。

### 5.4 状态

`planning / ongoing / ended` 三态，仅手动切换；详情页头部标签三色（蓝/绿/灰）。

### 5.5 复制 / 删除

- `trip.copy`（owner + version）：标题加「 副本」、日期从今天起算重建 days、地点整份搬迁（dayIndex 夹取、order 重排）、`poiCount` 回写；成员只留自己、`mode='solo'`；**账目与照片不复制**。
- `trip.remove`（owner + version）：一次软删 `trips / pois / expenses / files` 四张表（删除行程连带手帐记录，避免悬空与配额占用）。

---

## 6. 地点 POI（`pages/poi/edit` + `poi.*`）

### 6.1 order 进位编码（排序的基石）

```
baseOrder(dayIndex) = (dayIndex + 1) * 100000   // day0 从 101000 起
单天递增步长 = 1000                              // nextOrder = 最后一个 + 1000
```

只按 `order` 单字段排序即得「按天 + 天内按序」，一个索引覆盖；reorder 时按传入顺序重编 `baseOrder(day) + seq*1000`。

### 6.2 选点页（`pages/poi/edit`）

- **地图初始中心优先级**：编辑中的点位坐标 → 我的当前位置（`wx.getLocation`，用户主动触发才授权）→ 当天/相邻天已有点位中心 → 目的地城市中心 → 默认。
- **城市选择**：顶部小字「定位参考：xx（点击更改）」→ 底部弹层搜索（`utils/cities`）→ 选中只改地图起点，**不写入地点数据**；清除坐标后回到「我的当前位置」。
- **位置表单双态**：无坐标 = 整宽「📍 在地图上选择位置」（`wx.chooseLocation`）；有坐标 = 名称/地址只读卡片（单行截断）+「修改位置」+ 清除按钮；地图返回名称为空时显示名称输入框兜底，避免「有坐标无名字」的死路。
- **表单**：分类 6 项 3 列网格、时长 5 档、预计到达时间（不填排当天最后）、已知信息（营业/预约/费用 + 「待核实」开关，手填信息默认待核实）、备注。

### 6.3 保存（`poi.save`）

- 名称必填（截 30）；分类/时长/时间白名单归一化；`location` 经 `normalizeLocation`（非法数值丢弃）；facts 三项各截 40。
- `dayIndex` 夹取到 `[0, days.length-1]`；编辑换天时重取 `nextOrder` 排到当天末尾。
- 新增前检查单天数量 `MAX_PER_DAY = 20`。
- 走 trip 的乐观锁：先 `assertVersion` 比对，再 `bumpVersion` 原子占位。
- 成功后 `refreshCount`（count 回写 `trips.poiCount`，并更新 `updatedAt`）。

### 6.4 排序 / 换天 / 重排时间（`poi.reorder`）

- 客户端本地先变，然后把**完整顺序** `[{_id, dayIndex, plannedTime}]`（上限 300）一次提交；服务端按天重编 order、并行更新，**单请求保证原子性，避免多次往返半成功**。
- 「重排时间」= 按当天顺序从 09:00 起，按「上一站开始 + 停留 + 30 分钟缓冲」累加生成 plannedTime，同样走 reorder 提交。
- 删除（`poi.remove`）：软删 + bumpVersion + refreshCount。

### 6.5 详情页时间轴（`poi.list`）

- 一次请求返回 `trip + items`（`order` 升序，limit 300）+ `preview` 标记；前端按 `dayIndex` 分组渲染 `poi-card` 时间轴。
- 非成员/游客自动降级：`getTripForMember` 失败 → `getTripForPreview`，`preview:true`，前端隐藏全部写操作。

---

## 7. 协同（`pages/trips/invite` / `join` + `trip.join/leave/removeMember`）

### 7.1 邀请码（`trip.invite`）

- owner 打开邀请页按需生成：6 位、字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉 0/O/1/I），查重最多重试 5 次。
- 有效期 **7 天**（`inviteExpireAt`）；有效期内重复打开**复用同一码**（幂等）。
- 邀请页提供：码展示、复制、分享按钮（`onShareAppMessage` path = `/pages/trips/join?id=xx&code=xx`）。

### 7.2 加入（`trip.join`）

支持两种入口，规则统一：

- `tripId` 直达（分享卡片）：读 query 的 `id` 与 `code`。
- 手输邀请码：按 `inviteCode` 查行程。

校验顺序：行程存在（软删过滤）→ **已在行程内直接放行返回 `joined:false`**（自己的行程不因码过期打不开）→ `inviteExpireAt` 为空拒绝（「邀请还没开通」）→ 已过期拒绝 → 链接带码但与当前码不一致拒绝（码被重置后旧链接失效）→ 通过则追加 `memberOpenids/members`、`mode` 转 `group`、`version++`。

### 7.3 退出与移除

- `trip.leave`：创建者不允许退出（只能删行程）；退出时清掉自己在该行程的 `reminders`。
- `trip.removeMember`（仅 owner）：不能移自己、不能移创建者；剩 1 人时 `mode` 回 `solo`。

### 7.4 游客预览

游客或非成员打开分享链接 → `poi.list` 降级为 preview → 详情页 `readonly`，可看时间轴，写操作由 `guardWrite()` 统一拦截（未登录 → 登录引导；已登录非成员 → 提示加入）。

---

## 8. 记账（`pages/ledger` / `pages/expense` + `expense.*`）

### 8.1 账本 Tab（`pages/ledger/list`）

- 游客态展示登录引导；登录后 `Promise.all([trip.list, expense.overview])` 一次装配。
- 头部汇总：总笔数、累计金额；每行一张行程卡片：标题、日期区间、该趟总额（`expense.overview` 按 tripId 聚合）、笔数；点击进该趟账单页。

### 8.2 全局概览（`expense.overview`）

- 拉自己所有行程 id（limit 200）→ 对 expenses 做聚合管道 `match(tripId in ids) → group(_id: tripId, sum金额, count)`，一次请求拿到所有行程花费，不逐条拉明细。

### 8.3 记一笔（`pages/expense/add` + `expense.save`）

- 表单：金额（元，转分）、分类 chips（6 类）、日期 picker、备注（≤100）、付款人（`trip.members` + 自己）、AA 分摊人勾选 + 每人金额（可改，默认均摊）。
- **均摊算法（`evenSplits`）**：分到「分」整除，除不尽的零头 `rest` 给第一个勾选人，保证合计精确等于金额。
- **分摊校验（`normalizeSplits`）**：openid 必须是成员、去重；客户端传了 splits 则校验「合计 == 金额」（误差以分计，报错会带差额），没传则按全部成员均摊。
- `paidBy` 必须是成员，缺省自己；`paidByName` 服务端生成展示名（昵称优先，旧数据回退「角色 + openid 后四位」）。
- **并发 CAS**：新增写 `version:0`；编辑必须带 `version`，先比对再 `where({_id, version}) + _.inc(1)` 原子更新（金额/付款人/splits 同一次写入，杜绝「金额改了分摊没改」）；老账目无 version 先补 0。
- 前端冲突处理：表单页弹「仍然保存 / 放弃」，选保存则从 `expense.list` 重取该笔最新 version 后重试（保留用户已填内容）。

### 8.4 行程账单页（`pages/expense/list`）

- `expense.list`：按 `spentAt desc`（同日按 createdAt 倒序），上限 300 条；**汇总在服务端算一次**（`summarize`：总额、笔数、按分类降序），前端与明细永远同源。
- 操作：点击编辑（进 add 页带 id/version）、删除（软删）、入口到结算页。

### 8.5 AA 结算（`expense.settle`）

- 每人两本账：`paid`（实付）= 其付款的金额合计；`owed`（应摊）= 其在 splits 中的份额合计；**老数据（只有 splitWith）回退按人数均摊**。
- 每人差额 `balance = paid - owed`；输出成员行（含「我」标记、展示名、已移除成员兜底标签）。
- **转账建议**：欠款人队列 × 债权人队列**双指针**——每次取两边差额的较小值生成一笔转账，一方清零推进另一方的指针，得到**最少笔数**的转账方案。
- 汇总返回：`totalCents`、`memberCount`、成员行、`transfers[]`。

### 8.6 删除

`expense.remove`：成员校验 + 软删（不占 trip 的 version）。

---

## 9. 旅行手帐（`pages/trip/journal` + `photo.*`）

### 9.1 数据与展示

- `photo.list`：返回 `trip + items`（files 按 `createdAt` 升序，上限 100）；前端按 `dayIndex` 分组到 Day 胶囊 Tab，Tab 标签带张数后缀（`D1 11/11 · 3`）。
- 网格：每行 3 张、1:1 裁切、右下角时间戳胶囊；点击预览（`getTempFileURL` 换临时链接后 `wx.previewImage`）。

### 9.2 加照片

- `wx.chooseMedia` 一次最多 9 张（`sizeType: compressed`）→ 逐张上传云存储 `journal/{tripId}/{timestamp}-{i}.jpg` → `photo.add` 写 files 记录（带 dayIndex；**静默调用**，不逐张弹 loading）。
- **进度 UI**：全程只有一个居中弹窗（`上传中 n/total` 大数字 + 渐变进度条 + 半透明遮罩 `catchtouchmove` 防滚动误触）；进度按「已处理」推进，失败不中断。
- 结束统一反馈：有失败 →「有 X 张照片上传失败，请重试」；全成功 →「加了 N 张」；然后刷新列表。
- 配额：`photo.add` 检查单趟上限 **100 张**。

### 9.3 管理模式（相册式批量操作）

- 右上「管理 / 取消」切换 `isManaging`，切换清空勾选。
- 管理态点照片 = 勾选/取消（`selectedPhotos` 存 `_id`，跨天保留）；浏览态点照片 = 预览。
- 选中标记在 JS 预计算到每张照片（`computeDayView` 统一出口），同时算出 `isAllSelected`。
- 顶部左侧「全选 / 取消全选」：**只作用当前 Day**；手动勾掉一张自动变回「全选」，补齐最后一张自动变「取消全选」。
- 底部按钮切换为红色「删除选中 (X)」，0 选中置灰；删除一次确认 → 循环调 `photo.remove`（loading 只弹一次）→ 失败计数统一 toast → 退出管理模式并刷新。
- `photo.remove` 只软删记录，**云存储原图保留**（防误删无法恢复）。

---

## 10. 出发提醒（`notify.*`）

### 10.1 订阅（`notify.subscribe`）

- 详情页「出发提醒」→ 前端 `wx.requestSubscribeMessage`（模板 id 来自 `MESSAGE_TEMPLATES.tripReminder`）→ 授权成功后调 `notify.subscribe`。
- 云端把 `{openid, templateId, at}` 写进 `trip.reminders`；**同一 openid 只保留一条**（一次授权 = 一次推送机会）。

### 10.2 定时发送（`sendDue`）

- 每天晚上 **20:00** 定时触发器调 `sendDue`：查 `startDate = 明天` 的行程（limit 100）。
- 对每条行程中未发送的（`!sentAt`）逐个 `subscribeMessage.send`：模板数据 `title`(≤20 字) / `startDate` / 固定提示语，`page` 指向行程详情页。
- **无论成功失败都标 `sentAt`**——授权次数已消耗，重试无意义，避免每天重复打扰；失败只记日志（errCode 47003 等）。
- 返回统计 `{date, trips, sent, failed}` 供日志查看。

---

## 11. 地图页（`pages/trip/map`）

- 按天展示有坐标的点位：marker + callout；顶部 day-tabs 切天（与详情页共用组件）。
- 初始视野：当天点位外包框；无坐标点位不显示（地图页不参与编辑）。

---

## 12. 我的（`pages/profile`）

- 头部：头像 + 昵称 + openid 后 8 位（`ID · XXXXXXXX`，不暴露完整身份）；未登录点击去登录。
- 统计看板：`trip.list` + `expense.overview` 并行拉取 → 去过城市数（按目的地去重）、行程数、累计花费。
- 入口：加入行程（游客弹窗确认后登录）、关于页、退出登录。
- 游客态看板显示 0，不拉数据。

---

## 13. 前端基础设施

### 13.1 云调用出口（`services/cloud.js`）

- `call(action, payload)`：静默调用，返回 `result.data`，失败抛带 `code` 的 Error。
- `run(action, payload, loadingText)`：带 `showLoading` 的调用，失败统一 toast（`conflict` 例外，不重复打扰）；适合单次写操作；**循环调用场景（批量上传/批量删除）一律用 `call`，loading 由页面统一控制**。

### 13.2 冲突处理（`utils/conflict.js`）

- `handle(err, { onRefresh, onRetry })`：详情页列表型操作的统一冲突弹窗「仍然保存 / 刷新」——选保存则刷新数据后重试一次；选刷新则只更新视图。

### 13.3 工具（`utils/format.js` / `utils/cities.js` / `utils/constants.js`）

- format：`parseDate / formatDate / dateRangeText / cnDay`（中文日期）、`timeToMin / minToTime`（时间轴换算）、`addDays`、`durationText`、`moneyText`（分 → 展示金额）。
- cities：城市搜索/匹配（选点页城市弹层的数据源）。
- constants：见 §1.4。

### 13.4 组件

| 组件 | 用途 |
|---|---|
| `day-tabs` | 日期胶囊横向滚动条；两端渐变遮罩 + 箭头（`bindscroll` 节流显隐、点箭头按容器宽 2/3 平滑滚动、`scroll-into-view` 自动滚到当前天）；详情页/地图页共用 |
| `poi-card` | 时间轴地点卡片（时间、分类、名称、地址、备注、待核实标记） |
| `empty-state` | 通用空状态 |
| `fact-row` | 地点已知信息行 |
| `plan-b-sheet` / `station-card` | 预留组件（当前页面未挂载） |

---

## 14. 核心交互流（端到端）

```
登录页（老用户直接进 / 新用户完善资料）
  └→ 行程列表 Tab ── FAB → 新建页 → trip.create ─┬─ solo → 详情页
                                                  └─ group → 弹窗 → 邀请页 / 详情页
详情页 ─┬─ + 加地点 → poi/edit → poi.save → poiCount 刷新 → 详情重载
        ├─ 地图（按天看点位）
        ├─ 排序/换天/重排时间 → poi.reorder
        ├─ 手帐 📖 → 照片上传/批量管理
        ├─ ⋯ 菜单：编辑行程 / 加减一天 / 邀请 / 提醒 / 复制 / 切状态
        └─ 底部删除行程（软删 trips+pois+expenses+files）
邀请页 → 分享卡片（id+code）→ join 页 → trip.join → group
记账 Tab → 账本列表 → 单趟账单 → 记一笔（AA 分摊）/ 结算（最少笔数转账）
我的 → 统计看板 / 登录 / 退出
每天 20:00 定时器 → 明天出发的行程 → 订阅消息提醒
```

---

*文档基于当前代码生成；调整功能时请同步更新对应章节。*
