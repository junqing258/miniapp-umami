# Umami 真机验收记录

## 行为热图接入（2026-11-20，真机待验收）

- 目标热图 GET 接口返回 200，初始结果为 `pages: []`、`points: []`、`snapshot: null`。网站公开 `/recorder` 配置初始为 `enabled: false`。
- 已在目标网站设置开启**热图**并将测试采样率设为 `1`（100%）；回放保持关闭。重新读取公开配置确认 `enabled: true`、`heatmapEnabled: true`、`heatmapSampleRate: 1`、`replayEnabled: false`。
- SDK 已接入官方 `/api/record` 的 `type: heatmap` 协议、会话令牌复用、坐标白名单、页面/原生滚动容器采集及有界重试。功能覆盖和截图背景限制见 `utils/umami/README.md` 的“行为热图”。热图不写普通业务事件表，不额外增加 PV。
- 模拟器实际 `/api/batch` 返回 200、`processed: 6`、`errors: 0`，但没有 `cache`。另用原生 `wx.request` 发送一条标记 `test-audience` 的 `heatmap_session_diagnostic` 诊断事件，响应为 `200`、`beep: boop`、无令牌。此结果确认模拟器仍被机器人过滤；未伪造 UA、未注入浏览器会话令牌、未补造热图点。
- `npm test` 的 22 项单元测试通过（其中 7 项新增热图测试），覆盖协议、无令牌等待、真实批量响应触发热图发送、采样/关闭、有界队列、错误重试、坐标校验、滚动容器偏移、跳转点击和停止采集。修改文件 ESLint、Prettier 及 diff 空白检查通过。4 项既有模拟器业务回归通过，覆盖首页内容、发布跳转、搜索去重和登录模式切换。
- 用户选择**真机验证**，远程实例未调整 `DISABLE_BOT_CHECK`。热图实际入库、手机微信 UA 接受情况、真机坐标和原生滚动容器表现仍待验证，不能把上述单测/模拟器业务回归当成入库成功。

真机验收步骤：

1. 使用本次代码重新预览并从微信打开；手机与 `192.168.31.120:3002` 位于同一可互访局域网。当前为 HTTP 开发地址，预览环境如限制请求，可在预览调试设置中开启调试；正式发布必须配置 HTTPS 和合法 request 域名。
2. 首页点击卡片、打开发布或数据中心，滚动普通长页面；进入消息列表并滚动，点击进入聊天。每页停留至少 3 秒后再切页/切后台，以便观察定时投递。
3. 在真机调试请求中核对普通采集响应带 `cache`，随后出现 `/api/record` 的 `type: heatmap` 请求；请求头含 `x-umami-cache`，载荷包含真实坐标与尺寸。不要复制、分享完整令牌。
4. 后台“行为 → 热图”选择最近 24 小时，清除额外筛选，分别查看 Clicks 和 Scroll。选择对应页面/`heatmap-scroll` 容器路径。以实际页面列表、坐标和滚动桶出现为入库依据；`/api/record` 的 200 本身不足以证明成功写入。
5. 背景仍为空/网页加载失败时，检查 iframe 对应 URL。真实小程序截图叠加需要远程后台适配；当前 SDK 不提供页面录屏。验证后再将测试采样率调整为所需比例。

## 系统 API 上报联调（2026-11-20）

已在开发者工具重新编译并检查实际 `/api/batch` 请求：页面访问与性能事件均携带 `wx_brand`、`wx_model`、`wx_system`、`wx_platform`、`wx_version`、`wx_sdk_version`、`wx_language`、屏幕/窗口宽高和像素比。示例为 `wx_platform=devtools`、`wx_sdk_version=3.18.0`、`screen=390x844`；这些是模拟器返回值，不代表真机型号或版本。控制台未匹配到 error；15 项本地单元测试、修改文件 ESLint 和格式检查通过。

字段仅代表已构建并发出的采集载荷，不证明入库。模拟器机器人过滤限制仍适用；真机系统信息与 Umami 自定义属性展示待真机验收。实现与字段表见 `utils/umami/README.md` 的“系统与设备信息”。

代码已具备上报能力，但以下项目必须在目标部署实例、开发者工具和真机中完成，不能以 Mock 结果替代。

| 项目 | 状态 | 记录内容 |
| --- | --- | --- |
| 采集协议 | 待验证 | `/api/send` 的实例版本、页面事件和自定义事件的响应状态及后台展示 |
| 请求环境 | 待验证 | 真实小程序 User-Agent 是否被接受；Mock 开启时完整采集 URL 是否透传 |
| 页面来源 | 待验证 | 首次进入空来源、站内跳转 absolute referrer 的路径和后台归类 |
| UTM 渠道与场景 | 部分通过 | 单测和模拟器请求已验证；历史 UTM 诊断数据报表可见。新增场景关联请求仍被开发者工具 User-Agent 过滤，待真机验证入库；见下文 |
| 语言 | 待验证 | `zh_CN` 规范化为 `zh-CN` 后的后台展示 |
| 登录契约 | 待验证 | HTTP 失败、HTTP 成功但业务失败、业务成功三种真实响应；仅保存 Token 后上报 |
| UV 口径 | 待验证 | 两台真机同 WiFi 同时访问的 UV/会话变化、设备/微信版本/UA（如可取）；再以不同网络对照 |
| 正式发布 | 待验证 | HTTPS endpoint、request 合法域名、隐私保护指引与实际字段/接收方一致 |

