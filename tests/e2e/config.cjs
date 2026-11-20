const path = require('node:path');

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return number;
}

function loadConfig(env = process.env) {
  const root = path.resolve(__dirname, '../..');
  const port = positiveInteger(env.MINIPROGRAM_AUTO_PORT, 9420, 'MINIPROGRAM_AUTO_PORT');
  if (port > 65535) throw new Error('MINIPROGRAM_AUTO_PORT 不能大于 65535');
  return {
    root,
    cliPath: env.WECHAT_DEVTOOLS_CLI || undefined,
    port,
    launchTimeout: positiveInteger(env.E2E_LAUNCH_TIMEOUT, 60000, 'E2E_LAUNCH_TIMEOUT'),
    testTimeout: positiveInteger(env.E2E_TEST_TIMEOUT, 30000, 'E2E_TEST_TIMEOUT'),
    artifactsDir: path.resolve(root, env.E2E_ARTIFACTS_DIR || 'artifacts/e2e'),
  };
}

module.exports = { loadConfig };
