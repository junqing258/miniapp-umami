# 微信小程序 Umami 适配规划

## 目标与范围

在当前原生 JavaScript + TDesign 微信小程序中接入 Umami，实现全部页面访问统计和首批业务事件。SDK 统一封装在 `utils/umami/`，业务页面仅调用 SDK 的公开接口。

本阶段仅制定规划，不实现 SDK、不修改页面、不修改 Umami 服务端配置。

## 已确定的 Umami 配置

| 项目 | 配置 |
| --- | --- |
| 管理页面 | http://192.168.31.120:3002/websites/543538c5-b3bb-4858-b8ac-850cad751578 |
| 服务地址 | `http://192.168.31.120:3002` |
| 预计采集接口 | `http://192.168.31.120:3002/api/send` |
| websiteId | `543538c5-b3bb-4858-b8ac-850cad751578` |
| SDK 目录 | `utils/umami/` |

采集接口按 Umami 官方协议规划，尚未对该实例进行连通性和版本验证。管理页面地址不能直接作为上报地址。

当前地址用于局域网联调：开发者工具按需关闭合法域名校验，真机需具备到该局域网地址的网络可达性，并实测请求能否成功。正式发布前需提供微信小程序可用的 HTTPS 域名，配置 request 合法域名；不能将开发者工具中请求成功视为正式环境验收通过。

## 项目现状

- `app.js` 负责启动、更新检查、消息连接，目前没有统计初始化逻辑。
- `app.json` 注册了 3 个主包页面和 8 个分包页面，页面采用 `Page({...})`。
- 根目录 `config.js` 当前启用 `isMock: true`，另有 `config/index.js`，统计配置统一使用根目录配置，避免来源混淆。
- 配置收敛列为 SDK 接入前置项：`app.js` 使用 `./config`，业务 request 使用 `~/config`；尚无证据证明当前编译器将两者解析到不同文件，但同名文件与目录会增加工具链差异风险。未发现对 `config/index.js` 的显式引用，删除或归档前仍需核对实际模块解析与构建结果，不能仅凭文本搜索认定无隐式引用。
- `api/request.js` 会携带业务 Token，并按业务响应结构判断结果，不适合直接复用为统计传输层。
- 业务请求存在响应契约问题：`api/request.js` 直接检查 `res.code` 并返回整个响应，而真实 `wx.request` 的 HTTP 状态位于 `res.statusCode`、业务响应位于 `res.data`；当前 Mock 直接返回 `{ code, success, data }`，掩盖了这一差异。登录页依赖 `res.success`，真实接口的成功字段尚未确认，必须先明确契约并统一响应形状。
- `mock/WxMock.js` 改写了 `wx.request`，未匹配的完整请求 URL 已会透传真实请求；仅需验证透传行为，确保采集 endpoint 未注册进 Mock，无需为统计另加透传分支。
- 验证码登录页通过路由参数接收手机号，因此不能默认采集完整 query。
- 发布和保存草稿目前只有跳转逻辑，没有真实持久化成功响应，不能上报为业务成功。

## SDK 结构与接口

```text
utils/umami/
  index.js       # 对外接口及 SDK 状态管理
  transport.js   # 独立 wx.request、发送队列、有限重试
  page.js        # 页面注册封装、页面展示与来源跟踪
  sanitize.js    # 属性白名单、类型与长度限制
  README.md      # SDK 使用说明，实施时补充
```

建议接口：

```js
import umami from '~/utils/umami/index';
import { definePage } from '~/utils/umami/page';

umami.init(options);
umami.trackPageview({ url: '/pages/home/index', title: '首页' });
umami.track('login_success', { method: 'password', mock: true });
umami.flush();
umami.setEnabled(false);

definePage({
  onShow() {
    // 保留原有页面逻辑
  },
});
```

`definePage` 内部调用原生 `Page`，组合原有生命周期并保留 `this`、参数、返回值；不全局替换 `Page`。已使用封装的页面不再手动调用 `trackPageview`，避免重复计数。自动统计只注册一次，重复初始化应幂等。

在根目录 `config.js` 增加 `umami` 配置项：`enabled`、`endpoint`、`websiteId`、`hostname`、可选 `tag`、`debug` 和环境启用策略。逻辑 hostname 实施时选定固定值，不根据设备 IP 生成，也不将其误作采集服务器地址。联调可使用固定 `tag: 'test-audience'` 作为测试受众，在 Umami 中按 Tag 筛选；它随既有请求发送，不额外生成事件。

