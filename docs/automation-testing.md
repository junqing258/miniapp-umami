# 小程序自动化测试

采用官方 `miniprogram-automator` 驱动微信开发者工具模拟器，使用 Node.js 内置 `node:test` 编排、断言和输出报告。Node.js 版本要求为 18.8 及以上（建议使用当前 LTS）。

## 安装与运行

1. 执行 `npm ci` 安装依赖。
2. 安装并登录微信开发者工具，导入本项目，在「工具 → 构建 npm」生成 `miniprogram_npm`。
3. 在开发者工具「设置 → 安全设置」开启「服务端口」。首次运行时，按工具提示确认自动化授权。
4. 执行下列命令：

```bash
npm test                 # 单元测试，无需开发者工具
npm run test:umami       # 仅已有的 Umami 单元测试
npm run test:e2e         # 模拟器自动化测试
npm run test:all         # 单元测试 + 模拟器测试
```

E2E 会将项目复制到系统临时目录，复用已构建的 `miniprogram_npm`，在副本中强制 `isMock: true`、`umami.enabled: false`；不复制原项目的私有配置与登录缓存。结束时关闭测试窗口、断开连接并删除副本。异常终止进程可能留下以 `miniapp-umami-e2e-` 开头的临时目录，可在关闭对应窗口后删除。

## 可选配置

通过环境变量覆盖默认值，无需修改测试代码：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WECHAT_DEVTOOLS_CLI` | SDK 自动发现 macOS/Windows 默认安装位置 | 官方开发者工具 CLI 的绝对路径（macOS 为 `Contents/MacOS/cli`，Windows 为 `cli.bat`） |
| `MINIPROGRAM_AUTO_PORT` | `9420` | 自动化 WebSocket 端口；须未被占用 |
| `E2E_LAUNCH_TIMEOUT` | `60000` | 启动超时，毫秒 |
| `E2E_TEST_TIMEOUT` | `30000` | 单个用例超时，毫秒 |
| `E2E_ARTIFACTS_DIR` | `artifacts/e2e` | 失败截图和错误堆栈输出目录，相对项目根或绝对路径 |

macOS / Linux shell 示例：

```bash
WECHAT_DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npm run test:e2e
MINIPROGRAM_AUTO_PORT=9520 npm run test:e2e
```

Windows PowerShell 示例：

```powershell
$env:WECHAT_DEVTOOLS_CLI = 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat'
npm run test:e2e
```

## 用例与扩展

当前覆盖：首页 Mock 数据加载、点击发布入口进入发布页、点击热门搜索更新并去重历史、切换密码登录且空账号密码不可提交。用例只验证本地交互，不提交真实登录或发布请求。

- `tests/e2e/config.cjs`：环境配置与参数校验。
- `tests/e2e/project.cjs`：准备和清理隔离项目。
- `tests/e2e/helpers.cjs`：有截止时间的状态等待、元素定位与失败证据。
- `tests/e2e/smoke.test.cjs`：串行场景、启动和退出钩子。
- `tests/automation.test.cjs`：无需模拟器即可验证配置校验、项目隔离及错误处理。

在 `smoke.test.cjs` 的 `describe` 内添加 `scenario('英文场景名', async (app) => { ... })`。每个场景先通过 `reLaunch` 进入独立初始页，再通过 `element` 获取元素并点击，以页面路由、渲染结果和业务状态作断言。优先使用稳定 ID 或页面业务 class；自定义组件的多层组合选择器在不同工具版本间可能存在差异。

等待通过条件轮询完成，不依赖固定长延迟。断言失败会生成同名前缀的 `.txt` 错误堆栈和 `.png` 截图；若启动失败尚无连接，仅保存堆栈。证据目录已加入 Git 忽略规则。

## CI 与排错

PR 工作流自动运行单元测试。E2E 需安装、登录并开启服务端口的微信开发者工具，适合有桌面的 macOS/Windows 自托管 runner；普通 Linux runner 不执行模拟器测试。可在具备这些条件的 runner 上运行 `npm ci`、构建 npm 后执行 `npm run test:e2e`，失败时收集 `artifacts/e2e/`。

- 找不到 CLI：检查安装位置，或设置 `WECHAT_DEVTOOLS_CLI`。
- 启动失败/连接超时：确认已登录、服务端口开启、自动化授权通过，查看 `artifacts/e2e/*setup.txt` 中附带的 CLI 输出。
- 缺少 TDesign 组件：在原项目开发者工具中重新构建 npm 后重试。
- 元素等待超时：先查失败截图，检查路由和选择器；不要仅增加超时来掩盖页面错误。
- 端口被占用：关闭旧测试窗口或更换 `MINIPROGRAM_AUTO_PORT`；同一模拟器连接上的用例必须串行执行。
