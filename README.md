# 下一站 · 旅行计划小程序

一款基于**微信原生小程序 + 云开发 Serverless** 的旅行规划工具：多人协同编排行程、按天排点、AA 记账与最少笔数结算、行程手帐相册，配套 Jest 单元测试与真机 E2E 自动化。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 客户端 | 微信原生小程序（WXML / WXSS / JS），无框架、无构建步骤 |
| 后端 | 微信云开发（单云函数 `api` + action 路由），云数据库 / 云存储 |
| 测试 | Jest 30（纯函数单测）+ miniprogram-automator（真机 E2E，驱动微信开发者工具） |
| 工程约束 | `SKILL.md`（AI 开发规范）、`docs/features.md`（功能与实现细节） |

---

## 核心功能

### 1. 多人协同行程

创建行程后生成邀请码 / 分享卡片，同伴输入邀请码或点链接即可加入（7 天有效期，期内复用同一个码）。成员分 `owner` / `editor` 两种角色，owner 才有权删除行程、移除成员。未加入的访客可以**只读预览**，但看不到成员列表与邀请码。

### 2. 按天排点 + 时间重排

行程最多 15 天、每天最多 20 个地点。地点按 `order` 进位编码排序，支持上移/下移；填了营业时间与停留时长后，可一键「重排时间」——按默认 09:00 出发、每站 30 分钟赶路缓冲，自动算出每站的到达/离开时刻。分类筛选（景点 / 餐饮 / 住宿 / 交通 / 购物 / 其它）与地图页联动。

### 3. AA 记账与最少笔数结算

费用按「元」录入、以**整数分**存库，支持自定义分摊（谁参与、各摊多少）。结算时先算每人实付与应摊，再用**双指针**在债务人与债权人之间撮合，把转账笔数压到最少；老账目只有 `splitWith` 时自动回退按人数均摊。记账页还有跨行程的「总览」聚合。

### 4. 行程手帐 / 相册

按天查看、批量上传照片，支持跨天勾选保留、全选仅作用于当天、管理模式批量删除；照片存云存储，元数据落库，删除时同步清理文件。

### 5. 提醒与分享

行程提醒走微信订阅消息（模板 ID 在 `utils/constants.js` 配置，留空则页面提示未配置）；`sentAt` 无论推送成功与否都会写入，避免重复打扰。

---

## 本地部署与启动

### 前置准备

| 项 | 要求 |
|---|---|
| 微信开发者工具 | 稳定版即可；需登录（右上角有头像） |
| Node.js | ≥ 18（仅用于跑测试，小程序本身不需要 Node 构建） |
| 小程序 AppID | 需开通**云开发**；`project.config.json` 里当前为 `wx0e3b9c362f291912`，换成你自己的 |
| 云开发环境 | 在开发者工具「云开发」控制台创建，记下环境 ID |

### 第 1 步：导入项目

微信开发者工具 → 导入项目 → 选择本仓库根目录（`miniprogram/`）。`project.config.json` 已配置 `miniprogramRoot: "./"`、`cloudfunctionRoot: "cloudfunctions/"`。

### 第 2 步：配置云开发环境 ID（只改一处）

打开 **`utils/constants.js` 第 2 行**：

```js
// utils/constants.js:2
const ENV_ID = 'cloud1-d6g1dqieuca96e71f'   // ← 换成你自己的环境 ID
```

这是全局唯一入口，`app.js:21` 的 `wx.cloud.init({ env: ENV_ID })` 与所有 `services/` 调用都由它驱动，**不要**在其他文件里硬编码环境 ID。

同一文件里还有两处按需修改：

- 第 20 行 `MESSAGE_TEMPLATES.tripReminder`：订阅消息模板 ID，不配置则提醒功能提示「未配置」；
- 第 26-30 行 `LIMITS`：天数 / 每日地点数 / 标题长度上限。

### 第 3 步：创建数据库集合与权限

在云开发控制台「数据库」新建 5 个集合：

```
users   trips   pois   expenses   files
```

- 权限建议统一设为「**所有用户不可读写**」（即仅云函数可访问）——所有读写都经过云函数 `api`，前端不直连数据库；
- 建议索引：`trips.ownerOpenid`、`trips.memberOpenids`（数组）、`pois.tripId`、`expenses.tripId`、`files.tripId`；
- 云存储无需手动建目录，首次上传自动创建。

