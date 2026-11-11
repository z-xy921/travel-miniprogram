---
kind: build_system
name: 微信小程序原生构建体系（无外部 CI/Makefile）
category: build_system
scope:
    - '**'
source_files:
    - project.config.json
    - cloudfunctions/api/package.json
    - cloudfunctions/api/package-lock.json
---

## 1. 使用的构建系统

本项目是一个**微信小程序**，采用微信官方工具链进行编译与打包：
- 项目配置位于根目录 `project.config.json`，声明 `compileType: "miniprogram"`、小程序基础库版本 `libVersion: "3.5.5"`。
- 云函数位于 `cloudfunctions/` 目录，由微信开发者工具在上传时自动部署到云开发环境；`cloudfunctions/api/package.json` 是 Node.js 依赖清单，但未见自定义 `scripts` 字段或构建脚本。
- **不存在** Makefile、Dockerfile、CI 配置文件（`.github/workflows`、`.circleci`、`.travis.yml`、`Jenkinsfile` 等）、`build.sh` / `deploy.sh` / `release.sh` 等任何自动化构建脚本。仓库中 grep 搜索这些模式均返回 0 匹配。

因此，本项目的“构建”完全依赖微信开发者工具的 GUI 操作（编译、预览、上传、发布），没有命令行或 CI 流水线。

## 2. 关键文件

- `project.config.json`：唯一的项目级构建配置，包含 appid、基础库版本、ES6/postcss/minifyWXML/minifyWXSS 开关、source map 上传开关、以及打包忽略规则（忽略 `docs`、`.backup`、`.qa-tmp` 三个文件夹）。
- `cloudfunctions/api/package.json` + `package-lock.json`：云函数侧的 npm 依赖管理，但未定义 `start`/`build` 等脚本。
- `app.json`：小程序入口路由与全局配置（非构建配置）。

## 3. 架构与约定

- 前端代码（`pages/`、`components/`、`utils/`、`services/`）与云函数代码（`cloudfunctions/`）在同一仓库内，通过 `project.config.json` 中的 `cloudfunctionRoot: "cloudfunctions/"` 关联。
- 构建产物由微信开发者工具生成并直接上传至微信服务器，本地不产出可分发的 zip/tar 包。
- 打包阶段通过 `packOptions.ignore` 排除文档与备份目录，减小上传体积。

## 4. 约定与约束

- **无外部构建工具链**：仓库中没有 Makefile、Dockerfile、CI 配置或 shell 构建脚本，所有编译、压缩、上传流程均由微信开发者工具完成。
- **基础库锁定**：`project.config.json` 固定使用基础库 `3.5.5`，这是构建兼容性约束。
- **压缩与优化开关**：默认开启 ES6 转译、postcss、minified、minifyWXML、minifyWXSS，并启用 `uploadWithSourceMap`，说明发布产物会携带 source map 用于线上调试。
- **npm 依赖仅用于云函数**：只有 `cloudfunctions/api/` 下有 `package.json` 与 `node_modules`，小程序前端未使用 npm 包管理器（`packNpmManually: false`）。
- **无自动化发布**：未发现任何 CI/CD 文件或发布脚本，发布流程为人工通过微信开发者工具操作。