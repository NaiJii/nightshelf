import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const script = readFileSync(new URL('./build-android-ci.mjs', import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function build(architecture, actualAbi = architecture === 'armv7' ? 'armeabi-v7a' : 'arm64-v8a', certificate = '36ab9c75b4d38aae461dcb74f1f5760eb20b314ce17f07f47b386e2941d151d7') {
  const commands = [], copies = [], removed = [];
  const process = { platform:'linux', cwd:()=>'/project', env:{RUNNER_TEMP:'/runner',ANDROID_HOME:'/sdk',ANDROID_ARCH:architecture,ANDROID_SIGNING_CREDENTIALS:JSON.stringify({keystore:'AA==',keystorePassword:'test',keyAlias:'test',keyPassword:'test'})} };
  vm.runInNewContext(script, {
    assert, process, join, Buffer, console:{log(){}},
    mkdirSync(){},writeFileSync(){},rmSync:path=>removed.push(path),copyFileSync:(...args)=>copies.push(args),
    readFileSync:()=>JSON.stringify({expo:{version:'2.0.6'}}),
    spawnSync:(command,args,options)=>{
      assert.equal(options.env.ANDROID_SIGNING_CREDENTIALS,undefined,'credentials JSON is not forwarded to child processes');
      commands.push({command,args});
      return {status:0,stdout:command.endsWith('apksigner')?certificate:command==='unzip'?`lib/${actualAbi}/libhermes.so\n`:''};
    },
  });
  return {commands,copies,removed};
}
for (const [target,abi] of [['arm64','arm64-v8a'],['armv7','armeabi-v7a']]) {
  const result=build(target);
  assert.ok(result.commands.find(call=>call.command==='bash').args.includes(`-PreactNativeArchitectures=${abi}`));
  assert.ok(result.copies[0][1].endsWith(`NightShelf-2.0.6-${target}.apk`));
  assert.equal(result.removed.length,1,'temporary keystore is removed');
}
assert.throws(()=>build('armv7','arm64-v8a'),/APK must contain only/,'a wrongly packaged 32-bit build is rejected');
assert.throws(()=>build('armv7','armeabi-v7a','wrong certificate'),/existing NightShelf release certificate/);
assert.throws(()=>build('unknown'),/ANDROID_ARCH must be/);
console.log('Android target selection, package ABI and signing verification checks passed');
