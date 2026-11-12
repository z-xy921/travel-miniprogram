# SKILL：旅行计划小程序 · AI 开发规范（最高优先级）

> 本文件是后续所有代码生成的**强制约束**。与任何「通用最佳实践」冲突时，以本文件为准。
> 所有条款均从当前仓库真实代码提取（括号内为出处），不是建议、不是示例风格。
> 违反任一「禁止」条款即视为**破坏性改动**，必须先说明理由并获得确认。

---

## 0. 文件地图（改动前先定位）

```
app.js / app.json / app.wxss       全局：登录态、路由注册、设计令牌
services/*.js                      前端唯一的数据出入口（cloud.js 是底座）
utils/                             纯工具：format / conflict / constants / location…
components/                        day-tabs · poi-card · empty-state · fact-row（+2 个未使用）
pages/                             14 个已注册页面
cloudfunctions/api/                单云函数：index.js 路由 + 各域 handler + guard/db/util
cloudfunctions/api/settle-core.js  纯算法（可被 jest 直接 require）
tests/unit/                        Jest 纯函数用例
tests/e2e/                         真机自动化（helpers/automator.js 为公共底座）
```

---

## 1. 核心架构与数据契约

### 1.1 云函数路由：单函数 + action 分派

- 只有一个云函数 `api`（`utils/constants.js: CLOUD_FUNCTION`），**禁止**新增云函数。
- 路由表是显式白名单：`cloudfunctions/api/index.js` 的 `routes` 对象。未命中直接返回「未知操作」。
- 命名规范：`<域>.<动作>`，域为 `user | trip | poi | expense | photo | notify`。

**新增一个 action 的标准四步**：

1. 在对应域文件写 `async function xxx(payload, ctx)`，返回纯数据（禁止返回 `{ok:...}`，包装由 index.js 统一做）；
2. 在 `index.js` 的 `routes` 增加 `'域.动作': handler.Xxx`；
3. 在 `services/<域>.js` 增加方法：读操作走 `call`，写操作走 `run`（带 loading / 统一 toast）；
4. 页面只调 `services/` 方法，**不得**出现 `wx.cloud.callFunction`。

### 1.2 返回契约（前后端强耦合，不得擅改）

```js
// 成功
{ ok: true, data: <any> }        // handler 返回 undefined 时自动转 null（index.js:68）
// 失败
{ ok: false, code: '', message: '<用户可读中文>' }
```

- `code` **只用于客户端分派**（目前仅 `'conflict'`），权限与校验错误一律靠 `message` 文案。
- `services/cloud.js` 把失败转成 `Error`，并保留 `err.code`；`run()` 对非 conflict 统一 toast，**conflict 必须交给页面处理**，否则会弹两次。

### 1.3 身份与权限

- `openid` **只从服务端上下文取**：`db.start()` → `cloud.getWXContext().OPENID`；前端传的任何 openid 一律忽略（`index.js:65`）。
- 每个请求都会 `ensureUser(openid)` 建档（`db.js`），首次访问即写入 `users`。
- 成员校验统一走 `getTripForMember(tripId, openid)`：不存在/已删除 → 「行程不存在或已被删除」；非成员 → 「你没有这件行程的权限」。
- 角色：`roleOf()` 返回 `owner | editor`，老数据无 role 时以 `ownerOpenid` 兜底；`requireOwner()` 用于所有**只有创建者能做**的操作（删除行程、移除成员等）。
- 只读预览走 `getTripForPreview()` + `sanitizeTripForPreview()`：**只返回展示字段**，`members` / `inviteCode` / `openid` / `memberOpenids` 一律不得外泄。

### 1.4 数据模型防呆

| 约束 | 规则 |
|---|---|
| 金额 | 所有金额字段以 `*Cents` 命名、存**整数分**；元↔分只走 `utils/format.js` 的 `toCents / moneyText / moneyPlain`。**禁止**浮点相加、禁止把元存库 |
| 日期 | `YYYY-MM-DD` 字符串；`days` 数组必须由 `buildDays(startDate, endDate, 15)` 推导，**改日期必须整段重建 days**（`trip.js:108-128`）；最多 15 天（`LIMITS.DAYS`） |
| 软删 | 查询一律带 `deletedAt: ''`；删除是写 `deletedAt`，不是物理删 |
| 集合 | `users / trips / pois / expenses / files`（`db.js:8`）；前端 `constants.COLLECTIONS` 只有前 4 个，`files` 仅云函数使用 |
| 白名单 | 分类 `POI_CATEGORIES`、`EXPENSE_CATEGORIES`，状态 `['planning','ongoing','ended']`，交通 `['drive','transit']`。新增枚举必须**前后端同步**并在云函数侧校验 |
| 冗余字段 | `poiCount` / `budgetCents` / `members[].nickname` 等由服务端维护；前端只读，不得自行 setData 后提交 |

