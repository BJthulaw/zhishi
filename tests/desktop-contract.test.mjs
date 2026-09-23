import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);const {operations,validPayload}=require('../desktop/operations.cjs');
test('桌面桥接限制操作和输入规模',()=>{
 assert.equal(operations.exec,undefined);assert.equal(operations.readFile,undefined);assert.equal(operations.fetch,undefined);
 assert.equal(validPayload(null),false);assert.equal(validPayload([]),false);assert.equal(validPayload({text:'a'.repeat(4*1024*1024)}),false);assert.equal(validPayload({text:'笔记'}),true);
});
test('preload 与主进程具名操作完整对应',()=>{
 const preload=readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 const names=[...preload.match(/const names\s*=\s*\[([\s\S]*?)\]/)[1].matchAll(/["']([^"']+)["']/g)].map(x=>x[1]);
 assert.deepEqual(names.sort(),Object.keys(operations).sort());
});
test('Windows 安装生命周期只创建或移除本应用快捷方式',()=>{
 const {installerAction}=require('../desktop/installer.cjs');
 assert.equal(installerAction([], 'C:/Apps/Zhishi.exe'),null);
 assert.deepEqual(installerAction(['--squirrel-install'],'C:/Apps/app-0.1.0/Zhishi.exe').args,['--createShortcut','Zhishi.exe']);
 assert.deepEqual(installerAction(['--squirrel-uninstall'],'C:/Apps/app-0.1.0/Zhishi.exe').args,['--removeShortcut','Zhishi.exe']);
 assert.deepEqual(installerAction(['--squirrel-obsolete'],'C:/Apps/app-0.1.0/Zhishi.exe').args,[]);
});