配置只写入根 `config.js`。优先由 `app.js` 显式导入 `./config.js`，再以参数传入 `umami.init(config.umami)`，使 SDK 不依赖项目配置路径；业务 request 改为显式导入 `../config.js`。如确需 SDK 内直接引用根配置，从 `utils/umami/index.js` 出发应为 `../../config.js`，不是 `../config`。完成解析核对后删除或归档 `config/index.js`，保留唯一配置来源。

## 上报协议与传输

使用 `wx.request` 向 `/api/send` 发送 JSON。页面访问与自定义事件均使用 `type: 'event'`；页面访问不设置事件名，业务事件设置 `payload.name` 和经过过滤的 `payload.data`。具体字段及响应处理以目标实例版本的实测结果为准。

字段映射：

| Umami 字段 | 小程序来源 |
| --- | --- |
| `website` | 配置的 websiteId |
| `hostname` | 固定逻辑 hostname |
| `url` | 标准化页面路由，仅附加入口白名单 UTM，其他 query 移除 |
| `title` | 显式页面标题映射 |
| `referrer` | `https://<固定hostname><上一个页面路由>`，首次进入为空 |
| `language` | 微信系统信息中的语言；将下划线分隔规范化为连字符，如 `zh_CN` → `zh-CN`，验证目标实例展示 |
| `screen` | 微信窗口或设备信息中的屏幕尺寸 |
| `name`、`data` | 自定义事件名和白名单属性 |
| `tag` | 可选受众标签；联调固定为 `test-audience`，不写入个人或业务身份信息 |

官方文档要求有效的 User-Agent。第一步需验证小程序真实请求头能否被该实例接受，不预设客户端能够自由修改该请求头。若直连不能满足采集要求，再设计服务端转发，转发方案需同时验证来源 IP 和访客统计，避免所有请求被统计为同一访问者。

统计传输不携带业务 Authorization，不依赖 `api/request.js`，通过 HTTP `statusCode` 判断请求结果，并按目标版本处理响应。若目标版本需要复用响应中的 cache，则在兼容验证后实现对应请求头及失效处理，不把 cache 当作永久访客 ID。

首期采用独立逐条上报，不依赖实例可能尚不支持的批量接口。

`url` 保留标准化路径及入口白名单 UTM，`referrer` 使用与 `hostname` 配套的绝对 URL；其中 HTTPS origin 是页面的逻辑来源标识，不是采集服务器地址，也不意味着实际存在对应网页。不能仅凭两者字符串形式不同判定协议错误：当前 Umami 主分支会基于事件域名解析相对 referrer，并去除站内来源的 referrer domain，但目标实例版本尚未验证。为兼容版本差异，统一发送绝对 referrer，并在步骤 1 检查路径保留及站内来源归类；不应期待站内导航显示成外部引荐来源。

## 页面与事件口径

### 页面访问

- 覆盖 `app.json` 中全部 11 个页面，包括分包页面。
- 页面 `onShow` 每次展示计一次访问，覆盖首次进入、页面返回、Tab 切换及从后台恢复；不同时在 App `onShow` 发送页面访问。
- 同一路由再次真实展示可以再次计数，仅防止同一次生命周期被多处重复采集。
- 首次进入 `referrer` 为空；前后台恢复时不把当前页写成自己的来源。
- 使用页面实例及展示顺序维护来源，覆盖返回、重定向和 `reLaunch`，避免只靠导航 API 拦截推断访问。
- 只允许入口 `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content` 白名单 query，不上传其他 query、聊天对象信息或页面完整 data。入口归因生命周期见 `utils/umami/README.md`。
- 首页回跳参数 `oper` 可作为首个白名单候选，仅允许 `release`、`save`，用于区分发布或草稿操作后的首页访问。首期默认仍不上传；若启用，优先作为页面事件属性并验证实例支持，不在属性不可用时额外发送一次 PV。该参数仅表达回跳来源，不证明业务成功。
- App 顶层数字启动场景作为页面访问和事件的公共属性上报；显式 UTM 优先，缺失的 Source / Medium 按真实场景映射为 `wechat` 及入口分类，Campaign 仍由入口指定。不采集业务 `query.scene` 原文，不伪造浏览器 referrer。具体分类及生命周期见 `utils/umami/README.md`。