### 1.5 version 乐观锁（最容易破坏的地方）

`trips.version` 是**唯一并发令牌**，三层机制缺一不可：

```js
// 1) 页面进入时拿到 version，写操作原样带回
await tripService.update(tripId, patch, this.data.version)

// 2) 服务端先比对（guard.assertVersion）
assertVersion(trip, payload.version)      // 不传 version 视为跳过校验，仅限内部调用

// 3) 落库用 where 带旧版本号做原子占位（guard.bumpVersion）
db.collection('trips').where({ _id, version: current }).update({ data: { version: _.inc(1), updatedAt: Date.now() } })
if (!res.stats.updated) throw conflictError()   // 0 行更新 = 有人抢写
```

**必用场景**：任何修改 `trips` 文档的写操作、`poi.reorder`、`poi.save/remove` 中会回写 `poiCount` 的操作、`expense.*` 中影响行程副属性的操作。
**老数据兼容**：`getTripForMember` 会为缺 `version` 的老文档补 `version: 0`（`guard.js`），新代码不得绕过该函数直查 trips。
**禁止**：只校验不 bump、或直接 `update` 不带 `where({version})`。

### 1.6 前端调用标准路径

```js
// services/xxx.js —— 唯一出口
list()            { return call('trip.list', {}) }                       // 静默读
create(draft)     { return run('trip.create', draft, '创建中…') }        // 写：loading + 失败 toast
settle(tripId)    { return call('expense.settle', { tripId }) }          // 静默读
```

- 页面里出现 `wx.cloud.callFunction` 即为违规。
- 需要「静默版」写接口（如 `inviteSilent`）必须在 services 里显式新增，不允许页面自己绕过。
- 所有跨端数据结构变更（字段增删改名）必须同时改：云函数 handler → services → 页面 → 单测夹具。

---

## 2. 视觉与 UI 规范

### 2.1 设计令牌（全部来自 `app.wxss` / `app.json`，禁止自造新色值）

| 用途 | 值 |
|---|---|
| 主色 / 选中态 | `#2563eb` |
| 主按钮渐变 | `linear-gradient(135deg, #2563eb 0%, #4f8bf9 100%)` |
| 页面背景 | `#f4f7fc` |
| 卡片 / 弹层 | `#ffffff` |
| 主标题 | `#111827` |
| 正文 | `#1f2937` |
| 次级文字 | `#64748b` |
| 弱文字 / 占位 | `#94a3b8`、占位符 `#b7c0cd` |
| 分隔线 | `#edf1f7` |
| 输入底 / 未选中 chip | `#f5f7fb` / `#eef2f8` |
| 选中 chip 底 / 浅描边 | `#e8f0fe` / `#bfdbfe` |
| 禁用态 | `#c3ccda` |

### 2.2 尺寸体系（rpx）

| 项 | 标准 |
|---|---|
| 页面内边距 | `24rpx`（`.page` / `.page-tab`），底部留白 `56rpx / 48rpx` |
| 卡片圆角 / 内边距 / 间距 | `24rpx` / `30rpx` / `20rpx`（`.list-card` 为 `28rpx 30rpx`） |
| 按钮圆角 / 高度 | `20rpx` / `92rpx`，字号 `32rpx` / 600 |
| 输入框 | `.field-box` 圆角 `16rpx`、最小高 `92rpx`、底 `#f5f7fb` |
| chip | 高 `76rpx`、圆角 `38rpx`（全圆）、右间距 `16rpx` |
| 字号 | 正文 `30rpx`、次级 `26rpx`、辅助 `24rpx`、标题 `30rpx/600` |
| 1px 视觉边框 | 用 `2rpx`；分隔线 `2rpx` + `#edf1f7` |
| 阴影 | 卡片 `0 6rpx 24rpx rgba(37,99,235,0.06)`；主按钮 `0 10rpx 24rpx rgba(37,99,235,0.22)` |
| 安全区 | 底部操作区 `padding-bottom: calc(16rpx + env(safe-area-inset-bottom))`；用 `.footer-bar`，**不要** `position: fixed`（会被新页面继承残留） |

