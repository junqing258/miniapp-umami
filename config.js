export default {
  isMock: true,
  baseUrl: '',
  umami: {
    // Enabled for local testing; production requires HTTPS, privacy review, and real-device checks.
    enabled: true,
    endpoint: 'http://192.168.31.120:3002/api/send',
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
    // 与 app.json 的 subpackages 保持同步，用于将原生 route 性能归因到分包。
    subpackages: [
      { name: 'search', root: '/pages/search' },
      { name: 'edit', root: '/pages/my/info-edit' },
      { name: 'chat', root: '/pages/chat' },
      { name: 'login', root: '/pages/login' },
      { name: 'loginCode', root: '/pages/loginCode' },
      { name: 'dataCenter', root: '/pages/dataCenter' },
      { name: 'setting', root: '/pages/setting' },
      { name: 'release', root: '/pages/release' },
    ],
  },
};
