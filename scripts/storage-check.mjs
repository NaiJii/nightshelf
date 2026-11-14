import assert from "node:assert/strict";
import { chapterProgress } from "../src/lib/parser.ts";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

// Exercise the actual storage code using Node's filesystem in place of Android's native file adapter.
const testRoot = mkdtempSync(join(tmpdir(), "nightshelf-check-"));
const adapter = `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath, pathToFileURL } from 'node:url';
class Entry {
  constructor(...parts) { this.path = path.join(...parts.map(value => typeof value === 'string' ? value.startsWith('file:') ? fileURLToPath(value) : value : value.path)); }
  get uri() { return pathToFileURL(this.path).href; }
  get name() { return path.basename(this.path); }
  get exists() { return fs.existsSync(this.path); }
}
export const reads = {directories:0};
export class Directory extends Entry {
  create() { fs.mkdirSync(this.path, { recursive: true }); }
  list() { reads.directories++; return fs.readdirSync(this.path, { withFileTypes: true }).map(item => item.isDirectory() ? new Directory(this, item.name) : new File(this, item.name)); }
  delete() { fs.rmSync(this.path, { recursive: true }); }
}
export class File extends Entry {
  delete() { fs.unlinkSync(this.path); }
  write(value) { fs.writeFileSync(this.path, value); }
  textSync() { return fs.readFileSync(this.path, 'utf8'); }
  open() { const bytes=fs.readFileSync(this.path); return {readBytes:length=>new Uint8Array(bytes.subarray(0,length)),close() {}}; }
  get size() { return fs.statSync(this.path).size; }
  get md5() { return crypto.createHash('md5').update(fs.readFileSync(this.path)).digest('hex'); }
  move(target) { fs.renameSync(this.path,target.path); this.path=target.path; }
}
export const Paths = { availableDiskSpace: 1024 ** 3, document: ${JSON.stringify(pathToFileURL(testRoot).href)} };
`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "expo-file-system") return { url: `data:text/javascript,${encodeURIComponent(adapter)}`, shortCircuit: true };
  if (specifier === "./parser" && context.parentURL?.endsWith("/storage.ts")) return next(new URL("../src/lib/parser.ts", import.meta.url).href, context);
  if (specifier.startsWith("./") && context.parentURL?.includes("/src/lib/")) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(target))) return next(target.href, context);
  }
  return next(specifier, context);
} });
try {
  const storage = await import("../src/lib/storage.ts");
  const { File, Directory, reads } = await import("expo-file-system");
  storage.initializeStorage();
  storage.savePreferences({...storage.loadPreferences(),readerContinuous:false,readerKeepAwake:false});
  assert.equal(storage.loadPreferences().readerContinuous,true,'continuous reading is enabled even for older disabled preferences');
  assert.equal(storage.loadPreferences().readerKeepAwake,true,'reader screen stays awake without a user-facing toggle');
  storage.savePreferences({...storage.loadPreferences(),weights:{trending:0,rating:0,length:5}});
  assert.equal('weights' in storage.loadPreferences(),false,'removed recommendation weights are ignored when reading legacy preferences');

  const { readJson, writeJson } = await import('../src/lib/json-store.ts');
  const durable = new File(storage.ROOT, 'durable-test.json');
  writeJson(durable, {version:1}); writeJson(durable, {version:2});
  const originalWrite=File.prototype.write, originalMove=File.prototype.move;
  try {
    File.prototype.write=function(value) {
      if(this.name==='durable-test.json.tmp') { originalWrite.call(this,'{');throw Error('Disk full'); }
      return originalWrite.call(this,value);
    };
    assert.throws(()=>writeJson(durable,{version:3}),/Disk full/);
    assert.deepEqual(readJson(durable,{}),{version:2},'an interrupted temp write leaves the live metadata untouched');
  } finally { File.prototype.write=originalWrite; }
  try {
    File.prototype.move=function(target) { if(target.uri===durable.uri)throw Error('Interrupted commit'); return originalMove.call(this,target); };
    assert.throws(()=>writeJson(durable,{version:3}),/Interrupted commit/);
    assert.equal(durable.exists,false,'simulate process interruption between backup rotation and installation');
    assert.deepEqual(readJson(durable,{}),{version:2},'missing primary recovers the last committed version');
  } finally { File.prototype.move=originalMove; }
  writeJson(durable,{version:3});durable.write('{');
  assert.deepEqual(readJson(durable,{}),{version:2},'corrupt metadata recovers from the backup');
  writeJson(durable,{version:4});
  assert.deepEqual(readJson(new File(storage.ROOT,'durable-test.json.bak'),{}),{version:2},'a corrupt primary cannot replace a valid backup');
  durable.write('[]');assert.deepEqual(readJson(durable,{}),{version:2},'wrong-shaped primary data uses the valid backup');
  console.log('Interrupted metadata writes, failed installation and last-good recovery passed');

  for (const chapter of ["1", "2"]) {
    const folder = storage.chapterDirectory("example", chapter);
    folder.create();
    new File(folder, ".complete").write("complete");
    new File(folder, "001.webp").write("image bytes");
  }
  const partial = storage.chapterDirectory("example", "3"); partial.create();
  new File(partial, "001.webp.part").write("partial bytes");
  const planUrls=['https://cdn/first.webp','https://cdn/second.webp','https://cdn/third.webp'];
  new File(partial, '.panels.json').write(JSON.stringify({urls:planUrls}));
  assert.equal(storage.chapterReadState('example','3').files.length,0,'unfinished .part data is never exposed to the reader');
  new File(partial,'001.webp').write('first committed panel');
  new File(partial,'.original-1').write(planUrls[0]);
  new File(partial,'003.webp').write('third panel finished out of order');
  new File(partial,'.original-3').write(planUrls[2]);
  let readable=storage.chapterReadState('example','3');
  assert.equal(readable.files.length,1,'only a contiguous prefix is readable, without skipping a missing panel');
  assert.equal(readable.total,3);assert.equal(readable.complete,false);
  new File(partial,'002.webp').write('second committed panel');
  new File(partial,'.original-2').write('stale URL');
  assert.equal(storage.chapterReadState('example','3').files.length,1,'a previous download file cannot stand in for the current panel URL');
  new File(partial,'.original-2').write(planUrls[1]);
  readable=storage.chapterReadState('example','3');
  assert.equal(readable.files.length,3);assert.equal(readable.complete,false,'all panel files alone do not create a completed chapter');
  new File(partial,'.complete').write(JSON.stringify({quality:2,urls:planUrls}));
  assert.equal(storage.chapterReadState('example','3').complete,true,'completion becomes visible after the writer commits its manifest');
  new File(partial,'.complete').delete();
  const racingFolder=storage.chapterDirectory('deletion-race','1');racingFolder.create();
  const listBeforeRace=Directory.prototype.list;
  try {
    Directory.prototype.list=function(){if(this.uri===racingFolder.uri){this.delete();throw Error('Directory removed during scan');}return listBeforeRace.call(this);};
    assert.deepEqual(storage.chapterReadState('deletion-race','1'),{files:[],total:0,complete:false},'cancel-and-delete during a reader scan yields an empty state rather than crashing');
  } finally {Directory.prototype.list=listBeforeRace;}
  const outside = new File(testRoot, "keep.txt"); outside.write("keep");
  const cover = new File(storage.COVERS, "example.webp"); cover.write("cover");
  storage.toggleSaved("example", "bookmarked"); storage.toggleSaved("example", "liked");
  storage.savePosition("example", "1", 0.25);
  storage.savePosition("example", "1", 0.25, {index:0,offset:0.5});
  assert.deepEqual(storage.readingHistory().example.chapters['1'].panel,{index:0,offset:0.5},'a growing chapter retains a precise panel anchor');
  storage.savePosition("example", "2", 0.5);
  assert.equal(chapterProgress(storage.readingHistory().example, "1"), 0.25, "opening another chapter preserves partial progress");
  assert.equal(chapterProgress({chapter:"1",fraction:0.3}, "1"),0.3,"legacy last-chapter positions remain readable");
  assert.throws(()=>storage.savePosition("example","1",NaN),/Invalid reading position/);
  storage.savePosition("progress-test", "1", 0.4);
  storage.savePosition("progress-test", "2", 0.6);
  storage.setChaptersRead("progress-test", ["1"], true);
  storage.setChaptersRead("progress-test", ["1"], false);
  assert.equal(chapterProgress(storage.readingHistory()["progress-test"],"1"),0,"marking an older chapter unread resets its progress");
  assert.equal(chapterProgress(storage.readingHistory()["progress-test"],"2"),0.6);
  assert.equal(storage.readingHistory()["progress-test"].chapter,"2","resetting another chapter does not change Continue reading");
  assert.equal(storage.readChapters().example, undefined, "a progress value does not mark a chapter as read");
  storage.markChapterRead("example", "1");
  const completedAt = storage.readChapters().example["1"];
  storage.markChapterRead("example", "1");
  assert.equal(storage.readChapters().example["1"], completedAt);
  storage.setChaptersRead("example", ["1", "2"], true);
  assert.ok(storage.readChapters().example["2"], "bulk manual read status is persisted");
  assert.throws(() => storage.setChaptersRead("example", ["2", "../bad"], false), /Invalid/);
  assert.ok(storage.readChapters().example["2"], "invalid bulk changes do not partially modify history");
  storage.setChaptersRead("example", ["2"], false);
  assert.equal(storage.readChapters().example["2"], undefined);
  assert.equal(storage.readingHistory().example.fraction, 0, "marking unread resets the saved reading position");
  assert.ok(storage.chapterDirectory("example", "2").exists, "manual read changes do not delete downloads");
  const cached = {...storage.SEED[0],slug:"example",summary:"The full offline summary.",detailsCached:true};
  const scansBeforeMetadata=reads.directories;
  storage.mergeCatalog([cached]);
  assert.equal(reads.directories,scansBeforeMetadata,'metadata commits do not synchronously rescan downloaded chapter folders');
  storage.mergeCatalog([{...cached,alternativeTitles:['Offline alias']}]);
  storage.mergeCatalog([{...cached,alternativeTitles:undefined}]);
  assert.deepEqual(storage.catalogMetadata().find(item=>item.slug==='example').alternativeTitles,['Offline alias'],'partial discovery metadata cannot erase cached aliases');
  storage.saveCatalog([cached]);
  const scansBeforeSync = reads.directories;
  const hydrated = storage.loadCatalog()[0];
  assert.equal(reads.directories - scansBeforeSync, 1, 'catalog hydration lists each story folder once');
  assert.deepEqual(hydrated.localChapters, ['1', '2'], 'partial chapters remain excluded');
  assert.equal(hydrated.hasLocalFiles, true, 'partial and completed files still count as local files');
  const scansBeforeAsync=reads.directories;
  const catalogPending=storage.loadCatalogAsync();
  assert.equal(reads.directories,scansBeforeAsync,'catalog hydration yields before accessing chapter folders');
  assert.deepEqual(await catalogPending,storage.loadCatalog(),'batched hydration retains the same saved chapter information');
  const stoppedScan=new AbortController();const scanToCancel=storage.loadCatalogAsync(stoppedScan.signal);stoppedScan.abort();
  await assert.rejects(scanToCancel,{name:'AbortError'},'large scans can be stopped between batches');
  assert.equal(storage.loadCatalog()[0].summary, cached.summary, "series details are available after reopening from storage");
  const complete = new File(storage.chapterDirectory("example", "1"), ".complete");
  complete.write(JSON.stringify({ quality: 2, urls: ["https://cdn/1.webp", "https://cdn/2.webp"] }));
  assert.equal(storage.chapterIntact("example", "1"), false, "a missing final image blocks completion");
  new File(storage.chapterDirectory("example", "1"), "002.webp").write("second image");
  assert.equal(storage.chapterIntact("example", "1"), true);
  assert.throws(() => storage.deleteChapters("../outside", [], true), /Invalid/);
  assert.throws(() => storage.deleteChapters("example", ["1", "missing"]), /not downloaded/);
  assert.ok(storage.chapterDirectory("example", "1").exists, "invalid selections must not partially delete");
  storage.deleteChapters("example", ["1"]);
  assert.deepEqual(storage.localChapters("example"), ["2"]);
  assert.ok(storage.readingHistory().example, "deleting a different chapter preserves reading position");
  storage.deleteChapters("example", ["2"], true);
  assert.ok(!new Directory(storage.LIBRARY, "example").exists, "delete all also removes partial downloads");
  assert.equal(chapterProgress(storage.readingHistory().example,"1"),0.25,"deleting files preserves resumable chapter progress");
  assert.deepEqual(storage.savedStories().example, { bookmarked: true, liked: true });
  assert.equal(storage.readChapters().example["1"], completedAt, "deleting saved files preserves chapter read history");
  assert.ok(outside.exists && cover.exists, "deletion stays inside the story's download folder");
  console.log("Storage deletion check passed");
  const tools = await import('../src/lib/library-tools.ts');
  const retention = await import('../src/lib/read-retention.ts');
  const retentionNow=Date.now(), oldRead=new Date(retentionNow-25*3600_000).toISOString();
  assert.equal(retention.readDeletionDue(new Date(retentionNow-24*3600_000+1).toISOString(),retentionNow),false);
  assert.equal(retention.readDeletionDue(new Date(retentionNow-24*3600_000).toISOString(),retentionNow),true);
  for(const value of [undefined,'bad','1',new Date(retentionNow+3600_000).toISOString()])assert.equal(retention.readDeletionDue(value,retentionNow),false);
  const retentionPrefs=storage.loadPreferences(), retentionRead=storage.readChapters(), retentionHistory=storage.readingHistory();
  for(const slug of ['retention-test','retention-protected'])for(const id of ['1','2','3','4','5']){
    const folder=storage.chapterDirectory(slug,id);folder.create();new File(folder,'.complete').write('complete');
  }
  new File(storage.ROOT,'read.json').write(JSON.stringify({...retentionRead,'retention-test':{'1':oldRead,'2':new Date(retentionNow-23*3600_000).toISOString(),'3':'invalid','4':new Date(retentionNow+3600_000).toISOString()},'retention-protected':{'1':oldRead}}));
  storage.savePosition('retention-test','1',1);
  storage.savePreferences({...retentionPrefs,deleteAfterReading:false});
  assert.equal(await tools.cleanupReadDownloads(()=>false),0,'cleanup remains opt-in');
  storage.savePreferences({...retentionPrefs,deleteAfterReading:true});
  assert.equal(await tools.cleanupReadDownloads(slug=>slug==='retention-protected'),1,'only expired read chapters outside protected readers/downloads are removed');
  assert.deepEqual(storage.localChapters('retention-test'),['2','3','4','5'],'fresh, invalid-date, future-date and unread chapters remain saved');
  assert.ok(storage.chapterDirectory('retention-protected','1').exists);
  assert.equal(storage.readChapters()['retention-test']['1'],oldRead,'24-hour cleanup retains read history');
  assert.equal(storage.readingHistory()['retention-test'].fraction,1);
  new File(storage.ROOT,'read.json').write(JSON.stringify({...storage.readChapters(),'retention-test':{'2':oldRead}}));
  const unreadCleanup=tools.cleanupReadDownloads(slug=>slug==='retention-protected');
  storage.setChaptersRead('retention-test',['2'],false);await unreadCleanup;
  assert.ok(storage.chapterDirectory('retention-test','2').exists,'marking unread before cleanup cancels pending deletion');
  for(const slug of ['retention-test','retention-protected'])storage.deleteChapters(slug,[],true);
  new File(storage.ROOT,'read.json').write(JSON.stringify(retentionRead));new File(storage.ROOT,'history.json').write(JSON.stringify(retentionHistory));storage.savePreferences(retentionPrefs);
  console.log('24-hour read retention, protected downloads/readers, unread cancellation and history preservation passed');

  const partialSize=storage.chapterDirectory('size-test','1');partialSize.create();
  new File(partialSize,'001.webp.part').write('stale partial');
  assert.equal(await tools.libraryBytesAsync(undefined,true),tools.libraryBytes(true));
  assert.ok(tools.libraryBytes(true)<tools.libraryBytes(),'retry budget ignores replaceable partials while storage reporting counts their actual disk use');
  partialSize.delete();
  const beforeBulk=storage.savedStories(), writes=[];
  try {
    File.prototype.write=function(value) { writes.push(this.name); return originalWrite.call(this,value); };
    const slugs=Array.from({length:1500},(_,index)=>'bulk-'+index);
    tools.updateStoriesOptions(slugs,{bookmarked:true});
    assert.equal(storage.savedStories()['bulk-1499'].bookmarked,true);
    assert.deepEqual(writes.sort(),['release-updates.json.tmp','releases.json.tmp','saved.json.tmp'],'large selections commit each metadata map once');
    assert.throws(()=>tools.updateStoriesOptions(['bulk-0','../outside'],{list:'reading'}),/Invalid/);
    assert.equal(storage.savedStories()['bulk-0'].list,undefined,'invalid batch input is rejected before any item is changed');
  } finally { File.prototype.write=originalWrite; writeJson(new File(storage.ROOT,'saved.json'),beforeBulk); }
  console.log('Large bulk library changes and replaceable-partial storage budgets passed');

  assert.equal(await tools.libraryBytesAsync(),tools.libraryBytes(),'batched size accounting matches exact recursive totals');
  assert.deepEqual(await tools.storageSummaryAsync(),tools.storageSummary());
  const backup = await import('../src/lib/backup.ts');
  const backupStory={...storage.SEED[0],slug:'backup-story',title:'Backup story',alternativeTitles:['Other name','Another title'],localChapters:['1'],genres:['Action']};
  storage.saveCatalog([backupStory]);tools.updateStoryOptions('backup-story',{bookmarked:true,liked:true,list:'planned',autoDownload:true});
  storage.savePosition('backup-story','2',0.25);
  storage.savePosition('backup-story','1',0.4);storage.setChaptersRead('backup-story',['1'],true);
  storage.savePreferences({...storage.loadPreferences(),genreFilters:{asura:['Action'],vortex:['Fantasy']}});
  const exported=backup.createBackup(), decoded=backup.validateBackup(exported);
  assert.equal(decoded.saved['backup-story'].list,'planned');
  assert.equal(decoded.history['backup-story'].chapters['2'].fraction,0.25,'backups include older chapter positions');
  assert.equal(decoded.saved['backup-story'].autoDownload,undefined,'portable backups cannot silently enable new automatic transfers');
  assert.equal(decoded.catalog[0].localChapters,undefined,'phone-specific chapter paths are not portable');
  assert.deepEqual(decoded.catalog[0].genres,['Action']);
  assert.deepEqual(decoded.catalog[0].alternativeTitles,['Other name','Another title'],'offline alias search survives a phone-to-phone metadata restore');
  assert.deepEqual(decoded.preferences.genreFilters,{asura:['Action'],vortex:['Fantasy']},'tag filters survive backup and restore');
  const roundTrip=JSON.parse(exported);roundTrip.history['backup-story'].readAt='2020-01-01T00:00:00Z';roundTrip.history['backup-story'].fraction=0.1;
  backup.restoreBackup(JSON.stringify(roundTrip));
  assert.equal(storage.readingHistory()['backup-story'].fraction,0.4,'newer local position survives import');
  const olderBackup=JSON.parse(exported);
  olderBackup.history['backup-story'].chapters['3']={fraction:0.7,readAt:'2021-01-01T00:00:00Z'};
  olderBackup.history['backup-story'].chapters['2']={fraction:0.1,readAt:'2021-01-01T00:00:00Z'};
  backup.restoreBackup(JSON.stringify(olderBackup));
  assert.equal(chapterProgress(storage.readingHistory()['backup-story'],'2'),0.25,'newer per-chapter progress wins during restore');
  assert.equal(chapterProgress(storage.readingHistory()['backup-story'],'3'),0.7,'restoring merges other chapter positions without replacing the last chapter');
  delete olderBackup.history['backup-story'].chapters;
  assert.ok(backup.validateBackup(JSON.stringify(olderBackup)).history['backup-story'],'old backups remain supported');

  assert.equal(storage.savedStories()['backup-story'].list,'planned');
  storage.savePreferences({...storage.loadPreferences(),genreFilters:{}});
  assert.ok(storage.readChapters()['backup-story']['1']);
  const readRestore = JSON.parse(exported);
  readRestore.read['backup-story'] = {'7':'2020-01-01T00:00:00Z'};
  readRestore.history['backup-story'] = {chapter:'7',fraction:1,readAt:'2020-01-01T00:00:00Z'};
  storage.setChaptersRead('backup-story',['7','8'],false);
  assert.ok(storage.readingHistory()['backup-story'].chapters['8'],'manual unread resets are retained even for chapters never opened');
  backup.restoreBackup(JSON.stringify(readRestore));
  assert.equal(storage.readChapters()['backup-story']['7'],undefined,'old backup read marks cannot override a newer local unread reset');
  storage.setChaptersRead('backup-story',['7'],true);
  readRestore.read['backup-story'] = {};
  readRestore.history['backup-story'] = {chapter:'7',fraction:0,readAt:'2099-01-01T00:00:00Z'};
  backup.restoreBackup(JSON.stringify(readRestore));
  assert.equal(storage.readChapters()['backup-story']['7'],undefined,'newer imported unread resets override older local read marks');
  assert.ok(storage.readChapters()['backup-story']['1'],'unrelated read chapters survive a restore');
  for(const bad of [{...roundTrip,version:999},{...roundTrip,catalog:[{...backupStory,slug:'../bad'}]},{...roundTrip,catalog:[{...backupStory,slug:'__proto__'}]},{...roundTrip,catalog:[{...backupStory,url:'https://evil.test/manga'}]}])assert.throws(()=>backup.validateBackup(JSON.stringify(bad)));
  assert.throws(()=>backup.validateBackup('bad JSON'));
  assert.throws(()=>backup.validateBackup(' '.repeat(20*1024**2+1)),/20 MB/);
  const repair=storage.chapterDirectory('backup-story','1');repair.create();
  const panel=new File(repair,'001.webp');panel.write('original image data');
  const marker=new File(repair,'.complete');marker.write(JSON.stringify({quality:2,urls:['https://cdn/001.webp'],hashes:[panel.md5]}));
  assert.equal(tools.verifyChapterFiles('backup-story','1').damaged,0);
  panel.write('corrupted image data');
  assert.equal(tools.verifyChapterFiles('backup-story','1').damaged,1,'checksum catches changed bytes even when file exists');
  assert.equal(panel.exists,true,'checking never deletes the user’s saved files');
  panel.delete();assert.equal(tools.verifyChapterFiles('backup-story','1').damaged,1,'missing panels are detected');
  tools.recordSourceHealth('vortex','parser','Catalog format changed');
  assert.equal(tools.sourceHealth().vortex.state,'parser');
  tools.recordSourceHealth('vortex','ok','Working');assert.ok(tools.sourceHealth().vortex.lastSuccess);
  assert.equal(tools.sourceForRequest('https://www.mangakakalot.gg/manga/example'),'mangakakalot');
  assert.equal(tools.sourceForRequest('https://unrelated.example/'),undefined,'unrelated image hosts do not overwrite source status');
  assert.equal(tools.estimateDownload('not-owned',2,false).bytes,36*1024**2);
  console.log('Backup validation/merge, reading lists, size estimates, source health and integrity checks passed');
  const autoStory={...storage.SEED[0],slug:'automatic-baseline',chapterIds:['1','2'],chapterCount:2,detailsCached:true};
  storage.saveCatalog([autoStory]);storage.addReleaseUpdates(autoStory.slug,['2']);
  tools.updateStoryOptions(autoStory.slug,{autoDownload:true});
  assert.equal(storage.savedStories()[autoStory.slug].bookmarked,true,'auto-download also bookmarks the story');
  assert.deepEqual(storage.savedStories()[autoStory.slug].autoDownloadBaseline,['1','2'],'enabling auto-download records existing chapters as its baseline');
  assert.deepEqual(storage.releaseSnapshots()[autoStory.slug],['1','2'],'a new bookmark cannot announce existing chapters');
  tools.updateStoryOptions(autoStory.slug,{autoDownload:false});
  storage.saveCatalog([{...autoStory,chapterIds:['1','2','3'],chapterCount:3}]);
  tools.updateStoryOptions(autoStory.slug,{autoDownload:true});
  assert.deepEqual(storage.savedStories()[autoStory.slug].autoDownloadBaseline,['1','2','3'],'re-enabling cannot catch up older release badges');
  storage.addReleaseUpdates(autoStory.slug,['2']);
  tools.updateStoryOptions(autoStory.slug,{notifyReleases:true});
  assert.deepEqual(storage.releaseSnapshots()[autoStory.slug],['1','2','3'],'opting into alerts starts with the current chapter baseline');
  assert.deepEqual(storage.releaseUpdates()[autoStory.slug],['2'],'notification opt-in preserves the existing in-app release feed');


  const fullSummary = "The complete summary saved from the story page, including its ending.";
  const comicRaw = {slug:'example',title:'Example',description:'Short ranking preview',cover:'https://cdn/example.webp',chapter_count:2};
  const novelRaw = {slug:'example',title:'Example novel',description:'Short ranking preview',chapter_count:2};
  const fakeFetch = `
export const requests=[]; export let imagePending=false;
export let asuraChallenge=false;export function setAsuraChallenge(value){asuraChallenge=value;}
export let requestFailure;export function setRequestFailure(value){requestFailure=value;}
export let coverRevision=1;export function changeCover(){coverRevision=2;}
export let verificationMode='open';export function setVerificationMode(mode){verificationMode=mode;}
export let vortexLive=false;export function setVortexLive(value){vortexLive=value;}
export let vortexPageMode='normal';export function setVortexPageMode(value){vortexPageMode=value;}
export let webtoonNew=false; export function releaseWebtoon(){webtoonNew=true;}
export let kakalotPageFailure=false; export function failKakalotPage(value){kakalotPageFailure=value;}
export async function fetch(url,options={}){
  requests.push(url); options.signal?.throwIfAborted();
  if(requestFailure?.url===url)return new Response(requestFailure.body,{status:requestFailure.status,headers:requestFailure.headers});
  if(asuraChallenge && new URL(url).hostname==='asurascans.com')return new Response('<title>Just a moment...</title>',{status:403});
  if(vortexLive && ['api.vortexscans.org','storage.vortexscans.org'].includes(new URL(url).hostname))return globalThis.fetch(url,options);
  if(new URL(url).hostname==='www.mangakakalot.gg' && options.headers['User-Agent']!=='native-test-agent') throw Error('Source requests must use the verification browser identity');
  if(['www.webtoons.com','vortexscans.org'].includes(new URL(url).hostname) && options.headers['User-Agent']!=='test') throw Error('WEBTOON must retain its separate desktop layout agent');
  const params=new URL(url).searchParams, offset=Number(params.get('offset')||0);

  if(new URL(url).hostname==='api.asurascans.com') {
    const match=new URL(url).pathname.match(new RegExp('^/api/series/([^/]+)(?:/chapters(?:/([0-9.]+))?)?$'));
    if(match) {
      const route=match[1], number=match[2];
      const ids=route==='partial'?[199,200]:['repair','cover-test'].includes(route)?[1]:[1,2];
      const cover=route==='cover-test'?'https://cdn/portrait-'+coverRevision+'.webp':'https://cdn/example.webp';
      let data;
      if(number!==undefined) {
        const pages=route==='repair'?['https://cdn/a.webp','https://cdn/b.webp']:['https://cdn/image.webp'];
        data={data:{is_locked:false,access_gate:'',chapter:{number:Number(number),series_slug:route,is_premium:false,page_count:pages.length,pages:pages.map(url=>({url}))}}};
      } else if(new URL(url).pathname.endsWith('/chapters')) data={data:ids.map(number=>({number,is_premium:false,series_slug:route}))};
      else data={series:{slug:route,title:route==='example'?'Example':route.startsWith('page-')?'Page '+route.slice(5):route.startsWith('ranking-')?'Rank '+route.slice(8):route,description:${JSON.stringify(fullSummary)},cover,chapter_count:route==='partial'?201:ids.length}};
      return {ok:true,text:async()=>JSON.stringify(data)};
    }
  }

  const pages=Array.from({length:23},(_,i)=>({slug:'page-'+i,title:'Page '+i,description:'Page result',chapter_count:3}));
  const ranking=Array.from({length:45},(_,i)=>({slug:'ranking-'+i,title:'Rank '+i,chapter_count:3}));
  if(new URL(url).hostname==='www.webtoons.com') {
    const language=new URL(url).pathname.split('/')[1];
    const story='https://www.webtoons.com/'+language+'/fantasy/example/list?title_no=42';
    const episode=id=>'<li><a href="https://www.webtoons.com/'+language+'/fantasy/example/episode/viewer?title_no=42&amp;episode_no='+id+'"><span class="subj"><span>Episode '+id+'</span></span><span class="date">Oct 14, 2026</span></a></li>';
    const card='<a href="'+story+'"><img src="https://webtoon-phinf.pstatic.net/cover.jpg"><strong class="title">Example</strong></a>';
    const data=url.includes('/ranking/')||url.includes('/search/')?card:url.includes('/viewer?')?'<img class="_images" data-url="https://webtoon-phinf.pstatic.net/panel.jpg?type=q90">':'<meta property="og:url" content="'+story+'"><meta property="og:title" content="Example"><meta property="og:image" content="https://webtoon-phinf.pstatic.net/cover.jpg"><p class="summary">Full WEBTOON summary.</p><p class="day_info">EVERY MONDAY</p><ul id="_listUl">'+(params.get('page')==='2'?episode('1'):(webtoonNew?episode('11'):'')+episode('10')+episode('9'))+'</ul>'+(params.get('page')==='2'?'':'<a href="'+story+'&amp;page=2">2</a>');
    return {ok:true,text:async()=>data};
  }
  if(new URL(url).hostname==='webtoon-phinf.pstatic.net')return {ok:true,headers:{get:()=> 'image/jpeg'},bytes:async()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])};
  if(new URL(url).hostname==='api.vortexscans.org') {
    if(params.has('view')||params.has('userId'))throw Error('Only anonymous public chapter requests are supported');
    if(new URL(url).pathname==='/api/post')return {ok:true,text:async()=>JSON.stringify({totalChapterCount:2,post:{id:42,slug:'example',postTitle:'Example',postContent:'<p>Full Vortex summary.</p>',featuredImage:'https://storage.vortexscans.org/cover.webp',averageRating:9,seriesStatus:'ONGOING',seriesType:'MANHWA',genres:[]}})};
    return {ok:true,text:async()=>JSON.stringify({totalChapterCount:2,post:{chapters:[{number:1,slug:'chapter-1',isLocked:false,isAccessible:true},{number:2,slug:'chapter-2',isLocked:false,isAccessible:true}]}})};
  }
  if(new URL(url).hostname==='vortexscans.org') {
    if(vortexPageMode==='error')return {ok:false,status:503};
    if(vortexPageMode==='unrecognized')return {ok:true,text:async()=>'<html>Changed summary markup</html>'};
    const ep=id=>'$R['+(id+10)+']={id:'+id+',slug:"chapter-'+id+'",number:'+id+',title:"",createdAt:"2026-09-01T00:00:00Z",isLocked:!1,isLockedByCoins:!1,mangaPost:$R['+(id+100)+']={id:void 0}}';
    const record='window.publicPost={id:42,slug:"example",postTitle:"Example",featuredImage:"https://storage.vortexscans.org/cover.webp",seriesStatus:"ONGOING",seriesType:"MANHWA",averageRating:9}';
    const data=url.includes('/chapter-')?'<img data-reader-page-image="true" src="https://storage.vortexscans.org/panel.webp">':'<body><h2>Popular Today</h2><a href="/series/example"><img alt="Cover of Example" src="https://storage.vortexscans.org/cover.webp"></a><h2>Latest Releases</h2><h1>Example</h1><span>9 Ratings</span><dl><dt>Status</dt><dd>ONGOING</dd><dt>Type</dt><dd>Manhwa</dd><dt>Chapters</dt><dd>2</dd></dl><div itemProp="description"><p>Full Vortex summary.</p></div></body><script>'+record+ep(1)+ep(2)+'</script>';
    return {ok:true,text:async()=>data};
  }
  if(new URL(url).hostname==='www.mangakakalot.gg') {
    if(verificationMode==='blocked')return new Response('Forbidden',{status:403});
    if(verificationMode==='challenge')return {ok:true,text:async()=>'<title>Just a moment...</title>'};
    const story='https://www.mangakakalot.gg/manga/example';
    const card='<div class="comic-list"><div class="list-comic-item-wrap"><a href="'+story+'"><img src="https://storage.waitst.com/cover.webp"></a><h3><a href="'+story+'">Example</a></h3></div></div>';
    if(url.includes('/api/manga/')) {
      if(kakalotPageFailure&&offset===2)return {ok:false,status:500};
      const ids=offset===0?[2,1]:[0];
      return {ok:true,text:async()=>JSON.stringify({success:true,data:{chapters:ids.map(id=>({chapter_num:id,chapter_slug:'chapter-'+id,chapter_name:'Chapter '+id,updated_at:'2026-09-01T00:00:00Z'})),pagination:{total:3,limit:2,offset,has_more:offset===0}}})};
    }
    const data=url.includes('/chapter-')?'<div class="container-chapter-reader"><img src="https://img-r1.2xstorage.com/panel.webp"></div>':url.includes('/manga/example')?'<div class="manga-info-top"><h1>Example</h1><li>Status : Completed</li></div><div id="contentBox"><h2>Summary</h2><p>Full MangaKakalot summary.</p></div>':card;
    return {ok:true,text:async()=>typeof data==='string'?data:JSON.stringify(data)};
  }
  if(['img-r1.2xstorage.com','storage.waitst.com'].includes(new URL(url).hostname) && options.headers.Referer!=='https://www.mangakakalot.gg/') throw Error('CDN requires the source root referrer');
  if(['storage.vortexscans.org','img-r1.2xstorage.com','storage.waitst.com'].includes(new URL(url).hostname))return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])};
  if(url.startsWith('https://cdn/portrait-'))return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,coverRevision])};
  if(['https://cdn/a.webp','https://cdn/b.webp'].includes(url))return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])};
  if(url==='https://cdn/image.webp')return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>{imagePending=true;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}};
  if(new URL(url).hostname==='asurascans.com')throw Error('Asura wrapper must use the public API, not HTML pages');
  const data = url.includes('/trending/') ? {data:params.get('limit')==='100'?ranking:[${JSON.stringify(comicRaw)}]}
    : url.includes('/series?') ? {data:pages.slice(offset,offset+20),meta:{total:23,has_more:offset+20<23}}
    : url.includes('/novel-series?') ? {data:offset?[]:[${JSON.stringify(novelRaw)}],meta:{total:1}}
    : url.includes('/novel-series/example/chapter/') ? {is_locked:false,title:'Repaired chapter',content_html:'<p>Repaired novel text.</p>'}
    : url.includes('/novel-series/example') ? {series:{...${JSON.stringify(novelRaw)},description:'The full novel summary.'},chapters:[{number:1,is_locked:false},{number:2,is_locked:true}]}
    : '';
  return {ok:true,text:async()=>typeof data==='string'?data:JSON.stringify(data)};
}`;
  const nativeStub=`export let backgroundTransfers=null;export const plans=[];export function enable(){backgroundTransfers={enqueue:async text=>plans.push(JSON.parse(text))};}export async function waitForTransfer(){}`;
  const scraperHook = registerHooks({resolve(specifier,context,next){
    if(specifier==='./source-session' && context.parentURL?.endsWith('/scraper.ts'))return {url:`data:text/javascript,export const SOURCE_AGENT='test';export const verificationUserAgent=async()=>'native-test-agent';export const isVerificationHost=url=>new URL(url).hostname==='www.mangakakalot.gg';export const verificationCookies=async()=>'';export const requireSourceVerification=()=>new Error('Verify source');`,shortCircuit:true};
    if(specifier==='nightshelf-native-test'||(specifier==='./background-downloads' && context.parentURL?.endsWith('/scraper.ts')))return {url:`data:text/javascript,${encodeURIComponent(nativeStub)}`,shortCircuit:true};
    if(specifier==='@react-native-community/netinfo' && context.parentURL?.endsWith('/scraper.ts'))return {url:`data:text/javascript,export default {fetch:async()=>({type:'wifi',isConnected:true,details:{}})}`,shortCircuit:true};
    if(specifier==='expo/fetch')return {url:`data:text/javascript,${encodeURIComponent(fakeFetch)}`,shortCircuit:true};
    if(specifier==='./network' && context.parentURL?.endsWith('/scraper.ts'))return {url:`data:text/javascript,export class NetworkPaused extends Error {}`,shortCircuit:true};
    return next(specifier,context);
  }});
  try {
    storage.toggleSaved('example','bookmarked');
    storage.saveCatalog([{...cached,title:'Example',url:'https://asurascans.com/comics/example',summary:'',detailsCached:false,syncedAt:new Date().toISOString()}]);
    const {syncCatalog,downloadChapters,repairSavedPanel,browseCatalog,enrichCatalogIds,FIRST_PAGE,refreshSeries,verifySourceSession} = await import('../src/lib/scraper.ts');
    const http = await import('expo/fetch'); const {requests} = http;
    http.setAsuraChallenge(true);
    const apiStory='https://api.asurascans.com/api/series/example';
    const asuraStart=requests.length;
    await refreshSeries({...cached,url:'https://asurascans.com/comics/example'},async()=>{});
    assert.ok(!requests.slice(asuraStart).some(url=>new URL(url).hostname==='asurascans.com'),'a challenged HTML site does not affect the public API download path');
    http.setAsuraChallenge(false);
    http.setRequestFailure({url:apiStory,status:403,body:'Forbidden'});
    await assert.rejects(()=>refreshSeries({...cached,url:'https://asurascans.com/comics/example'},async()=>{}),error=>error.code==='unavailable' && /Request failed \(403\).*API \(api.asurascans.com\)/.test(error.message),'API denial does not offer irrelevant browser verification');
    assert.equal(tools.sourceHealth().asura.state,'unavailable');
    const verificationStory='https://www.mangakakalot.gg/manga/example';
    for(const body of ['Forbidden','<title>Attention Required</title><p>Access denied</p>']) {
      http.setRequestFailure({url:verificationStory,status:403,body});
      await assert.rejects(()=>verifySourceSession(verificationStory,async()=>{}),error=>error.code==='unavailable','a static block is not a browser challenge');
    }
    for(const failure of [
      {status:403,body:'',headers:{'cf-mitigated':'challenge'}},
      {status:503,body:'<title>Just a moment...</title>'},
      {status:200,body:'<title>Just a moment...</title>'},
    ]) {
      http.setRequestFailure({url:verificationStory,...failure});const before=requests.length;
      await assert.rejects(()=>verifySourceSession(verificationStory,async()=>{}),/Verify source/);
      assert.equal(requests.length,before+1,'challenge handling does not loop');
    }
    http.setRequestFailure({url:'https://api.asurascans.com/api/series/repair/chapters/1',status:403,body:'Forbidden'});
    await assert.rejects(()=>downloadChapters({...cached,slug:'repair',url:'https://asurascans.com/comics/repair'},'1',()=>{},async()=>{}),error=>error.code==='unavailable' && /API \(api.asurascans.com\)/.test(error.message));
    http.setRequestFailure({url:'https://cdn/a.webp',status:403,body:'Forbidden'});
    await assert.rejects(()=>downloadChapters({...cached,slug:'repair',url:'https://asurascans.com/comics/repair'},'1',()=>{},async()=>{}),/Request failed \(403\).*image \(cdn\)/);
    http.setRequestFailure(undefined);
    await assert.rejects(()=>verifySourceSession('https://asurascans.com/comics/example',async()=>{}),/Unsupported source verification/);

    const legacyCover=new File(storage.COVERS,'cover-test.webp');legacyCover.write(new Uint8Array([137,80,78,71,13,10,26,10,9,9,9,9]));
    const coverStory={...cached,slug:'cover-test',url:'https://asurascans.com/comics/cover-test',cover:'https://asurascans.com/og/comics/cover-test.jpg',localCover:legacyCover.uri};
    const portrait=await refreshSeries(coverStory,async()=>{});
    assert.equal(portrait.cover,'https://cdn/portrait-1.webp');
    assert.notEqual(portrait.localCover,legacyCover.uri,'old slug-only sharing-card cache is replaced by a source-specific portrait');
    assert.ok(new File(portrait.localCover).exists);
    const firstPortrait=portrait.localCover;await http.changeCover();
    const changedPortrait=await refreshSeries(portrait,async()=>{});
    assert.notEqual(changedPortrait.localCover,firstPortrait,'a changed cover URL cannot reuse the previous image cache');
    assert.equal(new File(changedPortrait.localCover).size,12);
    const partialStory={...cached,slug:'partial',url:'https://asurascans.com/comics/partial',detailsCached:false,chapterIds:undefined};
    await assert.rejects(()=>refreshSeries(partialStory,async()=>{}),/incomplete chapter list/,'partial source responses cannot be saved as complete lists');
    const partialOverview=await refreshSeries(partialStory,async()=>{},undefined,false);
    assert.equal(partialOverview.chapterCount,201,'overview totals use the published count rather than the two visible chapter links');
    assert.equal(partialOverview.chapterIds,undefined,'overview metadata does not certify a partial chapter list');
    const preferencesBeforeAbort=storage.loadPreferences();
    for (const source of ['asura','webtoon','vortex','mangakakalot']) {
      storage.savePreferences({...preferencesBeforeAbort,source});
      const controller=new AbortController(), warnings=[], start=requests.length;
      const pending=syncCatalog(()=>{},()=>new Promise(()=>{}),true,message=>warnings.push(message),controller.signal);
      controller.abort(); let deadline;
      try { await assert.rejects(Promise.race([pending,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error(source+' sync did not cancel promptly')),150);})]),{name:'AbortError'}); }
      finally { clearTimeout(deadline); }
      assert.equal(requests.length,start,'cancelled '+source+' sync cannot continue issuing requests');
      assert.deepEqual(warnings,[],'switching providers is not a source error');
    }
    storage.savePreferences(preferencesBeforeAbort);
    let synced = await syncCatalog(()=>{},async()=>{});
    assert.equal(synced.find(item=>item.slug==='example').summary,fullSummary,'ranked stories fetch and persist full summaries without opening them');
    assert.equal(synced.find(item=>item.slug==='novel--example').summary,'The full novel summary.');
    const detailsBefore = requests.filter(url=>url.includes('/comics/example')).length;
    synced = await syncCatalog(()=>{},async()=>{});
    assert.equal(synced.find(item=>item.slug==='example').summary,fullSummary,'rank previews never overwrite full cached summaries');
    assert.equal(requests.filter(url=>url.includes('/comics/example')).length,detailsBefore,'fresh full details use their six-hour cache');
    await assert.rejects(()=>downloadChapters(synced.find(item=>item.slug==='example'),'99',()=>{},async()=>{}), /No chapters match/);
    assert.equal(storage.loadCatalog().find(item=>item.slug==='example').summary,fullSummary,'download setup saves metadata before chapter work');
    const blockedAbort=new AbortController();
    const waiting=refreshSeries(synced.find(item=>item.slug==='example'),()=>new Promise(()=>{}),blockedAbort.signal);
    blockedAbort.abort(); let timer;
    try { await assert.rejects(()=>Promise.race([waiting,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Guard did not stop promptly')),100);})]),{name:'AbortError'}); }
    finally { clearTimeout(timer); }
    console.log('Offline summary caching check passed');
    let injected=false;
    await syncCatalog(()=>{},async()=>{
      if(injected)return; injected=true;
      storage.mergeCatalog([{...synced.find(item=>item.slug==='example'),summary:'A newer summary.',syncedAt:'2099-01-01T00:00:00Z'}, {...cached,slug:'concurrent-entry',title:'Concurrent entry'}]);
    });
    assert.ok(storage.loadCatalog().some(item=>item.slug==='concurrent-entry'),'a sync cannot drop entries written while it awaits requests');
    assert.equal(storage.loadCatalog().find(item=>item.slug==='example').summary,'A newer summary.','a stale sync cannot overwrite fresher details');
    const options={mode:'comics',sort:'updated',period:'week',query:''};
    const first=await browseCatalog(options,FIRST_PAGE,async()=>{});
    const catalogBeforeBadCursor=JSON.stringify(storage.catalogMetadata());
    await assert.rejects(()=>browseCatalog({...options,source:'webtoon'},first.cursor,async()=>{}),/different provider/);
    await assert.rejects(()=>browseCatalog(options,{source:'asura',state:{comic:-1}},async()=>{}),/Invalid provider cursor/);
    assert.equal(JSON.stringify(storage.catalogMetadata()),catalogBeforeBadCursor,'invalid or cross-provider cursors cannot commit catalog changes');
    const second=await browseCatalog(options,first.cursor,async()=>{});
    assert.equal(first.ids.length,20);assert.equal(second.ids.length,3);assert.equal(second.hasMore,false);
    assert.equal(new Set([...first.ids,...second.ids]).size,23,'offset paging appends distinct results');
    const ranked=await browseCatalog({...options,sort:'trending'},FIRST_PAGE,async()=>{});
    const ranked2=await browseCatalog({...options,sort:'trending'},ranked.cursor,async()=>{});
    assert.equal(new Set([...ranked.ids,...ranked2.ids]).size,40,'rankings ignoring offsets are paged from a cached source ranking');
    assert.equal(requests.filter(url=>url.includes('/trending/week?limit=100')).length,1);
    const novel=storage.loadCatalog().find(item=>item.slug==='novel--example');
    const corrupt=storage.chapterDirectory(novel.slug,'1');corrupt.create();new File(corrupt,'.complete').write(JSON.stringify({kind:'novel'}));new File(corrupt,'text.json').write('{broken');
    await downloadChapters(novel,'1',()=>{},async()=>{});
    assert.equal(storage.chapterIntact(novel.slug,'1'),true,'re-downloading repairs malformed novel JSON');
    const abort=new AbortController();
    const downloading=downloadChapters(storage.loadCatalog().find(item=>item.slug==='example'),'1',()=>{},async()=>{},abort.signal);
    for(let attempt=0;attempt<30 && !http.imagePending;attempt++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(http.imagePending,'the image body is in flight');abort.abort();await assert.rejects(()=>downloading);
    assert.ok(!new File(storage.chapterDirectory('example','1'),'.complete').exists,'cancellation cannot publish an incomplete chapter');
    assert.ok(!new File(storage.chapterDirectory('example','1'),'001.webp').exists,'aborted response bytes are never committed');
    storage.deleteChapters('example',[],true);
    console.log('Catalog merge, pagination, repair and in-flight abort checks passed');
    const webtoonStart=requests.length;
    const quickPage=await browseCatalog({...options,source:'webtoon',language:'en'},FIRST_PAGE,async()=>{},undefined,()=>{},false);
    assert.deepEqual(quickPage.ids,['webtoon-en-42']);
    assert.ok(!requests.slice(webtoonStart).some(url=>url.includes('/list?title_no=')),'interactive discovery returns cards before requesting detailed metadata');
    await enrichCatalogIds(quickPage.ids,async()=>{});
    const webtoonPage=await browseCatalog({...options,source:'webtoon',language:'en'},FIRST_PAGE,async()=>{});
    assert.deepEqual(webtoonPage.ids,['webtoon-en-42']);
    const webtoonItem=storage.loadCatalog().find(item=>item.slug==='webtoon-en-42');
    assert.equal(webtoonItem.title,'Example');
    assert.equal(webtoonItem.summary,'Full WEBTOON summary.','WEBTOON cards get summaries before opening');
    assert.equal(webtoonItem.chapterCount,10,'WEBTOON episode counts appear on the first discovery load');
    assert.ok(webtoonItem.updatedAt && webtoonItem.sourceDates,'WEBTOON update dates appear on the first discovery load');
    assert.equal(webtoonItem.chapterIds,undefined,'WEBTOON discovery does not load the chapter list');
    assert.ok(!requests.slice(webtoonStart).some(url=>url.includes('page=2')),'metadata fetching does not paginate WEBTOON episodes');
    const switchAbort=new AbortController(); let cancelledUpdates=0;
    const switching=browseCatalog({...options,source:'webtoon',language:'en'},FIRST_PAGE,async()=>{},switchAbort.signal,()=>{cancelledUpdates++;if(cancelledUpdates===1)setTimeout(()=>switchAbort.abort(),0);});
    await assert.rejects(switching,{name:'AbortError'});
    assert.equal(cancelledUpdates,1,'metadata batches yield to provider-switch input before more commits');
    storage.mergeCatalog([{...webtoonItem,summary:'',chapterCount:0,metadataSyncedAt:new Date().toISOString()}]);
    await browseCatalog({...options,source:'webtoon',language:'en'},FIRST_PAGE,async()=>{});
    const repairedWebtoon=storage.loadCatalog().find(item=>item.slug===webtoonItem.slug);
    assert.equal(repairedWebtoon.summary,'Full WEBTOON summary.','recent but incomplete metadata retries without a manual refresh');
    assert.equal(repairedWebtoon.chapterCount,10);
    assert.ok(storage.loadCatalog().some(item=>item.slug==='example'),'identical titles from different sources keep separate identities');
    const webtoonFull=await refreshSeries(webtoonItem,async()=>{});
    assert.deepEqual(webtoonFull.chapterIds,['1','9','10'],'initial WEBTOON details follow the real episode pagination');
    assert.equal(webtoonFull.summary,'Full WEBTOON summary.');
    storage.mergeCatalog([webtoonFull]);
    const beforeIncrement=requests.filter(url=>url.includes('title_no=42&page=2')).length;
    http.releaseWebtoon();
    const updated=await refreshSeries(webtoonFull,async()=>{});
    assert.deepEqual(updated.chapterIds,['1','9','10','11']);
    assert.equal(requests.filter(url=>url.includes('title_no=42&page=2')).length,beforeIncrement,'later WEBTOON refreshes stop when cached episodes are reached');
    storage.mergeCatalog([updated]);
    await downloadChapters(updated,'1',()=>{},async()=>{});
    assert.equal(storage.chapterIntact(updated.slug,'1'),true,'WEBTOON original panels finish through the shared download pipeline');
    assert.equal(storage.chapterFiles(updated.slug,'1').length,1);
    const frenchPage=await browseCatalog({...options,source:'webtoon',language:'fr'},FIRST_PAGE,async()=>{});
    assert.deepEqual(frenchPage.ids,['webtoon-fr-42'],'translations never overwrite another language');
    assert.ok(requests.slice(webtoonStart).every(url=>!url.includes('asurascans.com')),'WEBTOON browsing and downloads do not call Asura endpoints');
    storage.savePreferences({...storage.loadPreferences(),source:'webtoon'});
    const beforeSync=requests.length;
    await syncCatalog(()=>{},async()=>{});
    assert.ok(!requests.slice(beforeSync).some(url=>url.includes('/trending/')||url.includes('/novel-series?')),'WEBTOON sync does not fetch unrelated Asura discovery');
    storage.savePreferences({...storage.loadPreferences(),source:'asura'});
    console.log('WEBTOON source routing, full and incremental episodes, downloads, translations and sync checks passed');
    for(const source of ['vortex','mangakakalot']) {
      const before=requests.length;
      const page=await browseCatalog({...options,source,sort:'smart'},FIRST_PAGE,async()=>{});
      assert.equal(page.ids.length,1); assert.equal(page.hasMore,false);
      const item=storage.loadCatalog().find(item=>item.slug===page.ids[0]);
      assert.ok(item.summary&&item.localCover&&item.metadataSyncedAt,'discovery caches summaries and covers before opening');
      assert.equal(item.chapterIds,undefined,'discovery does not preload chapter lists');
      assert.ok(!requests.slice(before).some(url=>url.includes('/api/manga/')||url.includes('/chapter-')),'front-page metadata never calls chapter APIs or chapter pages');
      const cachedCover=new File(item.localCover);cachedCover.write('<!doctype html><title>Just a moment...</title>');
      const metadataRequests=requests.filter(url=>url===item.url).length;
      await browseCatalog({...options,source,sort:'smart'},FIRST_PAGE,async()=>{});
      assert.equal(requests.filter(url=>url===item.url).length,metadataRequests,'metadata is reused across repeated front-page visits');
      assert.equal(cachedCover.open().readBytes(1)[0],137,'invalid HTML cached as a cover is replaced with image bytes');
      const fresh=await refreshSeries(item,async()=>{});
      assert.ok(fresh.detailsCached&&fresh.summary);
      assert.ok(fresh.chapterIds.includes('1'));
      if(source==='vortex') assert.ok(requests.slice(before).some(url=>url.startsWith('https://api.vortexscans.org/api/chapters?')),'Vortex chapters use its public API when inline hydration is unrecognized');
      if(source==='vortex') {
        for(const mode of ['error','unrecognized']) {
          http.setVortexPageMode(mode);
          const recoveryStart=requests.length;
          const recovered=await refreshSeries({...item,slug:'vortex-url-legacy',vortexId:undefined},async()=>{});
          assert.deepEqual(recovered.chapterIds,['1','2'],'public chapters load even when the summary page fails: '+mode);
          assert.equal(recovered.chapterListComplete,true);
          assert.ok(requests.slice(recoveryStart).some(url=>url.includes('/api/chapters?postId=42')),'legacy entries resolve the numeric ID through the public post API');
          assert.ok(!requests.slice(recoveryStart).some(url=>new URL(url).hostname==='vortexscans.org'),'chapter loading no longer depends on inline HTML scripts');
        }
        http.setVortexPageMode('normal');
      }

      if(source==='mangakakalot') {
        assert.deepEqual(fresh.chapterIds,['0','1','2'],'all MangaKakalot chapter pages load, including chapter zero');
        assert.equal(fresh.chapterCount,3); assert.equal(fresh.chapterListComplete,true);
        assert.ok(requests.slice(before).some(url=>url.includes('limit=500&offset=2')),'the next offset follows the actual received page length');
        const metadataStart=requests.length;
        const overview=await refreshSeries(fresh,async()=>{},undefined,false);
        assert.deepEqual(overview.chapterIds,['0','1','2']); assert.equal(overview.chapterListComplete,true);
        assert.ok(!requests.slice(metadataStart).some(url=>url.includes('/api/manga/')),'tag metadata updates reuse complete chapter lists');
        http.failKakalotPage(true);
        await assert.rejects(()=>refreshSeries(item,async()=>{}),/Request failed/,'failure on a later page cannot certify a partial list');
        http.failKakalotPage(false);
      }
      await downloadChapters(fresh,'1',()=>{},async()=>{});
      assert.equal(storage.chapterIntact(item.slug,'1'),true);
      assert.ok(!requests.slice(before).some(url=>url.includes('asurascans.com')||url.includes('webtoons.com')));
      storage.setChaptersRead(item.slug,['1'],true);storage.deleteChapters(item.slug,['1']);
      assert.ok(storage.readChapters()[item.slug]['1'],'new source deletion preserves read history');
      storage.savePreferences({...storage.loadPreferences(),source});
      await syncCatalog(()=>{},async()=>{});
    }
    storage.savePreferences({...storage.loadPreferences(),source:'asura'});
    console.log('Vortex and MangaKakalot source routing, offline downloads, read history, deletion and sync checks passed');
    if(process.env.LIVE_VORTEX==='1') {
      http.setVortexLive(true);
      try {
        const live=await refreshSeries({...storage.SEED[0],url:'https://vortexscans.org/series/regressing-as-the-reincarnated-bastard',slug:'vortex-url-live-legacy',vortexId:undefined,cover:''},async()=>{});
        assert.equal(live.vortexId,'274');assert.ok(live.chapterIds.includes('1'));assert.ok(live.chapterIds.length>=117);
        assert.equal(live.chapterListComplete,true);assert.ok(live.summary&&live.rating&&live.localCover);
        console.log('Live Vortex legacy-ID recovery: '+live.chapterIds.length+' chapters, rating '+live.rating);
      } finally { http.setVortexLive(false); }
    }

    await assert.rejects(()=>verifySourceSession('https://vortexscans.org/',async()=>{}),/Unsupported source verification/);
    const verificationUrl='https://www.mangakakalot.gg/manga/example';
    await verifySourceSession(verificationUrl,async()=>{});
    for(const mode of ['blocked','challenge']) {
      http.setVerificationMode(mode);const before=requests.length;
      await assert.rejects(()=>verifySourceSession(verificationUrl,async()=>{}),mode==='blocked'?/Request failed \(403\)/:/Verify source/);
      assert.equal(requests.length,before+1,'failed session verification makes one attempt instead of retrying forever');
    }
    http.setVerificationMode('open');await verifySourceSession(verificationUrl,async()=>{});
    console.log('Source verification success, challenge rejection and retry recovery checks passed');
    const syncPreferences=storage.loadPreferences(), syncCatalogBefore=storage.loadCatalog(), bookmarkBefore=storage.savedStories().example?.bookmarked;
    storage.savePreferences({...syncPreferences,source:'mangakakalot'});
    storage.mergeCatalog([{...storage.SEED[0],slug:'example',url:'https://asurascans.com/comics/example'}]);
    tools.updateStoryOptions('example',{bookmarked:true});
    http.setVerificationMode('blocked'); const failedSourceStart=requests.length, syncWarnings=[];
    const partiallySynced=await syncCatalog(()=>{},async()=>{},true,message=>syncWarnings.push(message));
    assert.ok(partiallySynced.some(item=>item.slug==='example'&&item.detailsCached));
    assert.ok(requests.slice(failedSourceStart).some(url=>new URL(url).hostname==='api.asurascans.com'),'one refused directory cannot block healthy bookmarks on another source');
    assert.ok(syncWarnings.some(message=>/Request failed \(403\)/.test(message)),'partial success still reports the failed source');
    storage.saveCatalog([]);
    await assert.rejects(()=>syncCatalog(()=>{},async()=>{},true),/Request failed \(403\)/,'when nothing can refresh, preserve the actual refusal');
    http.setVerificationMode('open');storage.savePreferences(syncPreferences);storage.saveCatalog(syncCatalogBefore);tools.updateStoryOptions('example',{bookmarked:bookmarkBefore});
    console.log('Cross-source partial sync and actionable verification error regression checks passed');
    const repairStory={...storage.SEED[0],slug:'repair',url:'https://asurascans.com/comics/repair',cover:''};
    await downloadChapters(repairStory,'1',()=>{},async()=>{});
    new File(storage.chapterDirectory('repair','1'),'001.webp').write('damaged');
    const beforeRepair=requests.length;
    await downloadChapters(repairStory,'1',()=>{},async()=>{});
    assert.deepEqual(requests.slice(beforeRepair).filter(url=>['https://cdn/a.webp','https://cdn/b.webp'].includes(url)),['https://cdn/a.webp'],'repair only downloads the damaged panel and keeps valid originals');
    const repairFile=new File(storage.chapterDirectory('repair','1'),'001.webp');repairFile.delete();
    assert.equal(storage.chapterFiles('repair','1').length,1);
    assert.equal(storage.chapterFiles('repair','1',true).length,2,'reader keeps a placeholder for each manifest panel');
    const untouched=new File(storage.chapterDirectory('repair','1'),'002.webp').md5;
    const beforePanelRepair=requests.length;
    await repairSavedPanel(repairStory,'1',0,async()=>{});
    assert.deepEqual(requests.slice(beforePanelRepair).filter(url=>['https://cdn/a.webp','https://cdn/b.webp'].includes(url)),['https://cdn/a.webp'],'panel repair transfers only the requested public panel');
    assert.equal(new File(storage.chapterDirectory('repair','1'),'002.webp').md5,untouched,'other panels are untouched');
    assert.equal(storage.chapterIntact('repair','1'),true);
    await assert.rejects(()=>repairSavedPanel(repairStory,'2',0,async()=>{}),/no longer publicly available/);
    const repairAbort=new AbortController();repairAbort.abort();const stableHash=repairFile.md5;
    await assert.rejects(()=>repairSavedPanel(repairStory,'1',0,async()=>{},repairAbort.signal),{name:'AbortError'});
    assert.equal(repairFile.md5,stableHash,'cancelled repairs preserve the saved file');
    const native=await import('nightshelf-native-test');native.enable();
    const preparation=[];
    await downloadChapters(repairStory,'1',(message)=>preparation.push(message),async()=>{});
    assert.ok(preparation.includes('Preparing chapters \u00b7 0/1 prepared'));
    assert.ok(preparation.includes('Preparing chapters \u00b7 1/1 prepared'));
    assert.equal(native.plans.length,1);assert.equal(native.plans[0].chapters[0].files.length,2);
    assert.ok(native.plans[0].chapters[0].files.every(file=>file.target.startsWith(storage.LIBRARY.uri+'/')));
    assert.ok(native.plans[0].chapters[0].files.every(file=>file.hash),'native repair plans carry existing checksums');
    assert.equal(native.plans[0].allowMetered,false,'a Wi-Fi download does not silently authorize future metered transfers');
    new File(storage.chapterDirectory('repair','1'),'001.webp').write('damaged');
    const nativePlanCount=native.plans.length;
    await downloadChapters(repairStory,'1',()=>{},async()=>{},undefined,['1'],undefined,undefined,false,false,false);
    assert.equal(native.plans.length,nativePlanCount,'reader downloads do not replace an existing Android series plan');
    assert.equal(storage.chapterIntact('repair','1'),true,'reader fallback saves complete verified original panels');
    const kakalotStory=storage.loadCatalog().find(item=>item.slug==='mangakakalot-example');
    await downloadChapters(kakalotStory,'1',()=>{},async()=>{});
    assert.equal(native.plans.at(-1).chapters[0].files[0].referer,'https://www.mangakakalot.gg/','Android transfer plans use the same working image referrer as covers');
    console.log('Selective damaged-panel repair and native transfer-plan checks passed');

  } finally { scraperHook.deregister(); storage.toggleSaved('example','bookmarked'); }
  const mocks = {
    "expo-notifications": `export const AndroidImportance={DEFAULT:3}; export const sent=[]; export let granted=true; export function deny(){granted=false;} export function allow(){granted=true;} export let failing=""; export function failFor(value){failing=value;} export let beforePresented=()=>{}; export function setBeforePresented(value){beforePresented=value;} export function setNotificationHandler(){}; export async function setNotificationChannelAsync(){}; export async function getPermissionsAsync(){return {granted};} export const requestPermissionsAsync=getPermissionsAsync; export async function getPresentedNotificationsAsync(){await beforePresented();return [...new Map(sent.map(value=>[value.identifier,{request:value}])).values()];} export async function scheduleNotificationAsync(value){if(value.identifier===failing)throw Error("Notification delivery failed");sent.push(value);}`,
    "expo-background-task": `export const BackgroundTaskResult={Success:1,Failed:2}; export const registrations=[];export let removals=0;export async function registerTaskAsync(name,options){registrations.push(options);} export async function unregisterTaskAsync(){removals++;}`,
    "expo-task-manager": `export let task; export function defineTask(name,callback){task=callback;} let options=null;export function registration(value){options=value;}export async function getTaskOptionsAsync(){return options;}export async function isTaskRegisteredAsync(){return options!==null;}`,
    "@react-native-community/netinfo": `export let network={type:'cellular',isConnected:true}; export function setNetwork(value){network=value;} export default {fetch:async()=>network};`,
    "react-native": `export const AppState={currentState:'background'}; export const Alert={alert:(title,text,buttons)=>buttons.find(button=>button.text==='No').onPress()};`,
    "./background-downloads": `export let backgroundTransfers=null;export function enable(){backgroundTransfers={};}export function transferStates(){return {};}`,
    "./scraper": `export const downloaded=[];export async function downloadChapters(...args){downloaded.push(args);} export const attempted=[]; export async function refreshSeries(item){attempted.push(item.slug);if(item.slug==='bad')throw Error('404');return {...item,chapterIds:['1','2'],chapterCount:2,detailsCached:true};}`,
  };
  const nativeHook = registerHooks({ resolve(specifier, context, next) {
    if (mocks[specifier] && (specifier !== "./scraper" || context.parentURL?.endsWith("/releases.ts"))) return {url:`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,shortCircuit:true};
    return next(specifier,context);
  } });
  try {
    const { notifyReleases, configureReleaseChecks } = await import('../src/lib/releases.ts');
    const notifications = await import('expo-notifications');
    const tasks = await import('expo-task-manager');
    storage.savePreferences({...storage.loadPreferences(),releaseNotifications:true});
    tools.updateStoryOptions('example',{bookmarked:true,notifyReleases:true});
    const story = {...storage.SEED[0],slug:'example',chapterIds:['1','2'],detailsCached:true,chapterCount:2};
    await notifyReleases([story]);
    assert.equal(notifications.sent.length,0,'first check establishes a baseline');
    story.chapterIds.push('3','4','4.5');
    await notifyReleases([story]);
    assert.deepEqual(storage.releaseUpdates().example,['3','4','4.5'],'library updates persist separately from Android notifications');
    assert.equal(notifications.sent.length,1,'three releases produce exactly one notification');
    assert.match(notifications.sent[0].content.body,/3 new chapters/);
    await notifyReleases([story]);
    assert.equal(notifications.sent.length,1,'repeated checks never duplicate releases');
    story.chapterIds.push('5'); await notifyReleases([story]);
    assert.equal(notifications.sent[1].identifier,notifications.sent[0].identifier,'new alerts replace the series notification');
    assert.match(notifications.sent[1].content.body,/4 new chapters/,'unopened releases accumulate into one alert');
    await notifyReleases([{...story,chapterIds:['1','2']}]);
    await notifyReleases([story]);
    assert.equal(notifications.sent.length,2,'source omissions must not re-notify known chapters');
    const parallelStory={...story,slug:'parallel-release',chapterIds:['1'],chapterCount:1};
    tools.updateStoryOptions(parallelStory.slug,{bookmarked:true,notifyReleases:true});
    await notifyReleases([parallelStory]);
    const sentBeforeParallel=notifications.sent.length;
    parallelStory.chapterIds.push('2');
    await Promise.all([notifyReleases([parallelStory]),notifyReleases([parallelStory])]);
    assert.equal(notifications.sent.length,sentBeforeParallel+1,'overlapping sync/detail checks produce one release notification');
    storage.markChapterRead(parallelStory.slug,'2');parallelStory.chapterIds.push('3');
    await notifyReleases([parallelStory]);
    assert.deepEqual(notifications.sent.at(-1).content.data.chapters,['3'],'replacement notifications drop chapters already read');
    notifications.sent.splice(sentBeforeParallel);
    storage.toggleSaved('example','bookmarked'); story.chapterIds.push('6'); await notifyReleases([story]);
    assert.equal(notifications.sent.length,2,'unbookmarked stories do not notify');

    const muted={...story,slug:'muted',chapterIds:['1'],chapterCount:1};
    tools.updateStoryOptions('muted',{bookmarked:true,notifyReleases:false});
    await notifyReleases([muted]);muted.chapterIds.push('2');muted.chapterCount=2;await notifyReleases([muted]);
    assert.equal(notifications.sent.length,2,'per-story notification opt-out is respected');
    assert.deepEqual(storage.releaseUpdates().muted,['2'],'muted stories still populate the in-app feed');
    storage.toggleSaved('example','bookmarked'); notifications.deny(); await notifyReleases([story]);
    assert.equal(notifications.sent.length,2,'Android permission is respected');
    assert.ok(storage.releaseUpdates().example.includes('6'),'library badges still update when Android notifications are denied');
    storage.markChapterRead('example','6');
    assert.ok(storage.readChapters().example['6']);
    storage.clearReleaseUpdates('example');
    assert.equal(storage.releaseUpdates().example,undefined,'removing a bookmark can clear old update badges');
    storage.saveCatalog([story]);
    assert.equal(await tasks.task(),2,'background cellular requests are prevented');
    console.log('Grouped release notification check passed');
    const scheduler=await import('expo-background-task');
    await configureReleaseChecks();assert.equal(scheduler.registrations.at(-1).minimumInterval,120,'background checks default to two hours');
    tasks.registration({minimumInterval:15});
    storage.savePreferences({...storage.loadPreferences(),releaseCheckInterval:60});
    await configureReleaseChecks();assert.equal(scheduler.registrations.at(-1).minimumInterval,60,'changing interval replaces the existing 15-minute registration');
    assert.equal(scheduler.removals,1);
    tasks.registration({minimumInterval:60});
    const registrations=scheduler.registrations.length;await configureReleaseChecks();assert.equal(scheduler.registrations.length,registrations,'unchanged schedules are not reset');

    const net = await import('@react-native-community/netinfo');
    const {AppState,Alert} = await import('react-native'); AppState.currentState='active';
    storage.saveCatalog([{...story,slug:'bad'},{...story,slug:'good'}]);storage.toggleSaved('bad','bookmarked');storage.toggleSaved('good','bookmarked');
    net.setNetwork({type:'wifi',isConnected:true});AppState.currentState='background';
    assert.equal(await tasks.task(),1);
    const refresher=await import(`data:text/javascript,${encodeURIComponent(mocks['./scraper'])}`);
    assert.deepEqual(refresher.attempted,['bad','good'],'one broken bookmark never blocks later healthy stories');
    const nativeTransfers=await import(`data:text/javascript,${encodeURIComponent(mocks['./background-downloads'])}`);
    nativeTransfers.enable();
    storage.saveCatalog([{...story,slug:'good',chapterIds:['1'],chapterCount:1}]);
    tools.updateStoryOptions('good',{bookmarked:true,autoDownload:true});
    storage.savePreferences({...storage.loadPreferences(),releaseNotifications:false});
    storage.saveReleaseSnapshot('good',['1']);storage.clearReleaseUpdates('good');
    storage.saveCatalog([{...story,slug:'good',chapterIds:['1'],chapterCount:1}]);
    await tasks.task();
    assert.equal(refresher.downloaded.length,1,'bookmarked auto-downloads work even with release notifications disabled');
    assert.equal(refresher.downloaded[0][1],'2','only new unread releases are queued automatically');
    assert.equal(refresher.downloaded[0][8],true);assert.equal(refresher.downloaded[0][9],true,'background metadata work hands off to Android instead of awaiting every image');
    net.setNetwork({type:'cellular',isConnected:true});await tasks.task();
    assert.equal(refresher.downloaded.length,1,'automatic releases never use cellular');
    net.setNetwork({type:'wifi',isConnected:true});
    storage.savePreferences({...storage.loadPreferences(),autoDownloadLimitMB:0});
    await tasks.task();assert.equal(refresher.downloaded.length,1,'automatic transfers respect the storage budget');
    storage.savePreferences({...storage.loadPreferences(),autoDownloadLimitMB:2048});
    storage.setChaptersRead('good',['2'],true);await tasks.task();
    assert.equal(refresher.downloaded.length,1,'already-read new releases are not automatically downloaded');
    storage.setChaptersRead('good',['2'],false);
    storage.saveDownloads([{series:{...story,slug:'good'},selection:'2',status:'paused',message:'Paused',progress:0}]);
    await tasks.task();assert.equal(refresher.downloaded.length,1,'background release checks never replace a paused user job');
    storage.saveDownloads([]);
    tools.updateStoryOptions('good',{autoDownload:false});
    storage.savePreferences({...storage.loadPreferences(),releaseNotifications:true});

    storage.saveCatalog([{...story,slug:'first-baseline',chapterIds:undefined,detailsCached:false}]);
    tools.updateStoryOptions('first-baseline',{autoDownload:true});
    assert.equal(storage.savedStories()['first-baseline'].autoDownloadBaseline,undefined);
    await tasks.task();
    assert.equal(refresher.downloaded.length,1,'the first full pull cannot enqueue the existing chapter backlog');
    assert.deepEqual(storage.savedStories()['first-baseline'].autoDownloadBaseline,['1','2']);
    console.log('Automatic bookmarked Wi-Fi release handoff check passed');
    notifications.allow();storage.savePreferences({...storage.loadPreferences(),releaseNotifications:true});
    const alertBad={...story,slug:'alert-fail',chapterIds:['1','2'],chapterCount:2}, alertGood={...alertBad,slug:'alert-good'};
    for(const item of [alertBad,alertGood]){tools.updateStoryOptions(item.slug,{bookmarked:true,notifyReleases:true});storage.saveReleaseSnapshot(item.slug,['1']);}
    notifications.failFor('release-alert-fail');
    await assert.rejects(()=>notifyReleases([alertBad,alertGood]),/Notification delivery failed/);
    assert.equal(notifications.sent.at(-1).identifier,'release-alert-good','one failed notification does not block other bookmarked releases');
    assert.deepEqual(storage.releaseSnapshots()['alert-fail'],['1'],'failed delivery keeps its snapshot available for retry');
    notifications.failFor('');await notifyReleases([alertBad]);
    assert.equal(notifications.sent.at(-1).identifier,'release-alert-fail');
    const alertOff={...alertBad,slug:'alert-off'};tools.updateStoryOptions(alertOff.slug,{bookmarked:true,notifyReleases:true});storage.saveReleaseSnapshot(alertOff.slug,['1']);
    const beforeDisabledAlert=notifications.sent.length;
    notifications.setBeforePresented(()=>{tools.updateStoryOptions(alertOff.slug,{notifyReleases:false});notifications.setBeforePresented(()=>{});});
    await notifyReleases([alertOff]);
    assert.equal(notifications.sent.length,beforeDisabledAlert,'disabling a bell during alert preparation prevents a stale notification');

    AppState.currentState='active';
    net.setNetwork({type:'cellular',isConnected:true});
    const {networkGuard} = await import('../src/lib/network.ts');
    storage.savePreferences({...storage.loadPreferences(),mobileData:'never'});
    const guard = networkGuard('Test connection');
    await assert.rejects(()=>guard(), /Wi-Fi/);
    net.setNetwork({type:'wifi',isConnected:true,details:{isConnectionExpensive:false}});
    await guard();
    net.setNetwork({type:'cellular',isConnected:true});
    storage.savePreferences({...storage.loadPreferences(),mobileData:'allow'});
    await guard();
    net.setNetwork({type:'cellular',isConnected:false});
    await assert.rejects(()=>guard(), /offline/);
    net.setNetwork({type:'cellular',isConnected:true});
    storage.savePreferences({...storage.loadPreferences(),mobileData:'ask'});
    Alert.alert=(title,text,buttons)=>{net.setNetwork({type:'wifi',isConnected:true});buttons.find(button=>button.text==='No').onPress();};
    await networkGuard('Connection changed during the dialog')();

    net.setNetwork({type:'cellular',isConnected:true});
    let explicitPrompts=0;
    Alert.alert=(title,text,buttons)=>{explicitPrompts++;buttons.find(button=>button.text==='Yes').onPress();};
    const chapterAccess=networkGuard('Download chapter 1 on mobile data?');
    await chapterAccess();await chapterAccess();
    assert.equal(explicitPrompts,1,'one accepted download does not ask again for every panel');
    await networkGuard('Download chapter 2 on mobile data?')();
    assert.equal(explicitPrompts,2,'another explicit chapter request is not silently blocked by a cooldown');
    Alert.alert=(title,text,buttons)=>{explicitPrompts++;buttons.find(button=>button.text==='No').onPress();};
    await assert.rejects(()=>networkGuard('Decline mobile data')(),/Wi-Fi/);
    Alert.alert=(title,text,buttons)=>{explicitPrompts++;buttons.find(button=>button.text==='Yes').onPress();};
    await networkGuard('Retry immediately after declining')();
    assert.equal(explicitPrompts,4,'an intentional retry can ask for mobile data immediately after No');

    let automaticPrompts=0;Alert.alert=()=>{automaticPrompts++;};
    net.setNetwork({type:'cellular',isConnected:true});
    storage.savePreferences({...storage.loadPreferences(),mobileData:'ask'});
    await assert.rejects(()=>networkGuard('Automatic refresh',true)(),/Wi-Fi|approval|data/i);
    assert.equal(automaticPrompts,0,'automatic requests pause quietly rather than repeatedly opening a data-consent dialog');
    console.log('Live connection guard recovery check passed');
  } finally { nativeHook.deregister(); }
} finally {
  hook.deregister();
  assert.equal(dirname(resolve(testRoot)), resolve(tmpdir()));
  assert.ok(basename(testRoot).startsWith("nightshelf-check-"));
  rmSync(testRoot, { recursive: true, force: true });
}
