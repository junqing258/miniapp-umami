# miniapp-umami

微信小程序的 Umami 统计 SDK，零运行时依赖。支持页面访问、自定义事件、UTM 渠道、入口场景、性能指标、会话属性、A/B 实验，以及可选的错误监控和行为热图。

[GitHub 仓库](https://github.com/junqing258/miniapp-umami) · [问题反馈](https://github.com/junqing258/miniapp-umami/issues)

## 安装

```sh
npm install miniapp-umami
```

安装后，在微信开发者工具中执行 **工具 → 构建 npm**，再编译小程序。

包的微信小程序入口为 `lib/`；ESM 使用 `src/`，CommonJS 使用 `lib/`。运行时需要微信的 `wx`、`Page`、`getCurrentPages`，不适用于浏览器网页或 Node.js 服务端。Node.js 18+ 用于本地开发和构建。

## 快速接入

### 初始化 App

将下面的统计调用合并到现有 App 生命周期中。`endpoint` 是采集地址，`hostname` 是统计中标识小程序的逻辑域名，两者用途不同。

```js
// app.js
import umami from 'miniapp-umami';

App({
  onLaunch(options = {}) {
    umami.init({
      enabled: true,
      endpoint: 'https://analytics.example.com/api/send',
      websiteId: 'your-website-id',
      hostname: 'miniapp.example.com',
      eventProperties: {
        purchase: ['amount', 'currency'],
        publish_click: [],
      },
    });
    umami.setEntryOptions(options);
    umami.markLaunch();
  },
  onShow(options = {}) {
    umami.setEntryOptions(options);
  },
  onHide() {
    umami.flush();
  },
});
```

`init` 每次运行只接受第一次调用。首次以 `enabled: false` 或缺少必要参数初始化后，不能通过再次 `init` 或 `setEnabled(true)` 完成初始化，需要重新启动并传入完整配置。

如果需要启动后动态控制统计，先完成有效初始化，再使用 `setEnabled(false)` / `setEnabled(true)`。仅在允许采集时初始化和发送事件。

### 注册页面与发送事件

```js
// pages/home/index.js
import umami from 'miniapp-umami';
import { definePage } from 'miniapp-umami/page';

definePage({
  onPurchase() {
    umami.track('purchase', { amount: 99, currency: 'CNY' });
  },
  onPublish() {
    umami.track('publish_click');
  },
});
```

`definePage` 代替 `Page`，保留业务生命周期的 `this`、参数和返回值，并自动完成：

- 每次 `onShow` 发送一次页面访问，记录前一个页面作为 referrer。
- 首次 `onReady` 后记录页面就绪耗时；若业务返回 Promise，会等待其完成。
- 首个页面就绪时记录从 `markLaunch()` 开始的首屏就绪耗时。
- 页面隐藏或卸载时尽力刷新队列。

已使用 `definePage` 的页面不要再手动发送 PV。未使用包装器的页面，可以调用 `umami.trackPageview({ url: '/pages/home/index', title: '首页' })`，但需要自行接入生命周期和性能统计。

## 初始化配置

以下参数传给 `umami.init(options)`；SDK 不读取应用的 `config.js` 或 `app.json`。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | 未启用 | 传入 `true` 才启用统计 |
| `endpoint` | 必填 | 完整事件采集地址，通常为 HTTPS `/api/send` |
| `websiteId` | 必填 | Umami 网站 ID |
| `hostname` | 必填 | 小程序的逻辑域名，不带协议或路径 |
| `eventProperties` | `{}` | 业务事件名与允许属性名的映射 |
| `pageTitles` | `{}` | 页面路由与显示标题的映射，可完全省略 |
| `tag` | 无 | 页面访问和自定义事件的标签，最多 80 字符 |
| `debug` | `false` | 输出投递失败等 SDK 状态，不记录事件载荷 |
| `batchSize` | `10` | 普通事件每批条数，需为正整数 |
| `batchDelay` | `1500` | 正常批量发送等待时间，毫秒，需为正整数 |
| `batchEndpoint` | 从 `endpoint` 推导 | 通常将地址末尾的 `/send` 替换为 `/batch` |
| `sessionProperties` | `true` | 自动上报设备与版本会话属性，可设为 `false` |
| `experiments` | 无 | A/B 实验定义 |
| `errors` | 未启用 | 错误监控配置，需显式设置 `enabled: true` |
| `heatmap` | 未启用 | 热图配置，需显式设置 `enabled: true` |
| `subpackages` | `[]` | 可选路由与分包映射，仅用于分包页面进入耗时 |

### 业务事件白名单

```js
 eventProperties: {
  purchase: ['amount', 'currency'],
  publish_click: [],
}
```

事件必须先声明；空数组表示允许该事件，但不接受业务属性。未声明的事件或属性直接丢弃。属性值只接受字符串、有限数字和布尔值；字符串最多保留 80 个 UTF-16 代码单元，白名单过滤后的业务数据 JSON 最多 512 字符，超限会丢弃该事件。不要在白名单中放入密码、Token、手机号或聊天内容等字段。

SDK 内置性能和实验事件，业务白名单不能覆盖它们的属性规则。没有业务数据时可省略 `track` 的第二个参数。

### 页面标题可省略

```js
pageTitles: {
  '/pages/home/index': '首页',
  '/pages/orders/index': '订单',
}
```

键使用带前导 `/` 的页面路由。不配置或未匹配时，页面访问仍会上报，`title` 为空字符串。SDK 不会自动读取页面 JSON 的 `navigationBarTitleText`。

## 渠道与会话属性

`setEntryOptions(options)` 接收微信 App 的启动/进入参数，仅保留五个 UTM 参数：`utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`。它们附加在统计 URL 上；其他业务 query 不参与渠道统计。

SDK 根据合法的顶层数字 `scene` 生成入口场景属性，并为缺失的 Source、Medium 补充默认值，显式 UTM 优先。每次进入均替换之前的渠道上下文，因此需要同时接入 App 的 `onLaunch` 和 `onShow`。`setEntryQuery(query)` 只设置 UTM，并清除场景上下文。

### UTM 从哪里来

UTM 是投放或分享入口携带的渠道参数，由业务方在生成入口时设置，SDK 从 App 启动/进入参数的 `options.query` 中读取。配置 Umami 采集域名或 `websiteId` 不会自动生成活动 UTM；本 SDK 通过请求上报，无需添加网页统计脚本或图片跟踪像素。

| 参数 | 含义 | 示例 |
| --- | --- | --- |
| `utm_source` | 来源平台或具体渠道 | `wechat`、`newsletter` |
| `utm_medium` | 渠道类型 | `social`、`cpc`、`email` |
| `utm_campaign` | 活动名称 | `double11` |
| `utm_content` | 区分素材、入口或按钮 | `share_card_a` |
| `utm_term` | 投放关键词 | `running_shoes` |

例如，在页面的分享回调中，把 UTM 放进分享路径：

```js
onShareAppMessage() {
  return {
    title: '活动首页',
    path: '/pages/home/index?utm_source=wechat&utm_medium=social&utm_campaign=double11&utm_content=share_card_a',
  };
},
```

接收方通过该卡片进入时，App 的 `onLaunch(options)` / `onShow(options)` 会获得对应的 `options.query`。按快速接入示例调用 `umami.setEntryOptions(options)` 后，后续统计 URL 会附加这些参数，例如：

```text
/pages/home/index?utm_source=wechat&utm_medium=social&utm_campaign=double11&utm_content=share_card_a
```

SDK 仅接受这五个键的非空字符串值，去除首尾空白后最多保留 80 个 Unicode 字符，并进行 URL 编码。手动拼接入口参数时，也应对参数值使用 `encodeURIComponent`；不要在渠道参数中放入用户身份或敏感信息。

未显式携带 UTM 时，SDK 会根据有效的微信入口场景补充来源和渠道。例如，顶层 `scene: 1007`（单聊分享）生成 `utm_source=wechat&utm_medium=chat_share`，`scene: 1047`（扫描小程序码）生成 `utm_source=wechat&utm_medium=qrcode`。显式传入 `utm_medium=social` 时，会覆盖场景推导的 Medium；活动、素材和关键词不会自动补充。没有有效场景且没有显式 UTM 时，不生成 UTM。

注意区分微信的顶层数字 `options.scene` 与小程序码中的自定义 `options.query.scene`：SDK 不会自动解码或解析后者。若业务把渠道信息编码进 `query.scene`，需先在业务代码中解析，再将得到的 UTM 字段合并到 `options.query` 后调用 `setEntryOptions`。参数只放在页面 `onLoad` 中、未传给 SDK，也不会成为入口渠道上下文。

### 会话属性

默认通过独立 `identify` 请求发送设备品牌、型号、系统、平台、微信/基础库版本、语言，以及小程序发布版本和运行环境。这些字段用于会话属性筛选，不重复写入普通事件的自定义属性。

会话属性依赖普通采集响应提供真实 `cache` 令牌，并通过 `x-umami-cache` 复用。SDK 不生成 OpenID、设备 ID 或 distinct ID。自定义网关必须返回真实令牌并转发 `identify` 和对应请求头，仅返回 `202 accepted` 不足以支持会话属性与热图关联。

## 性能统计

有效初始化后自动监听微信支持的 `navigation`、`render`、`script` 条目；页面就绪指标还需要 `definePage` 和 `markLaunch()`。

| 上报事件 | 数据来源与含义 |
| --- | --- |
| `performance_page_ready` | 页面 `onLoad` 到业务 `onReady` 完成，属性 `duration_ms` |
| `performance_app_startup` | `markLaunch()` 到首个页面就绪，属性 `duration_ms` |
| `performance_app_launch` | 微信 `appLaunch.duration`，属性 `duration_ms` |
| `performance_package_script` | `evaluateScript.duration`，属性 `package_name`、`duration_ms`；名称直接来自 `moduleName`，主包 `APP` 记为 `main` |
| `performance_fcp` | FCP 与 `firstRender.startTime` 的有效正差，属性 `value_ms` |
| `performance_lcp` | LCP 与 `firstRender.startTime` 的有效正差，属性 `value_ms` |
| `performance_subpackage_route` | 匹配分包路由的 `route.duration`，属性 `package_name`、`duration_ms`；需要 `subpackages` |

**通常可以省略 `subpackages`，也不需要配置生成脚本。** 省略后不发送 `performance_subpackage_route`，其他指标继续工作。只有需要按分包归因页面进入耗时时，才手动提供映射：

```js
subpackages: [
  { root: '/features/orders', name: 'orders' },
]
```

此映射不会自动从 `app.json` 获取，也不会从 `root` 自动补全 `name`。页面进入耗时可能包含下载、注入、初始化及路由开销，不能当作纯下载时间。

微信的 `downloadPackage` 和 `resourceTiming` 指标目前尚未接入本 SDK。SDK 也不计算 INP 或 CLS。性能条目因基础库和平台而异，缺失时跳过对应指标。

## A/B 实验

在初始化配置中声明实验：

```js
experiments: {
  publish_cta: {
    enabled: true,
    revision: 'v1',
    variants: { A: 50, B: 50 },
  },
}
```

```js
const variant = umami.getVariant('publish_cta'); // 'A'、'B' 或 null
// 对应界面实际展示后，显式记录曝光。
umami.trackExposure('publish_cta');
// 用户触发已声明的业务事件时，携带本次曝光的实验归因。
umami.trackExperiment('publish_cta', 'publish_click');
```

分组按网站、实验 ID 和 revision 存入微信本地 storage，仅保存组名。相同存储下跨启动保持分组，不保证跨设备或账号一致；存储不可用或配置无效时返回 `null`，业务应回退默认界面。

实验 ID、revision、组名仅允许 1–50 个英文字母、数字、下划线或连字符；每个实验 2–10 组，权重为正整数。修改实验含义或分组方案时递增 revision。曝光在本次运行内去重；关闭统计会清除曝光状态，重新开启后需再次实际展示并上报曝光。未曝光时，`trackExperiment` 仍发送有效业务事件，但不附加实验属性。

## 错误监控（可选）

初始化时配置 `errors: { enabled: true }`，再把下列调用合并到 App：

```js
onError(error) {
  umami.captureException(error, { handled: false, source: 'runtime' });
},
onUnhandledRejection(event) {
  umami.captureException(event.reason, { handled: false, source: 'unhandledrejection' });
},
```

已捕获的异常可调用 `umami.captureException(error)`，默认标记为已处理。配置支持 `errors.endpoint`、`errors.release`、`errors.environment`；后两项缺省读取微信小程序发布版本和环境。

错误使用独立的 `type: 'error'` 协议，不增加普通 PV。SDK 对消息和堆栈进行截断、常见敏感字段脱敏、重复抑制及限流，但任意业务文本无法保证完全脱敏。目标 Umami 实例须支持相应错误采集协议。

## 行为热图（可选）

初始化时配置 `heatmap: { enabled: true }`，并为普通页面根节点添加：

```xml
<view class="umami-heatmap-root" capture-bind:tap="__umamiHeatmapTap">
  <!-- 页面内容 -->
</view>
```

页面使用 `definePage`；仅打开开关不会自动覆盖所有 WXML 点击。热图还依赖服务端 recorder 配置、采样结果、真实会话令牌及 `/api/record` 接口。自定义网关可以通过 `heatmap.endpoint`、`heatmap.configEndpoint` 覆盖地址。

仅采集触摸坐标、尺寸和滚动深度，不读取元素文字、dataset 或表单内容。内部 `scroll-view`、组件/CSS 滚动需要单独适配；当前页面包装器保留了示例首页、我的、消息和聊天页的专用规则，不能直接假设适用于其他应用的同名路由。接入细节见使用指南中的“行为热图”。SDK 不截屏，也不提供小程序页面背景托管。

`umami.getHeatmapStatus()` 返回 `{ collecting, hasSession, queued }`，可用于排查采样、会话令牌和排队状态，不会返回令牌本身。

## API 速查

| 方法 | 用途 |
| --- | --- |
| `init(options)` | 一次性初始化 |
| `setEntryOptions(options)` / `setEntryQuery(query)` | 替换入口渠道上下文 |
| `markLaunch()` | 标记启动时间 |
| `trackPageview({ url, title, referrer })` | 手动发送页面访问 |
| `track(name, properties?)` | 发送白名单业务事件 |
| `trackPageReady(duration, route)` | 手动记录页面就绪耗时，包装器已自动调用 |
| `getVariant(id)` | 获取实验组，失败时为 `null` |
| `trackExposure(id)` | 显式记录实验曝光 |
| `trackExperiment(id, name, properties?)` | 发送带曝光归因的业务事件 |
| `captureException(error, context?)` | 错误监控启用后记录异常 |
| `flush()` | 尽力发出队列，不返回可等待的投递完成 Promise |
| `setEnabled(boolean)` | 有效初始化后切换统计状态 |
| `isHeatmapEnabled()` / `getHeatmapStatus()` | 查询热图采集状态 |
| `trackHeatmap(type, route, metrics, point)` | 自行完成几何测量后提交点击或滚动数据 |

## 投递与服务端接入

普通事件使用 `/api/batch` 合并发送，不支持时回退 `/api/send`。队列最多 50 条，仅保存在内存；网络和 5xx 最多重试两次，使用带抖动的指数退避。`flush()` 不会跳过重试退避，也不保证小程序退出前投递成功。关闭统计会清空待发队列，已发出的请求无法撤回。

生产环境需配置采集地址对应的 HTTPS request 合法域名。会话属性、错误和热图依赖目标实例的协议支持，不应仅凭 HTTP 200 判断已入库；开发者工具请求也可能被服务端识别为机器人。上线前应在真机验证页面、事件、会话筛选与可选功能。

更多字段、限制和示例见 [GUIDE.md](GUIDE.md)。

## 本地开发与打包

在包目录执行：

```sh
npm ci
npm run build
npm test
npm pack --dry-run
npm pack
```

`prepack` 自动运行构建。`npm pack --dry-run` 预览文件清单，但仍会触发构建；`npm pack` 生成 `miniapp-umami-<version>.tgz`，不会发布。可在其他项目中安装该文件验证：

```sh
npm install /absolute/path/miniapp-umami-0.1.0.tgz
```

示例仓库通过 `file:packages/umami` 使用本地包；在仓库根目录安装依赖后，先运行 `npm run build:umami`，再在微信开发者工具构建 npm。

CommonJS 调用方式为 `require('miniapp-umami').default`，页面包装器为 `require('miniapp-umami/page').definePage`。同一应用保持一种模块格式，避免同时加载 ESM 和 CommonJS 产生两个 SDK 实例。

发布文件包含 `src/`、`lib/`、使用指南、README 和 MIT 许可证，不包含示例应用和测试。更新 npm 页面上的 README 需要发布新版本，仅修改本地文件不会同步线上内容。