### 第 4 步：部署云函数

右键 `cloudfunctions/api` → **上传并部署：云端安装依赖**。

- 全项目只有这一个云函数，新增接口是「加 handler + 加路由」，**不要**新建云函数；
- 之后每次改动 `cloudfunctions/` 都要重新部署一次，否则测试跑的是旧逻辑。

### 第 5 步：运行测试

```bash
# 安装测试依赖（仅首次）
npm install

# 单元测试：均摊 / 双指针结算等纯函数，秒级完成
npm run test:unit

# E2E：真机自动化，需先满足下方前置条件
npm run test:e2e

# 全量：单测 + E2E
npm run test:all
```

**E2E 前置条件（缺一不可）**：

1. 开发者工具已登录，且「设置 → 安全设置 → 服务设置 → **服务端口**」已开启；
2. **关掉当前打开的本项目 IDE 窗口**——测试会自己用 `cli --auto` 拉起自动化实例；
3. 有残留实例时先清理：`taskkill /F /IM wechatdevtools.exe`；
4. `cliPath` 默认写死为 `D:/Tencent/微信web开发者工具/cli.bat`，路径不同请改 `tests/e2e/helpers/automator.js` 的 `CLI_PATH`。

跑完 E2E 后 IDE 会被自动关闭；`Force exiting Jest` 是 `--forceExit` 的正常提示，不是失败。

---

## 目录结构

```
.
├── app.js / app.json / app.wxss    全局入口：登录态恢复、页面与 tabBar 注册、设计令牌
├── pages/                          14 个页面
│   ├── login/                      登录页（入口分流）
│   ├── trips/                      行程列表 / 新建 / 邀请 / 加入
│   ├── trip/                       行程详情 / 地图 / 手帐
│   ├── poi/                        地点编辑（含时间重排）
│   ├── ledger/                     记账总览（跨行程聚合）
│   ├── expense/                    新增费用 / 账单列表 / 结算
│   └── profile.js, about/          我的 / 关于（profile 四件套在 pages/ 根目录）
├── components/                     day-tabs、poi-card、empty-state、fact-row（已固化）
├── services/                       前端唯一数据出入口，封装 cloud.call / run
├── utils/                          constants（环境 ID、白名单、LIMITS）、format、conflict 等
├── cloudfunctions/api/             单云函数：index.js 路由表 + 各域 handler + guard/db/util
│   └── settle-core.js              结算纯算法（被单测直接 require）
├── tests/
│   ├── unit/                       Jest 纯函数用例（settle.test.js）
│   └── e2e/                        automator 真机用例 + helpers/automator.js 公共底座
├── docs/features.md                功能与实现细节（改动前先读）
├── SKILL.md                        AI 开发规范（强制约束）
└── AI_CONTEXT.md                   给新接手 AI 的启动提示词
```

---

## 已知限制

- **无离线缓存**：所有数据实时走云函数，弱网/无网下只能看到当前内存中的数据；
- **无 AI 能力**：自然语言记账、AI 生成行程均未接入（已在 backlog）；
- **排序靠按钮**：地点排序是上移/下移，没有拖拽交互；
- **行程状态不自动流转**：`planning / ongoing / ended` 目前需手动切换，未按日期自动推进；
- **无导出**：不支持导出行程为图片 / PDF / 日历；
- **订阅消息受微信限制**：需用户主动授权一次，且模板 ID 需自行在公众平台申请；
- **单云函数冷启动**：所有接口共用一个云函数，首次调用可能有秒级延迟；
- **E2E 依赖本机 GUI**：无法在无头 CI 中运行，且黄金链路会在云端 `trips` 集合留下 owner 为 `e2e-test-openid` 的测试数据（按该字段清理即可）；
- **仅中文 / 浅色主题**：无多语言、无深色模式。

---

## 相关文档

- `SKILL.md`：架构、数据契约、视觉令牌、拦截规则、测试基线的**强制规范**，改代码前必读；
- `docs/features.md`：逐模块的实现细节（路由表、算法、字段含义）；
- `AI_CONTEXT.md`：把项目交接给其他 AI 时，连同代码一起提供。
