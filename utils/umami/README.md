# Umami 小程序 SDK

`app.js` 将根目录 `config.js` 中的 `umami` 配置注入 SDK。SDK 不读取业务配置，也不复用业务请求层。

- `enabled` 为 `false` 时不会发送请求；开发联调时再显式开启。
- `debug` 只记录投递失败等 SDK 状态，不记录事件载荷或业务数据。
- 可选 `tag` 会附加到每个页面访问和自定义事件；联调使用 `test-audience`，可在 Umami 的 **Filter → Tag** 中筛选测试受众。它不会额外发送事件，因此不会改变跳出率。
- 页面统一用 `definePage` 注册，`onShow` 自动发送一次 PV；不要再手动发送 PV。
- 只允许 `login_success`、`search_submit`、`release_click`、`draft_save_click`、`home_refresh` 及其白名单属性。
- 队列最多 50 条，网络和 5xx 最多重试两次；不会持久化或保证恰好一次投递。

上线前须在真机验证 HTTPS request 合法域名、User-Agent 接受情况、referrer、语言展示及 UV 口径。当前局域网 endpoint 仅供开发环境联调。
