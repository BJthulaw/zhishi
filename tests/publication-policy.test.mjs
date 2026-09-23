import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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
