import assert from "node:assert/strict";
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
  for (const chapter of ["1", "2"]) {
    const folder = storage.chapterDirectory("example", chapter);
    folder.create();
    new File(folder, ".complete").write("complete");
    new File(folder, "001.webp").write("image bytes");
  }
  const partial = storage.chapterDirectory("example", "3"); partial.create();
  new File(partial, "001.webp.part").write("partial bytes");
  const outside = new File(testRoot, "keep.txt"); outside.write("keep");
  const cover = new File(storage.COVERS, "example.webp"); cover.write("cover");
  storage.toggleSaved("example", "bookmarked"); storage.toggleSaved("example", "liked");
  storage.savePosition("example", "2", 0.5);
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
  storage.saveCatalog([cached]);
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
  assert.ok(!storage.readingHistory().example);
  assert.deepEqual(storage.savedStories().example, { bookmarked: true, liked: true });
  assert.equal(storage.readChapters().example["1"], completedAt, "deleting saved files preserves chapter read history");
  assert.ok(outside.exists && cover.exists, "deletion stays inside the story's download folder");
  console.log("Storage deletion check passed");
  const tools = await import('../src/lib/library-tools.ts');
  const backup = await import('../src/lib/backup.ts');
  const backupStory={...storage.SEED[0],slug:'backup-story',title:'Backup story',localChapters:['1'],genres:['Action']};
  storage.saveCatalog([backupStory]);tools.updateStoryOptions('backup-story',{bookmarked:true,liked:true,list:'planned',autoDownload:true});
  storage.savePosition('backup-story','1',0.4);storage.setChaptersRead('backup-story',['1'],true);
  storage.savePreferences({...storage.loadPreferences(),genreFilters:{asura:['Action'],vortex:['Fantasy']}});
  const exported=backup.createBackup(), decoded=backup.validateBackup(exported);
  assert.equal(decoded.saved['backup-story'].list,'planned');
  assert.equal(decoded.saved['backup-story'].autoDownload,undefined,'portable backups cannot silently enable new automatic transfers');
  assert.equal(decoded.catalog[0].localChapters,undefined,'phone-specific chapter paths are not portable');
  assert.deepEqual(decoded.catalog[0].genres,['Action']);
  assert.deepEqual(decoded.preferences.genreFilters,{asura:['Action'],vortex:['Fantasy']},'tag filters survive backup and restore');
  const roundTrip=JSON.parse(exported);roundTrip.history['backup-story'].readAt='2020-01-01T00:00:00Z';roundTrip.history['backup-story'].fraction=0.1;
  backup.restoreBackup(JSON.stringify(roundTrip));
  assert.equal(storage.readingHistory()['backup-story'].fraction,0.4,'newer local position survives import');
  assert.equal(storage.savedStories()['backup-story'].list,'planned');
  storage.savePreferences({...storage.loadPreferences(),genreFilters:{}});
  assert.ok(storage.readChapters()['backup-story']['1']);
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
  const fullSummary = "The complete summary saved from the story page, including its ending.";
  const comicHtml = `<meta property="og:title" content="Example"><meta property="og:image" content="https://cdn/example.webp"><div id="description-text"><p>${fullSummary}</p></div><a href="/comics/example/chapter/1">1</a><a href="/comics/example/chapter/2">2</a>`;
  const comicRaw = {slug:'example',title:'Example',description:'Short ranking preview',cover:'https://cdn/example.webp',chapter_count:2};
  const novelRaw = {slug:'example',title:'Example novel',description:'Short ranking preview',chapter_count:2};
  const fakeFetch = `
export const requests=[]; export let imagePending=false;
export let verificationMode='open';export function setVerificationMode(mode){verificationMode=mode;}
export let vortexPageMode='normal';export function setVortexPageMode(value){vortexPageMode=value;}
export let webtoonNew=false; export function releaseWebtoon(){webtoonNew=true;}
export let kakalotPageFailure=false; export function failKakalotPage(value){kakalotPageFailure=value;}
export async function fetch(url,options={}){
  requests.push(url); options.signal?.throwIfAborted();
  if(new URL(url).hostname==='www.mangakakalot.gg' && options.headers['User-Agent']!=='native-test-agent') throw Error('Source requests must use the verification browser identity');
  if(['www.webtoons.com','vortexscans.org'].includes(new URL(url).hostname) && options.headers['User-Agent']!=='test') throw Error('WEBTOON must retain its separate desktop layout agent');
  const params=new URL(url).searchParams, offset=Number(params.get('offset')||0);
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
    if(verificationMode==='blocked')return {ok:false,status:403};
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
  if(url==='https://asurascans.com/comics/repair')return {ok:true,text:async()=>'<meta property="og:title" content="Repair"><meta property="og:image" content="https://cdn/repair.webp"><div>9.7 Rating 1 Chapters</div><a href="/comics/repair/chapter/1">Chapter 1</a>'};
  if(url==='https://asurascans.com/comics/partial')return {ok:true,text:async()=>'<meta property="og:title" content="Partial"><meta property="og:image" content="https://cdn/cover.webp"><div>201 Chapters</div><a href="/comics/partial/chapter/199">199</a><a href="/comics/partial/chapter/200">200</a>'};
  if(url==='https://asurascans.com/comics/repair/chapter/1')return {ok:true,text:async()=>'<img data-page-index="0" src="https://cdn/a.webp"><img data-page-index="1" src="https://cdn/b.webp">'};
  if(['https://cdn/a.webp','https://cdn/b.webp'].includes(url))return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>new Uint8Array([1,2,3,4])};
  if(url==='https://cdn/image.webp')return {ok:true,headers:{get:()=> 'image/webp'},bytes:async()=>{imagePending=true;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}};
  const data = url.includes('/comics/example/chapter/') ? '<img data-page-index="0" src="https://cdn/image.webp">'
    : url.includes('/comics/example') ? ${JSON.stringify(comicHtml)}
    : url.includes('/trending/') ? {data:params.get('limit')==='100'?ranking:[${JSON.stringify(comicRaw)}]}
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
    const {syncCatalog,downloadChapters,browseCatalog,FIRST_PAGE,refreshSeries,verifySourceSession} = await import('../src/lib/scraper.ts');
    const http = await import('expo/fetch'); const {requests} = http;
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
          const recovered=await refreshSeries({...item,slug:'vortex-url-legacy',vortexId:'42'},async()=>{});
          assert.deepEqual(recovered.chapterIds,['1','2'],'public chapters load even when the summary page fails: '+mode);
          assert.equal(recovered.chapterListComplete,true);
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
    await assert.rejects(()=>verifySourceSession('https://vortexscans.org/',async()=>{}),/Unsupported source verification/);
    const verificationUrl='https://www.mangakakalot.gg/manga/example';
    await verifySourceSession(verificationUrl,async()=>{});
    for(const mode of ['blocked','challenge']) {
      http.setVerificationMode(mode);const before=requests.length;
      await assert.rejects(()=>verifySourceSession(verificationUrl,async()=>{}),/Verify source/);
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
    assert.ok(requests.slice(failedSourceStart).some(url=>new URL(url).hostname==='asurascans.com'),'one challenged directory cannot block healthy bookmarks on another source');
    assert.ok(syncWarnings.some(message=>/Verify source/.test(message)),'partial success still reports the failed source');
    storage.saveCatalog([]);
    await assert.rejects(()=>syncCatalog(()=>{},async()=>{},true),/Verify source/,'when nothing can refresh, preserve the actionable verification error');
    http.setVerificationMode('open');storage.savePreferences(syncPreferences);storage.saveCatalog(syncCatalogBefore);tools.updateStoryOptions('example',{bookmarked:bookmarkBefore});
    console.log('Cross-source partial sync and actionable verification error regression checks passed');
    const repairStory={...storage.SEED[0],slug:'repair',url:'https://asurascans.com/comics/repair',cover:''};
    await downloadChapters(repairStory,'1',()=>{},async()=>{});
    new File(storage.chapterDirectory('repair','1'),'001.webp').write('damaged');
    const beforeRepair=requests.length;
    await downloadChapters(repairStory,'1',()=>{},async()=>{});
    assert.deepEqual(requests.slice(beforeRepair).filter(url=>url.startsWith('https://cdn/')),['https://cdn/a.webp'],'repair only downloads the damaged panel and keeps valid originals');
    const native=await import('nightshelf-native-test');native.enable();
    const preparation=[];
    await downloadChapters(repairStory,'1',(message)=>preparation.push(message),async()=>{});
    assert.ok(preparation.includes('Preparing chapters \u00b7 0/1 prepared'));
    assert.ok(preparation.includes('Preparing chapters \u00b7 1/1 prepared'));
    assert.equal(native.plans.length,1);assert.equal(native.plans[0].chapters[0].files.length,2);
    assert.ok(native.plans[0].chapters[0].files.every(file=>file.target.startsWith(storage.LIBRARY.uri+'/')));
    assert.ok(native.plans[0].chapters[0].files.every(file=>file.hash),'native repair plans carry existing checksums');
    assert.equal(native.plans[0].allowMetered,false,'a Wi-Fi download does not silently authorize future metered transfers');
    const kakalotStory=storage.loadCatalog().find(item=>item.slug==='mangakakalot-example');
    await downloadChapters(kakalotStory,'1',()=>{},async()=>{});
    assert.equal(native.plans.at(-1).chapters[0].files[0].referer,'https://www.mangakakalot.gg/','Android transfer plans use the same working image referrer as covers');
    console.log('Selective damaged-panel repair and native transfer-plan checks passed');

  } finally { scraperHook.deregister(); storage.toggleSaved('example','bookmarked'); }
  const mocks = {
    "expo-notifications": `export const AndroidImportance={DEFAULT:3}; export const sent=[]; export let granted=true; export function deny(){granted=false;} export function setNotificationHandler(){}; export async function setNotificationChannelAsync(){}; export async function getPermissionsAsync(){return {granted};} export const requestPermissionsAsync=getPermissionsAsync; export async function getPresentedNotificationsAsync(){return [...new Map(sent.map(value=>[value.identifier,{request:value}])).values()];} export async function scheduleNotificationAsync(value){sent.push(value);}`,
    "expo-background-task": `export const BackgroundTaskResult={Success:1,Failed:2}; export async function registerTaskAsync(){} export async function unregisterTaskAsync(){}`,
    "expo-task-manager": `export let task; export function defineTask(name,callback){task=callback;} export async function isTaskRegisteredAsync(){return false;}`,
    "@react-native-community/netinfo": `export let network={type:'cellular',isConnected:true}; export function setNetwork(value){network=value;} export default {fetch:async()=>network};`,
    "react-native": `export const AppState={currentState:'background'}; export const Alert={alert:(title,text,buttons)=>buttons.find(button=>button.text==='No').onPress()};`,
    "./background-downloads": `export let backgroundTransfers=null;export function enable(){backgroundTransfers={};}export function transferStates(){return {};}`,
    "./scraper": `export const downloaded=[];export async function downloadChapters(...args){downloaded.push(args);} export const attempted=[]; export async function refreshSeries(item){attempted.push(item.slug);if(item.slug==='bad')throw Error('404');return {...item,chapterIds:['1','2']};}`,
  };
  const nativeHook = registerHooks({ resolve(specifier, context, next) {
    if (mocks[specifier] && (specifier !== "./scraper" || context.parentURL?.endsWith("/releases.ts"))) return {url:`data:text/javascript,${encodeURIComponent(mocks[specifier])}`,shortCircuit:true};
    return next(specifier,context);
  } });
  try {
    const { notifyReleases } = await import('../src/lib/releases.ts');
    const notifications = await import('expo-notifications');
    const tasks = await import('expo-task-manager');
    storage.savePreferences({...storage.loadPreferences(),releaseNotifications:true});
    const story = {...storage.SEED[0],slug:'example',chapterIds:['1','2']};
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
    storage.toggleSaved('example','bookmarked'); story.chapterIds.push('6'); await notifyReleases([story]);
    assert.equal(notifications.sent.length,2,'unbookmarked stories do not notify');
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
    const net = await import('@react-native-community/netinfo');
    const {AppState,Alert} = await import('react-native'); AppState.currentState='active';
    storage.saveCatalog([{...story,slug:'bad'},{...story,slug:'good'}]);storage.toggleSaved('bad','bookmarked');storage.toggleSaved('good','bookmarked');
    net.setNetwork({type:'wifi',isConnected:true});AppState.currentState='background';
    assert.equal(await tasks.task(),1);
    const refresher=await import(`data:text/javascript,${encodeURIComponent(mocks['./scraper'])}`);
    assert.deepEqual(refresher.attempted,['bad','good'],'one broken bookmark never blocks later healthy stories');
    const nativeTransfers=await import(`data:text/javascript,${encodeURIComponent(mocks['./background-downloads'])}`);
    nativeTransfers.enable();tools.updateStoryOptions('good',{bookmarked:true,autoDownload:true});
    storage.savePreferences({...storage.loadPreferences(),releaseNotifications:false});
    storage.saveReleaseSnapshot('good',['1']);storage.clearReleaseUpdates('good');
    storage.saveCatalog([{...story,slug:'good',chapterIds:['1']}]);
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
    console.log('Automatic bookmarked Wi-Fi release handoff check passed');
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
    console.log('Live connection guard recovery check passed');
  } finally { nativeHook.deregister(); }
} finally {
  hook.deregister();
  assert.equal(dirname(resolve(testRoot)), resolve(tmpdir()));
  assert.ok(basename(testRoot).startsWith("nightshelf-check-"));
  rmSync(testRoot, { recursive: true, force: true });
}
