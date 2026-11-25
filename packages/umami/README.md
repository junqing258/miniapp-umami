# miniapp-umami

用于微信小程序的 Umami SDK，零运行时依赖。支持页面访问、白名单事件、UTM/入口场景、性能指标、会话属性、A/B 实验，以及可选错误监控和行为热图。

## 安装和接入

发布后安装：

```sh
npm install miniapp-umami
```

示例仓库使用 `file:packages/umami` 本地依赖；在仓库根目录安装依赖后，先执行 `npm run build:umami`，再在微信开发者工具构建 npm。

本地验证可在本目录执行 `npm pack`，然后在目标项目中 `npm install /path/to/miniapp-umami-0.1.0.tgz`。微信开发者工具中执行「工具 → 构建 npm」。包的 `miniprogram` 入口为编译后的 CommonJS `lib/`，ES module 消费者使用 `src/`。

```js
// app.js
import umami from 'miniapp-umami';

App({
  onLaunch(options) {
    umami.init({
      enabled: true,
      endpoint: 'https://analytics.example.com/api/send',
      websiteId: 'your-website-id',
      hostname: 'miniapp.example.com',
      eventProperties: { purchase: ['amount', 'currency'] },
      pageTitles: { '/pages/home/index': '首页' },
    });
    umami.setEntryOptions(options);
    umami.markLaunch();
  },
  onShow(options) { umami.setEntryOptions(options); },
  onHide() { umami.flush(); },
  onError(error) {
    umami.captureException(error, { handled: false, source: 'runtime' });
  },
  onUnhandledRejection(event) {
    umami.captureException(event.error || event.reason, { handled: false, source: 'unhandledrejection' });
  },
});
```

```js
// pages/home/index.js
import umami from 'miniapp-umami';
import { definePage } from 'miniapp-umami/page';

definePage({
  onPurchase() {
    umami.track('purchase', { amount: 99, currency: 'CNY' });
  },
});
```

`definePage` 代替 `Page`，自动统计页面访问与就绪耗时，保留业务生命周期及返回值；不要重复手动发送 PV。页面标题按规范化路由（带前导 `/`）从 `pageTitles` 读取，缺失时为空。

`eventProperties` 声明业务事件及允许的属性名；未声明的事件和属性会丢弃。SDK 自带性能/实验事件白名单，不包含示例项目的业务事件。属性仅允许字符串（最多 80 字符）、有限数字、布尔值，事件数据最多 512 字符。不上传任意对象、完整路由 query 或用户标识。

`init` 每个小程序运行周期只生效一次；须在启动时传入完整配置。`enabled`、`endpoint`、`websiteId`、`hostname` 均需有效才能启用。`setEnabled(false)` 停止采集，`setEnabled(true)` 恢复已初始化的统计。运行环境需提供微信的 `wx`、`Page`、`getCurrentPages`，不是浏览器或 Node 服务端 SDK。

其他配置包括 `tag`、`debug`、`batchSize`、`batchDelay`、`batchEndpoint`、`sessionProperties`、`subpackages`、`experiments`、`errors`、`heatmap`。错误监控与热图默认关闭，需分别传入 `{ enabled: true }`；热图还需要目标服务端支持对应协议。生产接入需配置 HTTPS request 合法域名。详细协议、API、采集限制见 [使用指南](GUIDE.md)。

## 开发和发布

需要 Node.js 18+。

```sh
npm ci
npm run build
npm test
npm pack --dry-run
npm pack
# 确认包名、版本和 npm 账户后发布
npm publish
```

`prepack` 自动构建；发布内容仅包含源码、CommonJS 产物、说明和许可证，不包含示例应用、配置、测试或开发工具。ESM 使用默认导入；CommonJS 使用 `require('miniapp-umami').default`，页面包装器使用 `require('miniapp-umami/page').definePage`。同一应用保持一种模块格式，避免同时加载两个 SDK 实例。
