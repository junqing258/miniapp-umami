# Umami 真机验收记录

## 实验事件属性格式调整（2026-11-21，真机入库待验收）

- 实验曝光与归因点击统一使用 `exp_<实验ID>_<revision>: <组名>` 格式，本次示例为 `exp_home_publish_cta_v1: 'B'`（A 组值为 `'A'`），不再发送 `experiment_id`、`experiment_revision`、`variant` 三个字段。
- 保持本地稳定分组、曝光去重、曝光后才附加归因、事件白名单和 Tag 规则；字段值由 SDK 生成，调用方不能覆盖。revision 变更会生成不同属性名，旧记录不回填或改名。
- 重新预览或编译并启动小程序，在首页曝光后点击发布；后台分别选择 `experiment_exposure` 和 `home_release_entry_click`，检查属性 `exp_home_publish_cta_v1` 的值一致。下方早期三字段说明为历史记录，当前以上述格式及 SDK 说明为准。

## 首页发布按钮实验启用（2026-11-21，真机入库待验收）

- 已将当前联调配置中的 `home_publish_cta.enabled` 设为 `true`，revision 保持 `v1`，A/B 权重均为 50；A 文案为“发布”，B 文案为“立即发布”。沿用 `test-audience` 标签及已有曝光/点击逻辑。
- 重新编译或预览并重新启动小程序，首页按钮渲染完成后应发送 `experiment_exposure`；随后点击发布，`home_release_entry_click` 应携带一致的实验属性（现为 `exp_home_publish_cta_v1: 'A'` 或 `'B'`）。不能仅凭按钮显示“发布”判断实验关闭，因为它也是 A 组文案。旧点击不回填实验属性。
- 本次仅启用已有实验，未主动向远程实例发送诊断流量；实际曝光与点击入库仍需按 SDK 说明真机验收。下方 2026-11-20 的“默认关闭”描述接入时状态，当前以本节为准。

## 事件属性职责更正（2026-11-21，真机入库待验收）

- 设备、客户端版本、小程序版本和环境仅通过 `identify` 写入会话属性，已取消普通事件 `data` 中的重复字段；尺寸和像素比不再生成自定义属性，标准 `language`、`screen` 保留。
- 普通事件的 `data` 仅含该事件的白名单业务、性能、实验数据及当次入口场景，空数据对象省略。入口场景会在热启动时变化，因此仍跟随事件记录；UTM 继续保存在 URL 中。错误诊断协议的版本与设备标签维持原有设计。
- 下方早期“事件携带设备/版本”的记录描述当时实现，当前以本节和 SDK 说明为准。会话属性仍需真实令牌及真机验收，未主动向实例发送诊断数据，也未清理历史数据。
- `npm test` 的 44 项回归全部通过，验证会话字段不再混入事件、空 `data` 省略、业务/性能/实验与入口属性保留，以及会话字段的缓存、长度限制和旧 API 回退。修改代码 ESLint、Prettier 和 diff 空白检查通过。

## 会话属性接入（2026-11-20，真机入库待验收）

- 目标实例公开 `/script.js` 和 Umami 官方采集文档确认：会话数据通过 `/api/send` 的 `type: identify` 上报，可仅传属性而不设置 distinct ID。chub 目录未提供 Umami 文档，本次使用官方 `https://docs.umami.is/docs/api/sending-stats` 及目标实例公开脚本核对协议。
- SDK 默认开启会话属性，在普通采集收到真实 `cache` 后附加稳定设备字段与 `miniapp_version`、`miniapp_env`。事件属性职责已在 2026-11-21 更正；尺寸、入口场景、UTM 和实验分组不写入会话属性；没有新增用户/设备标识，也没有主动向目标实例发送诊断流量。
- 会话属性独立投递，按服务端令牌去重及更新，网络/5xx 最多重试两次；并发旧响应不覆盖新令牌，关闭/重新开启后的旧请求回调不会污染新队列。`sessionProperties: false` 可单独关闭。
- `npm test` 的 42 项本地回归通过，其中 7 项新增会话属性测试覆盖真实 SDK 的单条/批量响应、批量回退、稳定属性白名单、尺寸变化仍记录在事件、机器人过滤无令牌、属性开关、API 缺失、令牌更新/并发、有限退避、关闭后迟到响应及同步网络异常。修改代码 ESLint、Prettier 和 diff 空白检查通过。实际后台字段与筛选效果仍需真机验收，不能以 Mock 成功响应替代。

真机验收：重新启动小程序并打开页面，确认普通 `/api/send` 或 `/api/batch` 返回非空 `cache`，随后有携带对应 `x-umami-cache` 的 `type: identify` 请求。在目标网站选择当前时间范围和 `test-audience`，打开“筛选器 → 会话属性”，核对 `wx_platform`、`miniapp_env` 等字段，并检查筛选后的访问和业务事件。开发版版本字符串为空时不会出现 `miniapp_version`。模拟器如果仍被机器人过滤，则不会获得令牌或发送 `identify`；不要伪造 UA、复制浏览器令牌或补造数据来替代验收。

## 小程序版本与 A/B 实验（2026-11-20，本地实现）

