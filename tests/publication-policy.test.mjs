import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

test('credentials, personal libraries and generated artifacts stay ignored', () => {
  const sensitive = ['.env', '.env.local', 'settings.json', 'credential.bin',
    'library/objects/source.json', 'originals/private.pdf', 'notes.sqlite',
    '.smoke-profile/library.json', '.smoke-fixtures/sample.docx',
    'docs/screenshots/reading.png', 'docs/live-answer.json',
    'out/setup.exe', 'node_modules/a/index.js', '.venv/pyvenv.cfg'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'],
    { input: sensitive.join('\n'), encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, sensitive);
  assert.ok(existsSync('app/api.py'));
  assert.ok(existsSync('desktop/assets/installing.gif'));
  assert.ok(existsSync('docs/architecture/知拾-总体架构.svg'));
});

test('project introduction focuses on usage rather than publishing history', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.ok(readme.includes('## 模型配置'));
  assert.ok(readme.includes('docs/features/知拾-功能说明.png'));
  assert.ok(existsSync('docs/features/知拾-功能说明.png'));
  assert.ok(existsSync('docs/features/知拾-功能说明.svg'));
  for (const phrase of ['本仓库仅分发', '全新 Git 历史', '个人验收历史', '相应截图不分发']) {
    assert.equal(readme.includes(phrase), false);
  }
});
