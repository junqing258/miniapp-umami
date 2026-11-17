export default {
  isMock: true,
  baseUrl: '',
  umami: {
    // Keep disabled until the local endpoint, privacy notice, and real-device checks are complete.
    enabled: true,
    endpoint: 'http://192.168.31.120:3002/api/send',
    websiteId: '543538c5-b3bb-4858-b8ac-850cad751578',
    hostname: 'miniapp.local',
    // 联调数据的固定受众标签；在 Umami 中按 Tag = test-audience 筛选。
    // 正式发布前请删除或改为正式受众标签，避免测试流量混入生产报表。
    tag: 'test-audience',
    debug: false,
  },
};
