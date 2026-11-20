const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function withTimeout(promise, timeout, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`等待超时：${description}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(check, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  // 条件查询必须串行，避免重叠的 Automator 协议请求。
  /* eslint-disable no-await-in-loop */
  while (Date.now() < deadline) {
    const result = await withTimeout(Promise.resolve().then(check), deadline - Date.now(), description);
    if (result) return result;
    await delay(100);
  }
  /* eslint-enable no-await-in-loop */
  throw new Error(`等待超时：${description}`);
}

async function element(page, selector) {
  return waitFor(() => page.$(selector), `${page.path} 中的 ${selector}`);
}

async function currentPage(miniProgram, route) {
  return waitFor(async () => {
    try {
      const page = await miniProgram.currentPage();
      return page && page.path === route ? page : null;
    } catch (error) {
      // 开发者工具首次编译/切页期间可能尚无 page metadata。
      if (error.message.includes('getPageMetaByWebviewId')) return null;
      throw error;
    }
  }, `页面 ${route}`);
}

async function reLaunch(miniProgram, route) {
  await miniProgram.callWxMethod('reLaunch', { url: `/${route}` });
  return currentPage(miniProgram, route);
}

async function captureFailure(miniProgram, artifactsDir, name, error) {
  await fs.mkdir(artifactsDir, { recursive: true });
  const prefix = path.join(artifactsDir, `${Date.now()}-${name.replace(/[^a-z0-9-]/gi, '_')}`);
  await fs.writeFile(`${prefix}.txt`, error.stack || String(error));
  if (miniProgram) {
    try {
      await withTimeout(miniProgram.screenshot({ path: `${prefix}.png` }), 5000, '失败截图');
    } catch (captureError) {
      await fs.appendFile(`${prefix}.txt`, `\n截图失败：${captureError.message}`);
    }
  }
}

async function withFailureArtifacts(miniProgram, artifactsDir, name, run, timeout = 30000) {
  try {
    assert.ok(miniProgram, '自动化连接尚未建立');
    await withTimeout(Promise.resolve().then(run), timeout, name);
  } catch (error) {
    try {
      await captureFailure(miniProgram, artifactsDir, name, error);
    } catch (captureError) {
      console.error(`保存失败证据失败：${captureError.message}`);
    }
    throw error;
  }
}

module.exports = { withTimeout, waitFor, element, currentPage, reLaunch, captureFailure, withFailureArtifacts };
