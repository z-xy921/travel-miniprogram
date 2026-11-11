---
kind: logging_system
name: 基于原生 console.error 与 wx.showToast 的轻量日志输出
category: logging_system
scope:
    - '**'
source_files:
    - app.js
    - cloudfunctions/api/index.js
    - cloudfunctions/api/notify.js
---

## 1. 使用的系统/方式

仓库没有引入任何第三方日志框架（如 `winston`、`log4js`、`bunyan` 等），也没有自定义 logger 模块。日志输出完全依赖：
- 小程序端：`wx.showToast` 用于向用户展示错误提示或操作反馈；无结构化日志。
- 云函数端：Node.js 原生的 `console.error`，以字符串前缀区分来源（如 `[api] timer`、`[api] <action>`）。

全局云开发初始化通过 `wx.cloud.init({ traceUser: true })` 开启微信云开发的内置追踪能力（`app.js` L15-L18），这是仓库中唯一与“可观测性”相关的配置项。

## 2. 关键文件

- `app.js`：应用启动入口，仅包含一个 `console.error` 调用，用于在基础库不支持云开发时给出调试提示。
- `cloudfunctions/api/index.js`：单入口云函数，集中捕获所有 action 处理异常并通过 `console.error('[api]', action, err)` 输出；定时触发器分支使用 `console.error('[api] timer', event && event.TriggerName, err)`。
- `cloudfunctions/api/notify.js`：定时通知任务中的异常路径也使用 `console.error`。

其余业务页面与服务层（`pages/*`、`services/*`、`utils/*`）未出现 `console.log/error/warn/info` 调用，也未发现任何日志级别、日志格式或日志收集器的定义。

## 3. 架构与约定

- **无统一日志抽象**：前端与后端各自直接使用平台提供的 API，不存在共享的 logger 模块。
- **云函数侧采用单一入口 + action 路由**（`cloudfunctions/api/index.js`），所有业务 handler 的错误都经同一个 try/catch 捕获，因此错误日志集中在两处：定时触发器分支（L51）与普通 action 分支（L68）。
- **错误信息透传模式**：catch 块返回 `{ ok: false, code, message }`，由上层 `services/cloud.js` 通过 `wx.showToast` 展示给用户（例如 `err.message || '操作失败'`）。这构成了“服务端 error → 客户端 toast”的单向错误传播链，而非真正的日志管道。
- **traceUser 开关**：`app.js` 中 `wx.cloud.init({ traceUser: true })` 是仓库内唯一的可观测性开关，用于让微信云控制台关联用户 openid。

## 4. 约定与约束

- **描述性观察**：仓库中所有的运行时诊断输出均通过 `console.error`（云函数）和 `wx.showToast`（小程序）完成；未发现日志等级（debug/info/warn/error）、日志格式化、日志轮转、日志采样或远程上报逻辑。
- **已验证的规则**：`cloudfunctions/api/index.js` 是唯一集中捕获并记录云函数异常的位置——所有业务 handler 的异常均被其顶层 try/catch 捕获后统一 `console.error` 输出，再返回标准化 `{ ok: false, code, message }` 响应体（L62-L75）。
- **约束来源**：该行为由代码结构本身强制（单入口 + 统一 catch），而非文档声明。

综上，本仓库的“日志系统”是一个极简实现：云函数侧用 `console.error` 打印带 `[api]` 前缀的错误，小程序侧用 `wx.showToast` 把错误消息呈现给用户，并通过 `wx.cloud.init({ traceUser: true })` 启用微信云平台的用户追踪。