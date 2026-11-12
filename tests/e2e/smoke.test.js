// E2E 冒烟：启动 IDE → 清空状态 → 注入登录态 → 行程列表页 → 关键元素断言。
//
// 前置条件：
// 1. 本机装有微信开发者工具且已登录（右上角有头像）；
// 2. 工具「设置 → 安全设置 → 服务设置 → 服务端口」已开启；
// 3. 运行前关掉已打开的本项目 IDE 窗口（launch 会自己拉起自动化实例）。
//
// 跑之前如果卡住不动，先清残留实例：
//   taskkill /F /IM wechatdevtools.exe

const { launch, shutdown, resetState, injectLogin, readPage } = require('./helpers/automator')

jest.setTimeout(300000)

let mp

beforeAll(async () => {
  mp = await launch(9420)
}, 240000)

afterAll(async () => {
  await shutdown(mp)
})

describe('E2E 冒烟：登录态注入 + 行程列表页', () => {
  test('开发者工具与小程序成功启动', async () => {
    const sys = await mp.systemInfo()
    expect(sys.SDKVersion).toBeTruthy()
  })

  test('清空 Storage 与 globalData（回到未登录）', async () => {
    await resetState(mp)
    // 此时停在登录页或列表页都正常，只要求状态已干净
    const { route } = await readPage(mp)
    expect(['pages/login/login', 'pages/trips/list']).toContain(route)
  })

  test('注入已登录状态（globalData + Storage）', async () => {
    expect(await injectLogin(mp)).toBe(true)
  })

  test('reLaunch 到行程列表页，路径正确', async () => {
    const page = await mp.reLaunch('/pages/trips/list')
    await page.waitFor(800)
    // route 取页面栈顶层的 route，即 app.json 里注册的路径，不带前导斜杠
    expect((await readPage(mp)).route).toBe('pages/trips/list')
  })

  test('页面已进入登录态：顶部标题存在，不再显示「去登录」引导', async () => {
    const page = await mp.currentPage()

    const title = await page.$('.head-title')
    expect(title).toBeTruthy()
    expect(await title.text()).toBe('下一站，去哪？')

    // 登录态下 onShow 的 needLogin 分支不该触发，空状态里不会有「去登录」
    const loginBtn = await page.$('.empty-btn')
    if (loginBtn) {
      expect(await loginBtn.text()).not.toBe('去登录')
    }
  })

  test('能看到「新建行程」悬浮按钮（＋ FAB）', async () => {
    const page = await mp.currentPage()
    const fab = await page.$('.fab')
    expect(fab).toBeTruthy()
    expect(await fab.text()).toContain('＋')
  })

  test('已登录点新建：登录守卫放行，进入 create 页', async () => {
    const page = await mp.currentPage()
    const fab = await page.$('.fab')
    await fab.tap()
    await page.waitFor(1200)

    const { route } = await readPage(mp)
    expect(route).toBe('pages/trips/create')
  })
})
