// 核心业务链路 E2E：未登录拦截 → 表单校验 → 创建行程黄金闭环。
//
// 与 smoke.test.js 分开跑：各自 launch / close 一个 IDE 实例，端口不同（9421 vs 9420），
// 靠 --runInBand 串行，互不干扰。
//
// 为什么用官方 miniprogram-automator 而不是 miniprogram-automator-next：
// next 的元素层（query/tap/input）是在 evaluate 里 `return new Promise(...)` 实现的，
// 当前这版开发者工具不会回传该 Promise 的解析值，跨桥序列化直接抛
// 「An object could not be cloned.」。官方 SDK 的 page.$ / Element.tap 在本机实测可用。
//
// 注意：黄金链路会真的调云函数创建一趟行程（owner 为 e2e-test-openid），
// 与你自己的账号数据互不可见，但云端 trips 集合会累积测试数据。

const { launch, shutdown, resetState, injectLogin, readPage, waitForRoute, waitForData } = require('./helpers/automator')

jest.setTimeout(300000)

let mp

beforeAll(async () => {
  mp = await launch(9421)
}, 240000)

afterAll(async () => {
  await shutdown(mp)
})

describe('E2E 核心业务链路', () => {
  test('开发者工具与小程序成功启动', async () => {
    const sys = await mp.systemInfo()
    expect(sys.SDKVersion).toBeTruthy()
  })

  // —— 场景一：未登录拦截 ——

  test('未登录点「新建」被登录守卫拦截，不会进入 create 页', async () => {
    await resetState(mp)

    const page = await mp.reLaunch('/pages/trips/list')
    await page.waitFor(800)
    expect((await readPage(mp)).route).toBe('pages/trips/list')

    // list.onCreate → app.checkLogin({ modal }) 会弹原生 showModal。
    // 自动化环境里点不到原生弹窗，mock 成「用户点了去登录」。
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false })

    const fab = await page.$('.fab')
    expect(fab).toBeTruthy()
    await fab.tap()

    const route = await waitForRoute(mp, 'pages/login/login', 10000)
    await mp.restoreWxMethod('showModal')

    // 拦截生效：确认后跳到登录页，绝不会直接进 create 页
    expect(route).toBe('pages/login/login')
    expect(route).not.toBe('pages/trips/create')
  })

  // —— 场景二：表单校验 ——

  test('目的地为空时点「开始规划」，被前端校验拦在 create 页', async () => {
    await resetState(mp)
    expect(await injectLogin(mp)).toBe(true)

    const page = await mp.reLaunch('/pages/trips/create')
    await page.waitFor(800)

    // 不填目的地直接提交：onSubmit 的 destination.trim() 只 toast，不跳转
    const submit = await page.$('.main-btn')
    expect(submit).toBeTruthy()
    await submit.tap()
    await page.waitFor(1200)

    expect((await readPage(mp)).route).toBe('pages/trips/create')
  })

  // —— 场景三：黄金链路闭环 ——

  test('填目的地 → 创建 → 跳详情页，页面数据拿到真实行程', async () => {
    await resetState(mp)
    expect(await injectLogin(mp)).toBe(true)

    const page = await mp.reLaunch('/pages/trips/create')
    await page.waitFor(800)

    // 第一个 .c-input 是目的地输入框（data-field="destination"）
    const destination = await page.$('.c-input')
    expect(destination).toBeTruthy()
    await destination.input('杭州')

    // 默认模式是 solo：创建成功后 redirectTo 详情页，不弹「是否邀请同伴」
    const submit = await page.$('.main-btn')
    await submit.tap()

    // 云函数落库 + redirectTo 需要时间，轮询最多 20 秒（比固定 sleep 稳）
    const route = await waitForRoute(mp, 'pages/trip/detail', 20000)
    expect(route).toBe('pages/trip/detail')

    // 路由到位只是 onLoad 跑到了，详情页里的 trip.get 云调用还没回来，
    // data.trip 此刻仍是初始的 null —— 必须等数据落地再断言
    const { data } = await waitForData(
      mp,
      function (d) {
        return !!(d.trip && d.trip._id && Array.isArray(d.trip.days))
      },
      20000
    )

    // 详情页 data.trip 是云函数返回的真实行程
    expect(data.trip).toBeTruthy()
    expect(data.trip._id).toBeTruthy()
    expect(data.trip.destination).toBe('杭州')
    // 名称留空时后端回退用目的地
    expect(data.trip.title).toBe('杭州')
    // days 由起止日期在服务端推导（默认今天 → 明天 = 2 天）
    expect(data.trip.days.length).toBe(2)
  })
})
