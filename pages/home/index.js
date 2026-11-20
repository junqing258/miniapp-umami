import Message from 'tdesign-miniprogram/message/index';
import request from '~/api/request';
import umami from '~/utils/umami/index';
import { definePage } from '~/utils/umami/page';

// 获取应用实例
// const app = getApp()

definePage({
  data: {
    enable: false,
    swiperList: [],
    cardInfo: [],
    publishLabel: '发布',
    // 发布
    motto: 'Hello World',
    userInfo: {},
    hasUserInfo: false,
    canIUse: wx.canIUse('button.open-type.getUserInfo'),
    canIUseGetUserProfile: false,
    canIUseOpenData: wx.canIUse('open-data.type.userAvatarUrl') && wx.canIUse('open-data.type.userNickName'), // 如需尝试获取用户信息可改为false
  },
  // 生命周期
  async onReady() {
    const [cardRes, swiperRes] = await Promise.all([
      request('/home/cards').then((res) => res.data),
      request('/home/swipers').then((res) => res.data),
    ]);

    this.setData({
      cardInfo: cardRes.data,
      focusCardInfo: cardRes.data.slice(0, 3),
      swiperList: swiperRes.data,
    });
  },
  onLoad(option) {
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true,
      });
    }
    if (option.oper) {
      let content = '';
      if (option.oper === 'release') {
        content = '发布成功';
      } else if (option.oper === 'save') {
        content = '保存成功';
      }
      this.showOperMsg(content);
    }
  },
  onShow() {
    this.__publishVisible = true;
    const variant = umami.getVariant('home_publish_cta');
    // setData's callback runs after the selected text has been rendered.
    this.setData({ publishLabel: variant === 'B' ? '立即发布' : '发布' }, () => {
      if (this.__publishVisible && variant) umami.trackExposure('home_publish_cta');
    });
  },
  onHide() {
    this.__publishVisible = false;
  },
  onUnload() {
    this.__publishVisible = false;
  },
  onRefresh() {
    this.refresh();
  },
  async refresh() {
    this.setData({
      enable: true,
    });
    const [cardRes, swiperRes] = await Promise.all([
      request('/home/cards').then((res) => res.data),
      request('/home/swipers').then((res) => res.data),
    ]);

    setTimeout(() => {
      this.setData({
        enable: false,
        cardInfo: cardRes.data,
        swiperList: swiperRes.data,
      });
    }, 1500);
  },
  showOperMsg(content) {
    Message.success({
      context: this,
      offset: [120, 32],
      duration: 4000,
      content,
    });
  },
  goRelease() {
    umami.trackExperiment('home_publish_cta', 'home_release_entry_click');
    wx.navigateTo({
      url: '/pages/release/index',
    });
  },
  onCardTap(event) {
    const { source, position } = event.currentTarget.dataset;
    umami.track('home_list_item_click', { source, position });
  },
});