### 首批业务事件

| 事件 | 接入位置 | 触发条件与属性 |
| --- | --- | --- |
| `login_success` | `pages/login/login.js`、`pages/loginCode/loginCode.js` | 接口确认登录成功；属性为登录方式、是否 Mock |
| `search_submit` | `pages/search/index.js` | 有效搜索提交；记录来源与关键词长度，不记录原文；统一入口避免重复 |
| `release_click` | `pages/release/index.js` | 点击发布；当前只是模板跳转，不表示发布成功 |
| `draft_save_click` | `pages/release/index.js` | 点击保存草稿；当前不表示持久化成功 |
| `home_refresh` | `pages/home/index.js` | 用户主动刷新；不包含初始加载 |

发布成功和草稿保存成功事件待真实接口接入后再增加。

### 登录与搜索接入前置条件

- **登录响应契约**：先确认真实业务 API 的成功字段及返回结构，将 HTTP 成功与业务成功分开判断；不能只把 `res.code` 改为 `res.statusCode`，还必须统一返回体层级并同步 Mock。检查所有 `request()` 调用方的兼容性，避免影响首页、搜索等现有页面。`login_success` 放在业务成功且 Token 保存完成之后、导航之前；HTTP 200 本身不代表登录成功。当前请求实现的故障取决于真实传输路径，而不是是否使用真机：真机运行 Mock 仍会走 Mock 成功链。
- **搜索统一入口需新增**：当前 `handleSubmit`、`handleHistoryTap`、`handlePopularTap` 是三个操作入口，均调用 `setHistoryWords`，但没有携带来源的统一搜索动作。实施时新增 `submitSearch(value, source)`，由三个入口分别传入 `input`、`history`、`popular`，统一校验、更新历史并上报一次；`setHistoryWords` 仅负责历史维护，不额外上报。
- 搜索页的 `confirm()` 是删除历史记录对话框回调，绝不能接入 `search_submit`；空值和纯空白不产生搜索事件。当前没有实际搜索接口或结果跳转，事件只表达有效搜索意图，不表达搜索成功。

## 数据与稳定性约束

- 不上传手机号、密码、验证码、Token、聊天正文、搜索原文、OpenID 或完整业务用户对象。
- SDK 只接受允许的事件和属性，对类型、字符串长度及载荷大小设置限制；调试日志同样不输出敏感信息。
- 第一阶段默认不引入持久化匿名 ID，但必须先做 UV 合并验证。Umami 默认匿名会话标识基于 websiteId、IP、User-Agent 和轮换盐；同一网络且 UA 相同可能合并，不假设所有小程序用户 UA 完全相同。两台真机同 WiFi 同时间窗口各访问一次，在干净或可隔离的统计窗口确认 UV 增量与会话情况，记录设备、微信版本和实际 UA（如可获取），再用不同网络作对照。合并结果决定是否接受默认口径或提前设计 distinct ID；即使本次得到 2 UV，也不能证明相同 UA 下不会合并。
- 如业务确需跨启动稳定访客识别，再结合目标版本的 distinct ID 能力与产品数据规则单独设计。
- 使用有界内存队列和请求超时。网络错误及可重试服务端错误有限重试，参数错误不反复重试；具体上限在实施时以配置常量明确。
- 重试存在请求已入库但响应丢失导致重复的可能，首期不承诺严格去重或恰好一次投递。
- `flush` 尽力发送已有队列，不无限等待；切后台不保证全部送达。首期不做持久化离线补报。
- 停用时停止新增采集、清空待发送队列；统计异常不能改变页面和业务操作结果。
- 开发、体验、正式环境分别控制启用策略。当前 websiteId 用于联调；正式启用前明确是否新建独立项目，避免 Mock 和调试数据混入生产报表。
- 数据告知在字段设计阶段处理：梳理 screen、language、行为事件，以及服务端可见的 IP、User-Agent，明确用途、接收方、保存期限和删除方式；据实际处理活动更新微信后台用户隐私保护指引及产品隐私说明。自建 Umami 不自动等于向第三方共享，须确认服务运营主体；确有第三方接收时再明确共享或委托处理关系及相应告知要求。核对实际使用的微信接口是否属于隐私接口，按适用规则完成授权与采集启用时机，不能将所有设备字段一概视为需要同一种平台授权。

