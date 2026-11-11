---
kind: external_dependency
name: 微信云开发（WeChat Cloud Development）
slug: wechat-cloud-development
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - cloudfunctions/api/package.json
    - project.config.json
    - docs/方案.md
---

### 身份与角色
- 本项目后端运行在**微信云开发**，AppID `wx0e3b9c362f291912`，环境 ID `cloud1-d6g1dqieuca96e71f`。
- 数据库集合 `users / trips / pois / expenses / files` 由云函数首次请求自动创建，权限设为「仅管理端可读写」，前端不直连数据库。
- 云存储用于手帐照片，路径 `journal/<tripId>/`。
- 订阅消息通过 `cloud.openapi.subscribeMessage.send` 发送，模板 id 集中在 `utils/constants.js`，定时触发器 `dailyReminder` 每天 20:00 触发。

### 关键约束
- 小程序侧使用 `wx.request` 访问外部域名需备案并配置白名单；本项目所有外部调用走云函数代理，避免域名与密钥泄露问题。
- 开发者工具中 `wx.chooseLocation` 返回固定模拟坐标、`moveToLocation` 不支持，地图定位类功能必须真机验收。
- 云函数目录必须拍平，子目录或残留空目录会导致部署报 `EISDIR`。