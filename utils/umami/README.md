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
- 性能事件仅含白名单耗时/分包字段、入口场景和系统信息公共字段；页面路由使用现有 Umami `url` 字段，不采集请求地址、设备唯一标识或业务数据。
- 只允许已在 `sanitize.js` 白名单中声明的业务及性能事件和属性。
- 队列最多 50 条；正常情况下最多合并 10 条、等待 1.5 秒后调用 `/api/batch`，以降低请求数。目标实例不支持批量接口时自动回退为逐条 `/api/send`。
- 网络和 5xx 最多重试两次，按指数退避并加入随机抖动；不会持久化或保证恰好一次投递。

上线前须在真机验证 HTTPS request 合法域名、User-Agent 接受情况、referrer、语言展示及 UV 口径。当前局域网 endpoint 仅供开发环境联调。

## 系统与设备信息

SDK 使用微信 API 获取真实系统信息，随已有 PV、业务和性能事件写入 `payload.data`，不额外增加事件。优先使用 `wx.getDeviceInfo`、`wx.getAppBaseInfo`、`wx.getWindowInfo`；接口不可用或抛错时回退 `wx.getSystemInfoSync`，全部失败时跳过缺失字段，不影响业务。官方已停止维护 `wx.getSystemInfo`，因此不新增对它的调用。

| 属性 | 微信 API 字段 |
| --- | --- |
| `wx_brand`、`wx_model` | `brand`、`model` |
| `wx_system`、`wx_platform` | `system`、`platform` |
| `wx_version`、`wx_sdk_version` | 微信 `version`、基础库 `SDKVersion` |
| `wx_language` | `language`，如 `zh_CN` 规范化为 `zh-CN` |
| `wx_screen_width`、`wx_screen_height` | `screenWidth`、`screenHeight` |
| `wx_window_width`、`wx_window_height` | `windowWidth`、`windowHeight` |
| `wx_pixel_ratio` | `pixelRatio` |

字符串去首尾空白且最多 80 个 Unicode 字符；尺寸和像素比只接受有限正数。设备与客户端信息在内存中缓存，窗口信息每次构建事件时更新，以适配旋转/窗口缩放。Umami 标准 `language` 同步使用 API 语言，`screen` 优先采用屏幕尺寸，旧版本缺失时使用窗口尺寸。

在 Umami 支持的自定义属性/数据细分中查看 `wx_*` 字段；这些属性不会自动改写依赖请求 User-Agent 的标准浏览器/操作系统分类，也不会解除模拟器的机器人过滤。SDK 不生成设备 ID、不上传系统权限开关、宿主 appId 或系统信息完整对象。

## UTM 渠道统计

在推广二维码或分享入口的小程序页面路径中携带渠道参数，例如：

```text
pages/home/index?utm_source=wechat&utm_medium=qrcode&utm_campaign=模拟拉新活动
```

开发者工具中可将启动页面设为 `pages/home/index`、场景值设为 `1047`、启动参数设为 `utm_campaign=模拟拉新活动`；SDK 会补齐 `utm_source=wechat`、`utm_medium=qrcode`。重新编译后检查请求与 Umami 的 **增长 → UTM**。构造实际二维码/分享 URL 时应将中文活动名 URL 编码一次；填写开发者工具的原始启动参数时可直接使用中文。

目标实例可能将开发者工具 User-Agent 识别为机器人：`/api/send` 返回 `200` 和 `{"beep":"boop"}` 表示跳过入库，批量接口的 `processed` 也不保证已入库。应结合实际报表或真机验收；本次联调记录见 `docs/umami-verification.md`。

- App 的 `onLaunch` / `onShow` 将完整入口参数交给 `setEntryOptions`。入口 `query` 仍只读取 `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`：只接受非空字符串，每项最多 80 个 Unicode 字符，编码后放入页面访问和自定义事件的 `payload.url` 查询串，供 Umami 解析。
- **显式 UTM 优先**：存在有效的微信顶层数字 `options.scene` 时，按场景补齐缺失的 Source（`wechat`）及 Medium；不覆盖入口已有的有效字段。无效或空值按缺失处理。场景只说明入口类型，无法推断活动名称，因此绝不自动生成 Campaign、Term、Content。
- 渠道与场景仅保存在内存中，本次前台访问的页面切换、业务和性能事件沿用同一入口；每次 App `onShow` 整体替换，无 UTM 时按新场景重新推导，无有效场景且无 UTM 时清空。不继承旧活动、不持久化，已入队记录保留发送时的入口快照。
- 页面和事件的 `payload.data` 都会附加 `wx_scene`（数字）、`wx_scene_name`（简短中文说明）、`wx_scene_category`（分类）。它们与同一条记录 URL 中的 UTM 关联，可在数据细分/事件属性中按场景筛选并结合 UTM 分析；增长 UTM 面板本身仍显示 Source、Medium、Campaign 等标准维度。
- 页面的业务 query 仍全部移除。**顶层 `options.scene` 与二维码业务参数 `options.query.scene` 不同**：后者不会被当成官方场景值或解析成活动，也不上传原文。`referrerInfo`、`shareTicket`、手机号、Token 不上传。自定义小程序码活动需在业务侧定义可信映射后再提供白名单 UTM。
- `tag: test-audience` 只标记受众，不生成活动名称。不要把手机号、用户标识等个人信息填入 UTM 值。
- 不增加额外 PV 或业务事件；历史未采集 UTM 的访问不会自动补齐。

