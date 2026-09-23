import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
test('license metadata and packaged notices match the project terms', () => {
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.equal(pkg.license,'SEE LICENSE IN LICENSE');
  assert.equal(lock.packages[''].license,pkg.license);
  const license=read('LICENSE');
  assert.match(license,/商业使用须事先取得/);
  assert.match(license,/https:\/\/github.com\/BJthulaw\/zhishi/);
  assert.match(license,/第三方许可/);
  assert.equal(read('desktop/licenses/zhishi/LICENSE'),license);
  assert.equal(read('desktop/licenses/zhishi/NOTICE.md'),read('NOTICE.md'));
  assert.match(read('README.md'),/非商业/);
});