## 实施步骤

1. **协议与网络验证**：确认实例版本，使用指定 websiteId 从开发者工具和真机各发送页面访问、业务事件，确认状态码和 Umami 后台数据；验证 User-Agent、Mock 透传及访客口径。专门验证绝对 referrer 的路径保留、与 hostname 的匹配、站内来源归类及首次进入空来源；同时核对目标版本对纯路径 referrer 的解析行为。
2. **SDK 基础能力**：先收敛根 `config.js`，显式指定配置文件路径，核对并删除或归档同名目录入口；由 App 向 SDK 注入配置。再在 `utils/umami/` 实现独立传输、事件过滤、有限队列、开关及调试能力，在 `app.js` 初始化。
3. **自动页面统计**：增加标题映射和 `definePage`，逐一适配主包及分包页面，明确来源与前后台恢复口径。
4. **业务事件**：先修正并验证业务 request 与 Mock 的统一响应契约，确认真实登录成功判定，再接入登录事件；若真实接口契约尚未提供，标记真实登录验收待完成，不能以 Mock 验收替代。新增统一搜索动作并接入三个来源，排除删除历史确认回调。随后接入发布按钮、草稿按钮、首页刷新，检查实际成功与按钮点击的区别。
5. **验证与说明**：补充 SDK 文档与根 README 接入说明，执行有针对性的生命周期、过滤、队列测试及微信真机验收。

步骤 1 的必查清单还包括：两台真机同 WiFi 的 UV/会话合并实验及不同网络对照、`zh_CN` 等语言值规范化后的后台展示、Mock 开启时完整采集 URL 的真实透传。字段设计时同步梳理隐私告知和实际接收方，步骤 5 核验声明与实际采集一致，不留到发布时才确定。

## 验收标准

- Umami 后台能看到指定 websiteId 下的真实页面访问和自定义事件。
- 首次启动首页只产生一次 PV；Tab 切换、返回、分包进入和前后台恢复符合约定次数，原生命周期行为保持正常。
- 登录成功仅在成功响应后上报，搜索不会因共用函数重复上报，模板发布事件不命名为成功。
- Mock 与真实响应形状分别验证：HTTP 失败、HTTP 成功但业务失败、业务成功三种情形；仅业务成功并保存 Token 后产生一次登录事件，既有业务请求调用方保持兼容。
- 搜索框提交、历史词点击、热门词点击分别产生一次事件，来源正确；空白搜索、删除单条历史及清空历史确认不产生搜索事件。
- 绝对 referrer 保留上页路径，与固定 hostname 配套；站内导航不被错误统计为外部引荐来源，首次进入来源为空。
- 上报体与调试日志均无敏感字段，业务 Token 不进入统计请求。
- 断网、超时、服务端错误、无效配置及关闭统计时，业务流程正常，队列有界且重试有限。
- Mock 开启时业务 Mock 继续可用，统计请求能够按环境配置正确发送或禁用。
- 配置最终仅有一个有效来源；两台真机同 WiFi 的 UV 实验结论、默认口径是否可接受及是否需要 distinct ID 均有记录。
- 语言值规范化可在报表正确展示；隐私指引与实际字段、用途、接收方一致，适用的隐私接口授权流程已验证。
- 正式发布前完成 HTTPS request 合法域名配置和真实设备验证。

## 参考

- [Umami 官方采集接口说明](https://docs.umami.is/docs/api/sending-stats)
- [Umami 指标及匿名会话标识说明](https://docs.umami.is/docs/metric-definitions)
- [Umami distinct ID 说明](https://docs.umami.is/docs/distinct-ids)
- [腾讯云小程序隐私保护指引适配说明](https://cloud.tencent.com.cn/document/product/1301/97930)
- [Umami 当前主分支采集实现（目标部署版本需另行核对）](https://github.com/umami-software/umami/blob/master/src/app/api/send/route.ts)
- [当前 Umami 项目](http://192.168.31.120:3002/websites/543538c5-b3bb-4858-b8ac-850cad751578)