### 2.3 必须复用的全局类

`.page` `.page-tab` `.card` `.list-card` `.section-title` `.muted` `.tiny` `.center` `.row` `.between` `.divider` `.footer-bar` `.btn-primary`(+`.is-disabled`) `.btn-ghost` `.chip`(+`.is-active`) `.field` `.field-label` `.field-box`(+`.is-focus`) `.field-input` `.field-tip` `.ph`

> 不允许在页面 wxss 里复制这些类的样式；确需变体时用修饰类（`.xxx.is-active`）。

### 2.4 公共组件（已固化，新页面必须复用）

| 组件 | 入参 | 事件 | 用途 |
|---|---|---|---|
| `day-tabs` | `tabs: Array`、`active: Number` | `change` `{index}` | 行程按天分页的横向 tab，含两侧箭头与滚动测量 |
| `poi-card` | `item: Object`、`editing: Boolean` | `edit` `togglefacts` `up` `down` `remove`（均带 `id`） | 地点卡片，编辑态含排序按钮 |
| `empty-state` | `emoji` `title` `desc` `action`(按钮文案) | `action` | 统一空态，**不要**再写裸 `<view>` 空态 |
| `fact-row` | `label` `value` | — | 键值信息行 |

- 引用方式：页面 json `"usingComponents": { "day-tabs": "/components/day-tabs/day-tabs" }`。
- `plan-b-sheet`、`station-card` 目前**未被任何页面引用**，不得当作既有规范继续扩散，也不要删除。
- 视觉一致性要求：新增卡片必须用 `.card`/`.list-card` 外观；新增主操作必须是 `.btn-primary`；表单必须是 `.field` 结构。

---

## 3. 业务逻辑与边界防呆

### 3.1 三层拦截，顺序不能错

```js
// ① 未登录：只读浏览放行，写操作先弹确认再跳登录
if (!app.checkLogin({ modal: { title: '需要登录', content: '需要登录才能创建行程，是否前往登录？' } })) return
// checkLogin 返回 false 且已自行弹窗/跳转；返回 true 才继续（app.js:58-77）

// ② 只读预览（别人分享的行程，未加入）
if (this.data.readonly) return            // guardWrite() 统一返回布尔，失败已提示（detail.js:115-133）
// preview 由服务端返回：poiService.list() → { preview: true, trip, items }

// ③ 角色
// owner 专属操作（删除行程、移除成员、生成邀请码）服务端 requireOwner；前端只做按钮置灰
```

- 写操作入口（点击、长按、滑动删除）**每一个**都要过 ①②，不能只在页面顶层判一次。
- 只读态下不能「强制跳登录」，只能弹窗说明并引导（`guardWrite` 的现成文案）。

### 3.2 冲突处理标准结构（照抄，不要自创）

```js
async submit() {
  const that = this
  try {
    await tripService.update(this.data.tripId, patch, this.data.version)
    wx.navigateBack()
  } catch (err) {
    // conflict 时：先刷新拿到新版本，用户可选「仍然保存」用新版本重试一次
    if (!conflict.handle(err, this, function () { that.submit() })) {
      // 非 conflict 的错误 run() 已经 toast 过，这里不要重复提示
    }
  }
}
```

约束：

- 页面必须提供 `load()`（`conflict.handle` 会先 `await page.load()`）。
- `retry` 必须是「读 `this.data` 最新状态」的动作，不能是捕获了旧值的闭包。
- `conflict.handle` 返回 `false` 表示不是版本冲突，页面**不得**再补 toast。
- 编辑类页面必须在 `onShow` 重新 `load()`，保证进入即拿到最新 `version`。

### 3.3 业务边界清单（改逻辑前逐条对照）

- 天数：1–15 天；减天前必须检查被删日是否有 POI（`trip.js:115-121`），有则拒绝。
- 地点：每天上限 `LIMITS.POI_PER_DAY = 20`；`order` 用进位编码（`(day+1)*100000` + 步长 1000），换天必须重取 order。
- 标题：`LIMITS.TITLE = 20` 字；留空回退目的地（`create.js:135`）。
- 金额：0 元合法；`evenSplits(openids, 0)` 返回全 0；`openids` 为空/undefined/null 必须返回 `[]` 不抛错（`settle-core.js`）。
- 结算：双指针只对 `balanceCents` 非 0 的人转账；所有人平账时 `transfers` 必须为空数组。
- 邀请码：有效期 7 天，有效期内复用同一个码；生成失败不得阻塞浏览。
- 提醒：`sentAt` 无论成功失败都写入，避免重复推送。