- 页面访问、业务、性能与实验事件添加 `miniapp_version` / `miniapp_env`，读取微信账户信息，开发版空版本不伪造。错误协议维持原有版本字段，热图未改动。
- SDK 添加 `getVariant`、`trackExposure`、`trackExperiment`，仅在本地保存组名，按网站/实验/revision 隔离；存储失败回退原界面。曝光按每次启动去重，业务事件只有在曝光后显式调用归因方法才带实验属性。
- 首页“发布”/“立即发布”文案实验已接入，配置默认关闭，没有向目标实例主动发送实验数据。保留 `test-audience` 标签，分组作为事件属性分析。
- `npm test` 的 35 项本地回归通过，新增覆盖版本采集、分组持久化、权重边界、revision 隔离、曝光去重、归因白名单、关闭/重新启用统计、存储异常及真实首页定义的渲染/导航逻辑。
- 以上仅验证本地代码与构造载荷，未验证微信模拟器渲染、真机入库或 Umami 后台属性筛选。启用方法、验证步骤与重复点击/匿名会话口径限制见 `packages/umami/GUIDE.md` 的“小程序发布版本”和“A/B 实验”。

## 错误监控接入（2026-11-20，真机入库待验收）

- 接入前目标“监控 → 错误”报表的发生次数、受影响的访问、问题均为 0。目标实例公开 `/script.js` 确认错误使用 `/api/send` 的 `type: error`，与普通事件和热图协议独立。
- 已增加 App `onError`、`onUnhandledRejection` 和 `umami.captureException`，携带脱敏消息/堆栈、页面、真实版本/环境、设备白名单标签。错误有独立有界队列、1 秒去重、20 条/分钟限流、有限退避重试、429 暂停及停用清理；不增加 PV 或业务事件。
- 开发者工具重新编译后首页正常，控制台 `grep -i error` 无匹配；运行时确认 App 两个错误处理函数存在。通过实际 `getApp().onError` 调用提交一条明确命名的 `umami_error_monitor_diagnostic_20261120` 联调错误，未抛出或制造业务崩溃。
- 实际请求为 `type: error`、`version: 1`、`handled: false`、`url: /pages/home/index`、`environment: develop`、`screen: 390x844`；包含 `source: runtime`、`wx_platform: devtools` 等标签。开发版微信版本字段为空，因此 `release` 保持为空。服务端响应 **200、`{ ok: false, reason: 'bot' }`**，明确未接收模拟器错误，不能将其视为问题已入库。
- 未关闭机器人过滤、伪造 UA 或借用浏览器会话。错误监控代码已接入，但真机的错误入库、问题分组、受影响访问、状态管理及筛选仍需实际验收。
- `npm test` 的 29 项单元测试通过，其中 7 项新增错误监控测试覆盖 App 接入、协议/会话、脱敏、去重/有界限流、退避/重试、429、关闭与异常隔离。修改代码 ESLint、Prettier 和 diff 空白检查通过。刷新后台后计数仍为 0，与服务端过滤结果一致。

真机验收步骤：

1. 使用更新代码在手机微信打开小程序，确认 request 域名/HTTPS 配置可用；当前局域网开发地址需手机可访问。
2. 在真机调试环境中通过 `umami.captureException(new Error('umami_error_monitor_device_diagnostic'))` 发出一条明确标记的错误；自动异常链路应在隔离测试环境验证，避免影响真实业务。不要将 Token 或用户输入放入错误文案。
3. 检查 `/api/send` 的 `type: error` 请求及服务端响应；`ok: false`、机器人过滤或 HTTP 200 本身均不证明入库成功。随后在后台“监控 → 错误”选择包含发生时间的范围，检查对应问题、发生次数、页面与堆栈，并验证环境/版本筛选。
4. 同一错误间隔超过 1 秒再次上报，确认服务端聚合为同一问题且发生次数增加；按需验证已解决/忽略等状态行为。已捕获错误应标记 handled，自动捕获标记 unhandled。当前 SDK 不做历史错误回填或源码映射解析。

## 行为热图接入（2026-11-20，真机待验收）

- 目标热图 GET 接口返回 200，初始结果为 `pages: []`、`points: []`、`snapshot: null`。网站公开 `/recorder` 配置初始为 `enabled: false`。
- 已在目标网站设置开启**热图**并将测试采样率设为 `1`（100%）；回放保持关闭。重新读取公开配置确认 `enabled: true`、`heatmapEnabled: true`、`heatmapSampleRate: 1`、`replayEnabled: false`。
- SDK 已接入官方 `/api/record` 的 `type: heatmap` 协议、会话令牌复用、坐标白名单、页面/原生滚动容器采集及有界重试。功能覆盖和截图背景限制见 `packages/umami/GUIDE.md` 的“行为热图”。热图不写普通业务事件表，不额外增加 PV。
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

字段仅代表已构建并发出的采集载荷，不证明入库。模拟器机器人过滤限制仍适用；真机系统信息与 Umami 自定义属性展示待真机验收。实现与字段表见 `packages/umami/GUIDE.md` 的“系统与设备信息”。

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
