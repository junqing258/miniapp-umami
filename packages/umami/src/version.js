// App release is distinct from the WeChat client version and base library version.
export function createVersionContext() {
  let data;
  return () => {
    if (data) return data;
    data = {};
    try {
      const account = typeof wx.getAccountInfoSync === 'function' ? wx.getAccountInfoSync() : null;
      const info = account && account.miniProgram;
      if (info && typeof info.version === 'string') {
        const version = Array.from(info.version.trim()).slice(0, 80).join('');
        if (version) data.miniapp_version = version;
      }
      if (info && ['develop', 'trial', 'release'].includes(info.envVersion)) data.miniapp_env = info.envVersion;
    } catch (error) {
      // Missing account information must never prevent app startup or tracking.
    }
    return data;
  };
}