联调时临时将 `config.js` 的 `umami.enabled` 设为 `true`。不要将当前局域网 HTTP endpoint 作为正式发布设置，也不要将页面回跳参数、搜索原文或任意业务身份信息加入事件属性。

当前联调配置通过 `umami.tag: 'test-audience'` 标注测试受众。打开 Umami 网站报表，选择 **Filter → Tag → `test-audience`**，即可只查看该受众的页面访问、事件和跳出率。Tag 随既有请求发送，不会生成额外事件或改变跳出率。正式发布前应移除该标签或替换为正式环境标签。

## 2026-11-20 UTM 联调结果

- 本地 `npm run test:umami` 的 3 组检查通过，覆盖真实 App / 页面钩子、冷启动与热入口替换、直接入口清空、内部导航及事件渠道传递、编码与长度限制、敏感 query 过滤和 PV 数量。
- 开发者工具以 `utm_source=wechat_devtools&utm_medium=debug&utm_campaign=utm-verification-20261120` 编译，实际 `/api/batch` 请求的 `payload.url` 携带 UTM，响应为 `200`、`processed: 6`、`errors: 0`。但该响应不能证明实际入库。
- 从模拟器直接调用 `/api/send` 得到 `200` 和 `{"beep":"boop"}`。Umami 官方 `src/app/api/send/route.ts` 中该响应对应 `isbot(userAgent)` 命中的机器人过滤分支，会在写入事件前返回。因此开发者工具流量未出现在报表；不是 UTM 参数被 SDK 再次删除。
- 使用浏览器同源请求发送带 `test-audience` 标签的独立诊断 PV，单条和批量接口分别以 `browser_debug`、`browser_batch` 为来源，两者均已显示在目标实例的增长 UTM 报表中，活动为 `utm-verification-20261120`，媒介为 `debug`。这些记录是联调数据。
- 真机微信 User-Agent 接受情况、完整渠道生命周期仍待真机验收。若专用开发实例需要统计模拟器流量，可在服务端评估配置 `DISABLE_BOT_CHECK=true`；本次未修改服务端设置，SDK 不伪造 User-Agent。

## 2026-11-20 场景关联补充验收

- 再次查看目标网站最近 24 小时的增长 UTM 报表：活动 `utm-verification-20261120` 共 4 次浏览；Medium 为 `debug`，Source 为 `wechat_devtools`（2）、`browser_debug`（1）、`browser_batch`（1）。这是此前的诊断数据，不能视为本次场景关联已入库。
- 修改前，当前模拟器确实调用了 `/api/batch`，但页面 URL 没有 UTM：该次启动没有渠道参数，旧代码也没有读取顶层数字场景。
- 已接入 App `onLaunch` / `onShow` 的完整入口参数：有效显式 UTM 优先，按场景补齐 Source / Medium；页面访问、业务及性能事件附加 `wx_scene`、`wx_scene_name`、`wx_scene_category`。Campaign 仍必须由入口指定，不根据场景猜测。
- 使用开发者工具将首页启动场景设为 `1047`、原始启动参数设为 `utm_campaign=模拟拉新活动`。实际批量请求包含 `utm_source=wechat&utm_medium=qrcode&utm_campaign=%E6%A8%A1%E6%8B%9F%E6%8B%89%E6%96%B0%E6%B4%BB%E5%8A%A8`，页面访问和性能事件均包含 `wx_scene: 1047`、`wx_scene_name: 扫描小程序码`、`wx_scene_category: qrcode`。服务端返回 `200`、`processed: 5`、`errors: 0`。
- 单独发送一条 `tag: test-audience` 的 `utm_scene_diagnostic` 诊断事件（不增加 PV），原生 `wx.request` 的 `/api/send` 响应仍为 `200`、`{"beep":"boop"}`。刷新增长报表仍只有此前的 4 次访问：**本次请求已上传，但未验证入库，当前证据符合机器人过滤**。没有伪造 User-Agent，也未通过浏览器补造场景数据来代替模拟器验收。
- `npm test` 的 13 个单元测试通过（含 8 个 SDK 测试）；`npm run test:e2e` 的 4 个模拟器用例通过；新增/修改的 SDK 代码及测试代码 ESLint 通过。覆盖显式渠道优先、场景推导、内部导航和事件关联、冷热入口替换、未知/无效场景、二维码业务 `query.scene` 不误采集、敏感字段过滤及不增加 PV。
- 真机验收：扫描带明确活动映射的二维码/小程序码或从分享卡片进入，确认同一条 URL 的 UTM、`data.wx_scene` 及事件属性；在增长 UTM 和事件/数据细分页面检查真实入库与关联。历史记录不回填、不改名。
