const assert = require('node:assert/strict');
const { before, after, describe, it } = require('node:test');
const automator = require('miniprogram-automator');
const { loadConfig } = require('./config.cjs');
const { prepareProject } = require('./project.cjs');
const {
  withTimeout,
  waitFor,
  element,
  currentPage,
  reLaunch,
  captureFailure,
  withFailureArtifacts,
} = require('./helpers.cjs');

const config = loadConfig();
let miniProgram;
let project;

describe('小程序模拟器自动化', { concurrency: false }, () => {
  before(
    async () => {
      try {
        project = prepareProject(config.root);
        miniProgram = await automator.launch({
          projectPath: project.projectPath,
          cliPath: config.cliPath,
          port: config.port,
          timeout: config.launchTimeout,
        });
      } catch (error) {
        await captureFailure(miniProgram, config.artifactsDir, 'setup', error);
        throw error;
      }
    },
    { timeout: config.launchTimeout + 15000 },
  );

  after(
    async () => {
      try {
        if (miniProgram) await withTimeout(miniProgram.close(), 5000, '关闭测试窗口');
      } finally {
        try {
          if (miniProgram) await miniProgram.disconnect();
        } finally {
          if (project) project.cleanup();
        }
      }
    },
    { timeout: 15000 },
  );

  const scenario = (name, run) => {
    it(name, { timeout: config.testTimeout + 10000 }, () =>
      withFailureArtifacts(miniProgram, config.artifactsDir, name, () => run(miniProgram), config.testTimeout),
    );
  };

  scenario('home-loads-mock-content', async (app) => {
    const page = await reLaunch(app, 'pages/home/index');
    assert.ok(page);
    await element(page, '.home-container');
    await waitFor(async () => (await page.data('cardInfo')).length > 0, '首页卡片数据');
    assert.ok((await page.data('swiperList')).length > 0, '轮播数据应加载');
    await element(page, '.home-card-list');
  });

  scenario('home-opens-release', async (app) => {
    const home = await reLaunch(app, 'pages/home/index');
    await (await element(home, '#release-entry')).tap();
    const release = await currentPage(app, 'pages/release/index');
    await element(release, '.release-container');
    await element(release, '.desc');
  });

  scenario('search-popular-updates-and-deduplicates-history', async (app) => {
    const page = await reLaunch(app, 'pages/search/index');
    await waitFor(async () => (await page.data('popularWords')).length > 0, '热门搜索数据');
    await waitFor(async () => (await page.data('historyWords')).length > 0, '搜索历史数据');
    const keyword = (await page.data('popularWords'))[0];
    await (await element(page, '.popular-wrap .search-item')).tap();
    await waitFor(async () => (await page.data('searchValue')) === keyword, '点击关键词后更新搜索词');
    await (await element(page, '.popular-wrap .search-item')).tap();
    const history = await page.data('historyWords');
    assert.equal(history[0], keyword);
    assert.equal(history.filter((word) => word === keyword).length, 1, '重复搜索应去重');
    assert.ok((await page.$$('.history-wrap .search-item')).length > 0);
  });

  scenario('login-switches-to-password-mode', async (app) => {
    const page = await reLaunch(app, 'pages/login/login');
    assert.equal(await page.data('isPasswordLogin'), false);
    assert.equal(await page.data('isSubmit'), false);
    await (await element(page, '#login-mode-toggle')).tap();
    await element(page, '.login__password');
    assert.equal(await page.data('isPasswordLogin'), true);
    await element(page, '#login-account');
    await element(page, '#login-password');
    assert.equal(await page.data('isSubmit'), false, '空账号密码不能提交');
  });
});
