import assert from 'node:assert/strict';
import { newerVersion, selectAppUpdate, validAppUpdate } from '../src/lib/app-update-policy.ts';

const installed={version:'2.0.6',versionCode:23,architecture:'armv7',canInstall:false};
function release(version,architecture='armv7',changes={}) {
  return {tag_name:`v${version}`,draft:false,prerelease:false,body:'Release notes',assets:[{
    name:`NightShelf-${version}-${architecture}.apk`,state:'uploaded',size:40000000,digest:`sha256:${'a'.repeat(64)}`,
    browser_download_url:`https://github.com/NaiJii/nightshelf/releases/download/v${version}/NightShelf-${version}-${architecture}.apk`,
  }],...changes};
}
assert.ok(newerVersion('2.0.10','2.0.9'));
assert.ok(!newerVersion('2.0.6','2.0.6'));
assert.ok(!newerVersion('1.99.99','2.0.6'));
assert.ok(!newerVersion('2.1.0-beta','2.0.6'));
assert.equal(selectAppUpdate([release('2.0.6'),release('2.0.5')],installed),null,'same and older APKs are never offered');
assert.equal(selectAppUpdate([release('2.0.8','arm64')],installed),null,'64-bit hardware does not cause an ARMv7 installation to switch to ARM64');
assert.equal(selectAppUpdate([release('2.0.8','arm64'),release('2.0.7')],installed).version,'2.0.7','a missing architecture in the newest release falls back to the newest compatible update');
const selected=selectAppUpdate([release('2.0.7'),release('2.0.10'),release('2.0.8')],installed);
assert.equal(selected.version,'2.0.10','API ordering is not trusted for version comparison');
assert.equal(selectAppUpdate([release('2.0.9','armv7',{draft:true}),release('2.0.8','armv7',{prerelease:true})],installed),null);
for(const change of [
  {digest:undefined},{digest:'md5:abc'},{digest:'sha256:abc'},{state:'new'},
  {browser_download_url:'https://evil.example/NightShelf.apk'},{size:0},{size:400*1024**2},
]) {
  const value=release('2.0.7');Object.assign(value.assets[0],change);
  assert.equal(selectAppUpdate([value],installed),null,'incomplete or untrusted release assets cannot be installed');
}
assert.equal(validAppUpdate({...selected,url:selected.url.replace('NaiJii/nightshelf','another/repo')},installed),null,'cached updates are validated against the pinned repository too');
assert.equal(validAppUpdate(selected,{...installed,version:'2.0.10'}),null,'a completed installation invalidates the cached update');
assert.throws(()=>selectAppUpdate({},installed),/invalid release list/);
console.log('App update versions, stable releases, per-installation ABI, release URLs, hashes and cached update validation passed');
