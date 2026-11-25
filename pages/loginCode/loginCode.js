import umami from 'miniapp-umami';
import { definePage } from 'miniapp-umami/page';
import request from '~/api/request';
import config from '../../config.js';

definePage({
  data: {
    phoneNumber: '',
    sendCodeCount: 60,
    verifyCode: '',
  },

  timer: null,

  onLoad(options) {
    const { phoneNumber } = options;
    if (phoneNumber) {
      this.setData({ phoneNumber });
    }
    this.countDown();
  },

  onVerifycodeChange(e) {
    this.setData({
      verifyCode: e.detail.value,
    });
  },

  countDown() {
    this.setData({ sendCodeCount: 60 });
    this.timer = setInterval(() => {
      if (this.data.sendCodeCount <= 0) {
        this.setData({ isSend: false, sendCodeCount: 0 });
        clearInterval(this.timer);
      } else {
        this.setData({ sendCodeCount: this.data.sendCodeCount - 1 });
      }
    }, 1000);
  },

  sendCode() {
    if (this.data.sendCodeCount === 0) {
      this.countDown();
    }
  },

  async login() {
    const res = await request('/login/postCodeVerify', 'get', { code: this.data.verifyCode });
    if (res.success) {
      await wx.setStorageSync('access_token', res.data.token);
      umami.track('login_success', { method: 'code', mock: config.isMock });
      wx.switchTab({
        url: `/pages/my/index`,
      });
    }
  },
});
