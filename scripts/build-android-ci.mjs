import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'linux', 'This script builds on the GitHub Linux runner');
assert.ok(process.env.RUNNER_TEMP, 'Missing runner temporary directory');
const credentials = JSON.parse(process.env.ANDROID_SIGNING_CREDENTIALS || '{}');
for (const key of ['keystore', 'keystorePassword', 'keyAlias', 'keyPassword']) assert.ok(typeof credentials[key] === 'string' && credentials[key], `Missing signing credential: ${key}`);
const keystore = join(process.env.RUNNER_TEMP, 'nightshelf-release.jks');
const env = { ...process.env, NIGHTSHELF_KEYSTORE_PATH: keystore, NIGHTSHELF_STORE_PASSWORD: credentials.keystorePassword, NIGHTSHELF_KEY_ALIAS: credentials.keyAlias, NIGHTSHELF_KEY_PASSWORD: credentials.keyPassword };
delete env.ANDROID_SIGNING_CREDENTIALS;
delete process.env.ANDROID_SIGNING_CREDENTIALS;
const run = (command, args, cwd = process.cwd(), capture = false) => {
  const result = spawnSync(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
  return result.stdout || '';
};
try {
  writeFileSync(keystore, Buffer.from(credentials.keystore, 'base64'), { mode: 0o600 });
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  run('bash', ['./gradlew', ':background-downloads:testReleaseUnitTest', ':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--no-daemon', '--max-workers=2', '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g'], join(process.cwd(), 'android'));
  const apk = join(process.cwd(), 'android/app/build/outputs/apk/release/app-release.apk');
  const signer = join(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT, 'build-tools/36.0.0/apksigner');
  const certificates = run(signer, ['verify', '--print-certs', apk], process.cwd(), true);
  assert.match(certificates.toLowerCase(), /36ab9c75b4d38aae461dcb74f1f5760eb20b314ce17f07f47b386e2941d151d7/, 'APK must use the existing NightShelf release certificate');
  const files = run('unzip', ['-Z1', apk], process.cwd(), true).split('\n');
  const architectures = [...new Set(files.filter(file => /^lib\/[^/]+\//.test(file)).map(file => file.split('/')[1]))];
  assert.deepEqual(architectures, ['arm64-v8a'], 'APK must contain only ARM64 native libraries');
  mkdirSync('artifacts', { recursive: true });
  const version = JSON.parse(readFileSync('app.json', 'utf8')).expo.version;
  copyFileSync(apk, join('artifacts', `NightShelf-${version}-arm64.apk`));
  console.log(`Verified signed ARM64 APK: artifacts/NightShelf-${version}-arm64.apk`);
} finally {
  rmSync(keystore, { force: true });
}
