const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 在临时副本中关闭统计并启用业务 Mock，保留工作区的配置与登录缓存。
function prepareProject(root) {
  if (!fs.existsSync(path.join(root, 'miniprogram_npm/tdesign-miniprogram'))) {
    throw new Error('缺少 miniprogram_npm/tdesign-miniprogram，请先在微信开发者工具中执行「工具 → 构建 npm」');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-umami-e2e-'));
  const projectPath = path.join(directory, 'project');
  const excluded = new Set(['node_modules', 'tests', 'docs', 'artifacts', 'project.private.config.json']);
  try {
    fs.cpSync(root, projectPath, {
      recursive: true,
      filter(source) {
        const relative = path.relative(root, source);
        const first = relative.split(path.sep)[0];
        return !first.startsWith('.') && !excluded.has(first);
      },
    });
    fs.renameSync(path.join(projectPath, 'config.js'), path.join(projectPath, 'config.e2e-original.js'));
    fs.writeFileSync(
      path.join(projectPath, 'config.js'),
      [
        "import config from './config.e2e-original.js';",
        'export default { ...config, isMock: true, umami: { ...config.umami, enabled: false } };',
        '',
      ].join('\n'),
    );
    return { projectPath, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { prepareProject };