---

## 4. 自动化测试基线（硬性门槛）

### 4.1 单元测试（`tests/unit`）

- **凡新增/修改纯业务算法，必须先在 `cloudfunctions/api/*-core.js` 这类零依赖模块里实现**，并补 `tests/unit/*.test.js` 用例；不允许把可测逻辑写死在 handler 里。
- 用例要求：中文描述、覆盖正常路径 + 至少一个边界（0、空数组、单人、平账、跨天）；金额类断言优先验证**不变量**（转账总额守恒、余额之和为 0）。
- 现有基线：`evenSplits` / `buildSettlement` 共 19 例，全绿才可部署。
- 流程：`npm run test:unit` → 全绿 → 「上传并部署：云端安装依赖」（`cloudfunctions/api` 有改动时必需）。

### 4.2 E2E（`tests/e2e`）

- 必须复用 `tests/e2e/helpers/automator.js`：`launch(port)` / `shutdown(mp)` / `resetState(mp)` / `injectLogin(mp)` / `readPage(mp)` / `waitForRoute` / `waitForData`。
  **禁止**在各测试文件里重复写 spawn 垫片、`automator.launch` 参数、或自己 sleep 后直接断言。
- 端口约定：`smoke.test.js` = 9420，`core-flow.test.js` = 9421；新增 E2E 文件**必须用未占用端口**并 `--runInBand` 串行，避免 IDE 实例互抢。
- 断言约束：
  - 路由必须用 `readPage(mp).route`（或 `waitForRoute`），**不要**依赖 `page.path` / `page.data`（不同工具版本行为不一致）。
  - 页面数据必须用 `waitForData` 轮询到目标态再断言——路由切到 ≠ 数据就绪（详情页 `trip: null` 是典型坑）。
  - 元素查找用 `page.$('.real-class')` + `element.tap()/input()`；**class 名是测试契约**：改 `.fab` `.main-btn` `.c-input` `.head-title` `.empty-btn` 必须同步改测试。
  - 绝对值断言优先用真实业务字段（`trip.destination === '杭州'`），不要只断言「非空」。
- 账号隔离：一律注入 `openid: 'e2e-test-openid'` 的假账号，不得用真实用户数据做断言；测试产生的行程属于该账号。
- 运行：先 `taskkill /F /IM wechatdevtools.exe` 清残留 → `npm run test:e2e`（`--forceExit` 已配置，出现 "Force exiting Jest" 属正常）。
- 涉及原生弹窗（`wx.showModal`）必须 `mockWxMethod('showModal', {confirm:true})`，用完 `restoreWxMethod`。

### 4.3 提交前自检（每条都要能回答「是」）

1. 新接口是否先落 `services/`，页面无直接 `wx.cloud.callFunction`？
2. 写操作是否带 `version`，服务端是否 `assertVersion` + `bumpVersion`？
3. 金额是否整数分、日期是否经 `buildDays` 重建、软删是否带 `deletedAt: ''`？
4. 所有写入口是否都过了 `checkLogin` 与 `readonly` 拦截？
5. 是否复用了 `.card` / `.btn-primary` / `.field` / 四个公共组件，没有新造色值和圆角？
6. 改算法是否补了 `tests/unit`；改交互/class 是否同步了 `tests/e2e`？
7. `npm run test:unit` 是否全绿；`cloudfunctions/api` 有改动是否已说明需重新部署？

---

## 5. 明确禁止清单

- ❌ 新增云函数、绕过 `routes` 直连数据库、在页面里直连云数据库。
- ❌ 信任前端传入的 `openid` / 角色 / 权限字段。
- ❌ 用 `Number` 浮点存或运算金额；用时间戳字符串代替 `YYYY-MM-DD`。
- ❌ 只校验 `version` 不 `bump`，或 `update` 不带 `where({version})`。
- ❌ 在页面 wxss 里硬编码新色值、复制 `.card`/`.btn-primary` 样式、用 `position: fixed` 做底部栏。
- ❌ 复制 `day-tabs` / `poi-card` 的 UI 自造轮子；删除或改造未使用的 `plan-b-sheet` / `station-card`。
- ❌ 只读预览态泄露 `members` / `inviteCode` / `openid`。
- ❌ E2E 里用固定 `sleep` 断言数据、用 `page.data()` 读状态、改 class 名不同步测试。
- ❌ 把可测算法直接写进云函数 handler，导致无法单测。
