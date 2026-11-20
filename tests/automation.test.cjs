const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { loadConfig } = require('./e2e/config.cjs');
const { prepareProject } = require('./e2e/project.cjs');
const { waitFor, currentPage, withFailureArtifacts } = require('./e2e/helpers.cjs');

test('automation config rejects invalid ports and timeouts before launching DevTools', () => {
  const config = loadConfig({ MINIPROGRAM_AUTO_PORT: '9520', E2E_TEST_TIMEOUT: '5000' });
  assert.equal(config.port, 9520);
  assert.equal(config.testTimeout, 5000);
  ['0', '-1', 'NaN', '1.5', '65536', ''].forEach((value) => {
    assert.throws(() => loadConfig({ MINIPROGRAM_AUTO_PORT: value }), /MINIPROGRAM_AUTO_PORT/);
  });
  assert.throws(() => loadConfig({ E2E_LAUNCH_TIMEOUT: 'abc' }), /E2E_LAUNCH_TIMEOUT/);
});

test('temporary project forces Mock and disables analytics without modifying source config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-e2e-fixture-'));
  let project;
  try {
    fs.mkdirSync(path.join(root, 'miniprogram_npm/tdesign-miniprogram'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'node_modules/private.js'), 'not copied');
    fs.writeFileSync(path.join(root, '.git/config'), 'not copied');
    fs.writeFileSync(path.join(root, 'project.private.config.json'), '{}');
    const source = 'export default { isMock: false, umami: { enabled: true, hostname: "test" } };';
    fs.writeFileSync(path.join(root, 'config.js'), source);
    project = prepareProject(root);
    // 使用独立 ESM 目录加载临时配置，验证实际导出值而非匹配生成的代码文本。
    fs.writeFileSync(path.join(project.projectPath, 'package.json'), '{"type":"module"}');
    const { default: config } = await import(pathToFileURL(path.join(project.projectPath, 'config.js')).href);
    assert.equal(config.isMock, true);
    assert.equal(config.umami.enabled, false);
    assert.equal(config.umami.hostname, 'test');
    assert.equal(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), source);
    ['node_modules', '.git', 'project.private.config.json'].forEach((entry) => {
      assert.equal(fs.existsSync(path.join(project.projectPath, entry)), false);
    });
    assert.ok(fs.existsSync(path.join(project.projectPath, 'miniprogram_npm/tdesign-miniprogram')));
    project.cleanup();
    assert.equal(fs.existsSync(project.projectPath), false);
  } finally {
    if (project) project.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing built npm fails with an actionable setup error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-e2e-missing-'));
  try {
    assert.throws(() => prepareProject(root), /构建 npm/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('waits retry transient page metadata errors and preserve real protocol failures', async () => {
  let attempts = 0;
  const page = { path: 'pages/home/index' };
  assert.equal(
    await currentPage(
      {
        async currentPage() {
          attempts += 1;
          if (attempts === 1) throw new Error('getPageMetaByWebviewId is null');
          return page;
        },
      },
      page.path,
    ),
    page,
  );
  await assert.rejects(
    currentPage(
      {
        currentPage: async () => {
          throw new Error('Connection closed');
        },
      },
      page.path,
    ),
    /Connection closed/,
  );
  await assert.rejects(
    waitFor(() => false, 'missing element', 1),
    /等待超时：missing element/,
  );
});

test('failed scenarios retain the assertion even when screenshots fail', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-e2e-artifacts-'));
  const failure = new Error('original assertion');
  try {
    const miniProgram = {
      screenshot: async () => {
        throw new Error('no screenshot');
      },
    };
    await assert.rejects(
      withFailureArtifacts(miniProgram, directory, 'failure', async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    const files = fs.readdirSync(directory);
    assert.equal(files.length, 1);
    const evidence = fs.readFileSync(path.join(directory, files[0]), 'utf8');
    assert.match(evidence, /original assertion/);
    assert.match(evidence, /no screenshot/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
