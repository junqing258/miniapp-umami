# TDesign 通用页面模板

基于 TDesign 打造的通用页面模板，包含通用的登陆注册、个人中心、设置中心、信息流等等功能。

## 模版功能预览

### 首页

<div style="display: flex">
  <img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/home-1.png">
  <img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/home-2.png">
</div>

### 信息发布

<img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/publish-1.png">

### 搜索页

<img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/search-1.png">

### 个人中心
<div style="display: flex">
  <img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/user-1.png">
  <img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/user-2.png">
  <img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/user-3.png">
</div>


### 设置中心

<img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/setting-1.png">

### 消息中心

<img width="375" alt="image" src="https://tdesign.gtimg.com/miniprogram/template/message-1.png">


## 开发预览
### 目录结构（TODO: 生成目录结构树）


### 在开发者工具中预览

```bash
# 安装项目依赖
npm install

```

打开[微信开发者工具](https://mp.weixin.qq.com/debug/wxadoc/dev/devtools/download.html)，导入整个项目，构建 npm 包，就可以预览示例了。

## Umami 统计

统计 SDK 位于 `utils/umami/`，由 `app.js` 将根目录 `config.js` 的 `umami` 配置注入。默认关闭，避免局域网联调数据或 Mock 数据进入报表。开启前需要填写可被小程序访问的 HTTPS `/api/send` 地址并配置微信 request 合法域名。

高并发场景的削峰、限流与可靠转发方案见 [Umami 采集网关说明](docs/umami-ingestion-gateway.md)。

页面通过 `definePage` 在每次 `onShow` 自动统计；不要在业务页额外发送页面访问。已接入的业务事件是登录成功、搜索提交、发布点击、保存草稿点击和首页主动刷新。SDK 仅发送白名单属性，不会发送手机号、验证码、密码、Token、搜索原文、聊天内容或路由 query。

当前实现的上线前验收仍须在开发者工具和两台真机完成：确认目标 Umami 版本与 User-Agent 接受情况、绝对 referrer 和语言展示、Mock 对完整采集 URL 的透传、同 WiFi/不同网络下的 UV 口径，以及真实登录 API 的业务成功响应契约。局域网 HTTP 地址只可用于临时调试，不是正式发布配置。

### 基础库版本

最低基础库版本`^2.6.5`


## 贡献成员

<a href="https://github.com/TDesignOteam/tdesign-miniprogram-starter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=TDesignOteam/tdesign-miniprogram-starter" />
</a>

## 反馈

有任何问题，建议通过 [Github issues](https://github.com/TDesignOteam/tdesign-miniprogram-starter/issues) 反馈。

## 开源协议

TDesign 遵循 [MIT 协议](https://github.com/TDesignOteam/tdesign-miniprogram-starter/blob/main/LICENSE)。
