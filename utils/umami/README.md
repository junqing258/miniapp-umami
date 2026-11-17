# Umami 小程序 SDK

`app.js` 将根目录 `config.js` 中的 `umami` 配置注入 SDK。SDK 不读取业务配置，也不复用业务请求层。

- `enabled` 为 `false` 时不会发送请求；开发联调时再显式开启。
- `debug` 只记录投递失败等 SDK 状态，不记录事件载荷或业务数据。
- 可选 `tag` 会附加到每个页面访问和自定义事件；联调使用 `test-audience`，可在 Umami 的 **Filter → Tag** 中筛选测试受众。它不会额外发送事件，因此不会改变跳出率。
- 页面统一用 `definePage` 注册，`onShow` 自动发送一次 PV；不要再手动发送 PV。
- `definePage` 还会在每个页面首次 `onReady` 后发送 `performance_page_ready`，其 `duration_ms` 是从该页面 `onLoad` 到业务 `onReady`（包括 `async onReady` 所等待工作）的耗时；首个就绪页面同时发送一次 `performance_app_startup`，表示 App `onLaunch` 到首屏就绪的耗时。
- SDK 会使用 `wx.getPerformance().createObserver()` 监听 `render` 条目：以 `firstRender.startTime` 为基准，分别上报 `firstContentfulPaint` 的 `performance_fcp` 和 `largestContentfulPaint` 的 `performance_lcp`，字段均为 `value_ms`。仅在三者时间戳有效且差值大于 0 时上报；旧基础库或不支持这些条目的设备会跳过，不影响业务。
- SDK 同时监听 `navigation` 和 `script` 条目：`appLaunch.duration` 上报为 `performance_app_launch`；分包页面的 `route.duration` 上报为 `performance_subpackage_route`；`evaluateScript.duration` 结合 `moduleName` 上报为 `performance_package_script`（主包记为 `main`）。在 `config.umami.subpackages` 中维护 `app.json` 分包根目录与名称的映射。
- `performance_subpackage_route` 是用户实际等待的进入分包页面总耗时，可能包含下载、注入、初始化和页面切换；自动下载没有稳定的纯下载耗时 API，不能将该指标标记为纯下载时间。
- 微信小程序 Performance API 目前没有交互时序或布局偏移条目，因而不能据此计算真实 INP、CLS；SDK 不会用点击或 `setData` 耗时冒充这两个指标。
- 性能事件只含 `duration_ms`，页面路由使用现有 Umami `url` 字段，不采集请求地址、设备标识或业务数据。
- 只允许已在 `sanitize.js` 白名单中声明的业务及性能事件和属性。
- 队列最多 50 条；正常情况下最多合并 10 条、等待 1.5 秒后调用 `/api/batch`，以降低请求数。目标实例不支持批量接口时自动回退为逐条 `/api/send`。
- 网络和 5xx 最多重试两次，按指数退避并加入随机抖动；不会持久化或保证恰好一次投递。

上线前须在真机验证 HTTPS request 合法域名、User-Agent 接受情况、referrer、语言展示及 UV 口径。当前局域网 endpoint 仅供开发环境联调。
