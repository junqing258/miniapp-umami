export default {
  isMock: true,
  baseUrl: '',
  umami: {
    eventProperties: {
      login_success: ['method', 'mock'],
      search_submit: ['source', 'keyword_length'],
      release_click: [],
      draft_save_click: [],
      home_refresh: [],
      home_list_item_click: ['source', 'position'],
      home_release_entry_click: [],
    },
    pageTitles: {
      '/pages/home/index': '首页',
      '/pages/message/index': '消息',
      '/pages/my/index': '我的',
      '/pages/search/index': '搜索',
      '/pages/my/info-edit/index': '编辑资料',
      '/pages/chat/index': '聊天',
      '/pages/login/login': '登录',
      '/pages/loginCode/loginCode': '验证码登录',
      '/pages/dataCenter/index': '数据中心',
      '/pages/setting/index': '设置',
      '/pages/release/index': '发布',
    },
    // Enabled for local testing; production requires HTTPS, privacy review, and real-device checks.
    enabled: true,
    endpoint: 'https://umami.xiaoanai.top/api/send',
    websiteId: '543538c5-b3bb-4858-b8ac-850cad751578',
    hostname: 'miniapp.local',
    // 联调数据的固定受众标签；在 Umami 中按 Tag = test-audience 筛选。
    // 正式发布前请删除或改为正式受众标签，避免测试流量混入生产报表。
    tag: 'test-audience',
    // 每批最多 10 条，正常情况下最多等待 1.5 秒；切后台时立即尽力发送。
    batchSize: 10,
    batchDelay: 1500,
    debug: false,
    // 稳定的设备、版本和环境字段仅通过会话属性上报。
    sessionProperties: true,
    // 安装级稳定分组；修改文案、权重或实验含义时递增 revision，重新分组。
    experiments: {
      home_publish_cta: { enabled: true, revision: 'v1', variants: { A: 50, B: 50 } },
    },
    // 独立 type: error 协议；版本/环境默认读取微信 miniProgram.version/envVersion。
    errors: { enabled: true },
    // 独立 /api/record 协议；服务端热图开关和采样率仍生效。
    heatmap: { enabled: true },
  },
};
