/* eslint-disable */
var __request = wx.request;
var Mock = require('./mock.js');
Object.defineProperty(wx, 'request', { writable: true });
wx.request = function (config) {
  if (typeof Mock._mocked[config.url] == 'undefined') {
    __request(config);
    return;
  }
  var resTemplate = Mock._mocked[config.url].template;
  var response = Mock.mock(resTemplate);
  var wxResponse = { statusCode: 200, data: response, header: {} };
  if (typeof config.success == 'function') {
    config.success(wxResponse);
  }
  if (typeof config.complete == 'function') {
    config.complete(wxResponse);
  }
};
module.exports = Mock;