### 场景分类示例

场景值以[微信官方场景表](https://developers.weixin.qq.com/miniprogram/dev/reference/scene-list.html)为准；分类名是本项目的渠道约定，映射位于 `entry.js`。

| 微信场景值 | 入口 | 缺省 Medium |
| --- | --- | --- |
| `1007` / `1008` | 单聊 / 群聊小程序卡片 | `chat_share` / `group_share` |
| `1011`–`1013`、`1047`–`1049` | 二维码 / 小程序码 | `qrcode` |
| `1005`、`1006`、`1053` | 搜索结果 | `search` |
| `1035`、`1058` | 公众号菜单 / 文章 | `official_account` |
| `1045`、`1046`、`1067`、`1200` | 广告入口 | `ad` |
| `1001`、`1089`、`1090` | 最近使用 | `recent` |
| `1030`、`1101` | 自动化测试 / 远程调试 | `test` |
| `1065` / `1194` | URL Scheme / URL Link | `url_scheme` / `url_link` |
| 有效但映射未收录的四位整数 | 保留 `wx_scene`，名称为“未分类场景” | `other` |

未提供合法顶层数字场景时不生成场景数据，也不推导 Source / Medium。这里只维护常用分类，不保证覆盖官方所有场景；新增场景不会因映射缺失中断业务。

本地回归检查：`npm run test:umami`。

## 行为热图（2026-11-20）

`config.umami.heatmap.enabled: true` 启用小程序适配。启动后读取 `/api/websites/{websiteId}/recorder`，仅在服务端 `enabled`、`heatmapEnabled` 均为真且本次启动命中 `heatmapSampleRate` 时采集。采样按 App 启动决定，变更服务端设置后需重新进入小程序。

热图使用独立协议：`POST /api/record`，请求体为 `{ type: 'heatmap', payload: { website, events } }`。普通 `/api/send` 或 `/api/batch` 返回的 `cache` 令牌仅保存在内存，并以 `x-umami-cache` 请求头复用；没有有效服务端令牌时不发送热图。热图最多缓冲 50 条，每批最多 20 条、等待 2 秒；网络/5xx 最多重试两次，页面隐藏或 App 切后台时尽力刷新队列。关闭 SDK 会清空队列和令牌。自定义网关需要分别转发 record/config 接口，可用 `heatmap.endpoint`、`heatmap.configEndpoint` 指定完整地址。

- 页面根节点用 `capture-bind:tap` 读取真实触摸点；不阻止业务事件。只保留坐标、视口/页面尺寸、时间和去掉 query/hash 的路由，不读取元素文字、dataset、表单值或聊天内容。仅有 `detail` 的组件语义事件不构造虚假的点击位置；自定义 TabBar 独立组件的点击未覆盖。
- 普通页面通过 `onPageScroll` 每 400ms 查询几何信息、记录新增的最大阅读深度。`scrollPct` 表示 `(scrollTop + viewportH) / pageH`，不是滑动距离占比。
- 消息/聊天的原生 `scroll-view` 单独测量内容和滚动偏移，点击与深度写入 `/pages/message/index/heatmap-scroll`、`/pages/chat/index/heatmap-scroll`，避免与外层页面坐标混用。
- 首页和“我的”使用组件/CSS 内部滚动，当前只统计可见视口的点击，不将这些点击解释为长页面上的内容位置，也不上报无法测得的内部滚动深度。其他内部滚动容器接入时需要独立适配，不能直接用 Page 的 `onPageScroll` 替代。
- `umami.getHeatmapStatus()` / 页面方法 `__umamiHeatmapStatus()` 只返回 `collecting`、`hasSession`、`queued`，供联调诊断，不返回令牌。

当前部署的 Umami 热图背景采用“网站域名 + 路由”的 iframe，例如 `https://miniapp.xiaoanai.top/pages/home/index`。小程序没有对应网页，因此采集成功并不等于可以展示真实页面背景；需在远程部署适配静态页面/截图背景，并按视口宽度、路由、页面版本及滚动容器匹配。SDK 不自动截屏或上传页面内容。历史未采集的坐标不能回填。

真机联调及当前限制见 `docs/umami-verification.md`。热图专项测试位于 `tests/heatmap.test.cjs`，可运行 `npm test`。
