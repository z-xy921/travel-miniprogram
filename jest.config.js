module.exports = {
  // 纯函数测试跑在 Node 环境；e2e（miniprogram-automator）也是 Node 进程驱动
  testEnvironment: 'node',

  // 只收集 tests 目录，云函数源码（cloudfunctions）不当作测试扫描
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],

  // e2e 需要打开微信开发者工具，CI/无工具环境下跳过该目录由 --testPathPattern 控制
  // 整体跑 npm test 时 e2e 也会执行，请在已安装并登录开发者工具的机器上运行
  testTimeout: 30000
}
