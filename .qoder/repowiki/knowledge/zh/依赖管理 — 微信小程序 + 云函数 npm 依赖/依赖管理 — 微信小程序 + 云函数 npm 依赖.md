---
kind: dependency_management
name: 依赖管理 — 微信小程序 + 云函数 npm 依赖
category: dependency_management
scope:
    - '**'
source_files:
    - cloudfunctions/api/package.json
    - cloudfunctions/api/package-lock.json
---

## 1. 使用的系统/方式

仓库采用**双轨依赖管理**：
- 前端（小程序）：无 Node.js 包管理器，依赖由微信开发者工具在上传时解析 `project.config.json` 中的 `setting.packNpmManually` / `packNpmPackageList` 等配置处理；本仓库未包含 `package.json`、`package-lock.json` 或 `node_modules`，说明前端代码不声明第三方 npm 依赖。
- 后端（云函数）：使用 **npm** 管理 Node.js 依赖，位于 `cloudfunctions/api/package.json`，仅依赖 `wx-server-sdk`。

## 2. 关键文件

- `cloudfunctions/api/package.json`：云函数的唯一依赖清单，声明 `wx-server-sdk ~2.6.3`。
- `cloudfunctions/api/package-lock.json`：npm 锁文件，用于固定 `wx-server-sdk` 及其传递依赖的精确版本。
- `cloudfunctions/api/node_modules/`：本地安装的依赖目录（已存在于工作区）。
- `cloudfunctions/ping/`：另一个云函数目录，当前为空，尚未引入依赖。

## 3. 架构与约定

- 所有业务逻辑被封装为云函数（`cloudfunctions/api`），小程序前端通过 `services/cloud.js` 调用，形成“小程序前端 → services 层 → 云函数”的分层结构。依赖边界清晰：只有云函数侧需要 Node.js 运行时和 npm。
- 云函数内部按业务域拆分模块（`expense.js`、`poi.js`、`trip.js`、`user.js`、`notify.js`、`photo.js`、`guard.js`、`db.js`、`util.js`），但共享同一个 `package.json`，即整个云函数应用作为一个 npm 包发布。
- 依赖范围单一：目前只引入微信官方 SDK `wx-server-sdk`，没有引入其他第三方库，也没有私有 registry 或镜像源配置出现在 `package.json` 中。

## 4. 约定与约束

- 云函数依赖通过 `cloudfunctions/api/package.json` 的 `dependencies` 字段声明，当前仅允许 `wx-server-sdk` 这一类官方 SDK（观察到的约束，非强制规则）。
- 版本号使用 `~2.6.3` 语义化版本范围（允许补丁更新），而非精确锁定到次版本，这是 `package.json` 中实际采用的写法。
- 存在 `package-lock.json`，表明团队期望通过 npm 锁文件保证可重复安装（npm 默认行为）。
- 未发现 `.npmrc`、`registry`、`GOPRIVATE`、`vendor/` 等私有源或 vendoring 配置，也未见 CI 脚本对依赖进行自动升级或审计（如 `npm audit`、Dependabot 等）。
- 前端小程序侧未维护任何 npm 依赖清单，第三方能力（如地图、支付）应通过微信原生 API 或小程序插件提供，不在本仓库内声明。

总结：该仓库的依赖管理非常轻量——仅云函数端使用 npm 管理单个官方 SDK，并通过 lockfile 固定版本；前端无 Node.js 依赖。