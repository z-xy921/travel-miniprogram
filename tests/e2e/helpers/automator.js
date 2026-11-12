// E2E 公共环境：spawn 兼容垫片 + IDE 启动/关闭 + 登录态注入 + 页面栈读取。
//
// 为什么单独抽一个文件：
// 1. spawn 垫片必须在 require('miniprogram-automator') 之前打上，而 automator 在
//    模块加载时就会把 child_process.spawn 取到闭包里，所以「先打补丁、后 require」
//    的顺序只能在一个文件里保证，散落在各个 test 文件里容易出错。
// 2. IDE 的关闭方式很容易写错（见 shutdown 的注释），集中一处避免踩两次。

const path = require('path')
const childProcess = require('child_process')

// —— Windows / 新版 Node 兼容垫片 ——
// Node 18.20+/20.12+/21.7.2+ 出于 CVE-2024-27980 加固，spawn 一个 .bat 且带参数
// 会直接抛 EINVAL（实测 Node v24 同样如此）。miniprogram-automator 内部是裸
// spawn(cli.bat, ['auto', ...])，会报误导性的
// 「Failed to launch wechat web devTools, please make sure cliPath is correctly specified」。
if (!childProcess.__wechatE2ePatched) {
  const originalSpawn = childProcess.spawn
  childProcess.spawn = function patchedSpawn(file, args, options) {
    if (typeof file === 'string' && /\.bat$/i.test(file)) {
      return originalSpawn('cmd.exe', ['/c', file.replace(/\//g, '\\')].concat(args || []), options)
    }
    return originalSpawn.call(childProcess, file, args, options)
  }
  childProcess.__wechatE2ePatched = true
}

const automator = require('miniprogram-automator')

const CLI_PATH = 'D:/Tencent/微信web开发者工具/cli.bat'
// helpers -> e2e -> tests -> 项目根
const PROJECT_PATH = path.resolve(__dirname, '..', '..', '..')

// 拉起 IDE + 小程序，返回 automator 的 MiniProgram
function launch(port) {
  return automator.launch({
    cliPath: CLI_PATH,
    projectPath: PROJECT_PATH,
    port: port,
    trustProject: true,
    timeout: 240000
  })
}

// 关闭 IDE 本体。注意：官方只提供 close()（= App.exit + Tool.close），
// 没有单独的 disconnect；只要不调用它，IDE 窗口会一直开着占住项目，
// 下一个测试文件 launch 时就会连到一个正在被回收的进程，报
// 「Connection closed, check if wechat webDevTools is still running」。
// 这里吞掉异常：IDE 已经自己退出的情况下 close() 必然 reject，不算失败。
async function shutdown(mp) {
  if (!mp) return
  try {
    await mp.close()
  } catch (e) {
    // 连接已断开，IDE 已退出，无需处理
  }
  // 给 IDE 进程退出留出时间，避免下一个文件 launch 时撞上残留实例
  await new Promise(function (resolve) { setTimeout(resolve, 3000) })
}

// 清空 Storage 与 globalData，回到「未登录」的干净状态
async function resetState(mp) {
  await mp.evaluate(function () {
    wx.clearStorageSync()
    var app = getApp()
    app.globalData.userInfo = null
    app.globalData.openid = ''
    app.globalData.loginRedirect = ''
    return true
  })
  // 冷启动遗留的导航（switchTab 等）可能还排在队列里，等它跑完再操作
  await new Promise(function (resolve) { setTimeout(resolve, 800) })
}

// 注入登录态：globalData 立即生效（isLogin() 为真），Storage 保证冷启动可恢复
function injectLogin(mp) {
  return mp.evaluate(function () {
    var app = getApp()
    var user = {
      hasLogin: true,
      openid: 'e2e-test-openid',
      nickname: 'E2E测试用户',
      avatar: ''
    }
    app.globalData.userInfo = user
    app.globalData.openid = user.openid
    wx.setStorageSync('userInfo', user)
    wx.removeStorageSync('loginSkipped')
    return app.isLogin()
  })
}

// 读页面栈顶层的 route + data。
// 不走 Page.data 协议：不同工具版本上该协议时好时坏，而 App.callFunction
// （也就是 mp.evaluate）一直可用，返回的是可序列化的普通对象。
function readPage(mp) {
  return mp.evaluate(function () {
    var ps = getCurrentPages()
    if (!ps.length) return { route: '', data: {} }
    var page = ps[ps.length - 1]
    var data = {}
    var keys = Object.keys(page.data)
    for (var i = 0; i < keys.length; i++) {
      data[keys[i]] = page.data[keys[i]]
    }
    return { route: page.route, data: data }
  })
}

// 轮询等待页面栈顶层切到目标路由；超时返回最后一次读到的路由，交给断言报错
async function waitForRoute(mp, target, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 15000)
  var route = ''
  while (Date.now() < deadline) {
    route = (await readPage(mp)).route
    if (route === target) return route
    await new Promise(function (resolve) { setTimeout(resolve, 500) })
  }
  return route
}

// 轮询等待页面 data 满足条件。路由切换只能说明 onLoad 跑到了，页面里
// onLoad/onShow 发起的云函数调用还没回来，data 仍是初始值（比如详情页的
// trip: null），所以断言数据前必须等这一跳，否则读到的是空窗期的快照。
// predicate 在 Node 侧执行，参数是 (pageData, route)。
async function waitForData(mp, predicate, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 15000)
  var page = { route: '', data: {} }
  while (Date.now() < deadline) {
    page = await readPage(mp)
    if (predicate(page.data, page.route)) return page
    await new Promise(function (resolve) { setTimeout(resolve, 400) })
  }
  return page
}

module.exports = {
  automator: automator,
  CLI_PATH: CLI_PATH,
  PROJECT_PATH: PROJECT_PATH,
  launch: launch,
  shutdown: shutdown,
  resetState: resetState,
  injectLogin: injectLogin,
  readPage: readPage,
  waitForRoute: waitForRoute,
  waitForData: waitForData
}
