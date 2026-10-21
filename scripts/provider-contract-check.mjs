import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PROVIDERS, effectiveProviderSort, providerInfo, providerSorts, sourceIdForUrl } from '../src/lib/provider-info.ts';
import { ProviderError, needsVerification } from '../src/lib/provider-errors.ts';
import { getProvider, storyProvider } from '../src/lib/providers/registry.ts';
import { chapterListCached, sourceOf } from '../src/lib/parser.ts';

assert.deepEqual(PROVIDERS.map(info => info.id), ['asura', 'webtoon', 'vortex', 'mangakakalot']);
for (const info of PROVIDERS) {
  const adapter = getProvider(info.id);
  assert.equal(adapter.id, info.id);
  assert.deepEqual(adapter.cursor(undefined), adapter.cursor({}));
  for (const cursor of [null, [], 'bad', {offset:-1}, {page:0}]) {
    // Asura has offsets for two formats, rather than a page/offset cursor.
    if (info.id === 'asura' && cursor && !Array.isArray(cursor) && typeof cursor === 'object') continue;
    assert.throws(() => adapter.cursor(cursor), /cursor/i);
  }
  for (const host of info.hosts) {
    assert.equal(sourceIdForUrl(`https://${host}/`), info.id);
    assert.equal(storyProvider({url:`https://${host}/`}).id, info.id);
    assert.equal(sourceIdForUrl(`https://${host}.evil.example/`), undefined);
    assert.equal(sourceIdForUrl(`https://user:password@${host}/`), undefined);
    assert.equal(sourceIdForUrl(`http://${host}/`), undefined);
  }
  for (const host of info.requestHosts || []) {
    assert.equal(sourceIdForUrl(`https://${host}/`), undefined, 'API hosts cannot be restored as story identities');
    assert.equal(sourceIdForUrl(`https://${host}/`,true), info.id);
  }
}
assert.throws(() => getProvider('constructor'), /Unsupported/);
assert.throws(() => storyProvider({url:'https://unknown.example/comic'}), /Unsupported/);
assert.throws(() => storyProvider({url:'https://vortexscans.org/series/example',source:'asura'}), /mismatched/);
assert.throws(() => sourceOf({url:'https://unknown.example/comic'}), /Unsupported/);
assert.equal(effectiveProviderSort(providerInfo('vortex'),'rating'),'smart');
assert.equal(effectiveProviderSort(providerInfo('webtoon'),'trending','canvas'),'smart');
assert.equal(effectiveProviderSort(providerInfo('webtoon'),'trending','originals'),'trending');
assert.equal(providerSorts(providerInfo('webtoon'),'canvas').some(([key])=>key==='trending'),false);
assert.equal(effectiveProviderSort(providerInfo('asura'),'rating'),'rating');
assert.equal(PROVIDERS.filter(info=>info.verification).map(info=>info.id).join(','),'mangakakalot');
assert.equal(needsVerification(new ProviderError('verification','mangakakalot','Localized message')),true);
assert.equal(needsVerification(new ProviderError('parser','vortex','verification appears in this text')),false);
assert.equal(needsVerification('MangaKakalot needs browser verification'),true,'old persisted queue messages remain usable');

const base={title:'Example',summary:'',cover:'',rating:'',bookmarks:'',status:'',type:'Comic',chapterCount:2,latestChapter:'2'};
const contexts=[];
function context(responses) {
  const calls=[];
  const read=async url=>{calls.push(url);assert.ok(url in responses,`Unexpected adapter request ${url}`);return responses[url];};
  const ctx={text:read,json:read};contexts.push(calls);return ctx;
}
const asura=getProvider('asura'), asuraUrl='https://asurascans.com/comics/example';
const asuraContext=context({
  [asuraUrl]:'<meta property="og:title" content="Example"><meta property="og:image" content="https://cdn.example/cover.webp"><p>3 Chapters</p><a href="/comics/renamed/chapter/0">0</a><a href="/comics/example/chapter/1">1</a><a href="/comics/example/chapter/2" data-locked="true">2</a>',
  ['https://asurascans.com/comics/renamed/chapter/0']:'<img data-page-index="0" src="https://cdn.example/page.webp">',
});
const asuraItem=await asura.chapters(await asura.details({...base,url:asuraUrl,slug:'legacy-existing-slug'},asuraContext),asuraContext);
assert.equal(asuraItem.slug,'legacy-existing-slug');
assert.deepEqual(asuraItem.chapterIds,['0','1']);assert.deepEqual(asuraItem.lockedChapterIds,['2']);
assert.ok(chapterListCached(asuraItem));
assert.equal(asuraItem.chapterUrls['0'],'https://asurascans.com/comics/renamed/chapter/0','source-emitted chapter addresses survive renamed routes');
assert.equal((await asura.content(asuraItem,{id:'0',url:asuraItem.chapterUrls['0']},asuraContext)).assets[0].url,'https://cdn.example/page.webp');
assert.equal(contexts[0].filter(url=>url===asuraUrl).length,1,'details already contain the complete Asura list; enumeration does not fetch it twice');

const vortex=getProvider('vortex'), vortexUrl='https://vortexscans.org/series/example';
const vortexContext=context({
  'https://api.vortexscans.org/api/post?postSlug=example':{post:{id:42,slug:'example',postTitle:'Example',postContent:'Summary'},totalChapterCount:2},
  'https://api.vortexscans.org/api/chapters?postId=42&skip=0&take=all&order=asc':{post:{chapters:[{number:1,slug:'chapter-1',isLocked:false,isAccessible:true,mangaPostId:42},{number:2,slug:'chapter-2',isLocked:true,mangaPostId:42}]},totalChapterCount:2},
});
const vortexItem=await vortex.chapters(await vortex.details({...base,url:vortexUrl,slug:'vortex-url-existing'},vortexContext),vortexContext);
assert.equal(vortexItem.slug,'vortex-url-existing');assert.equal(vortexItem.vortexId,'42');
assert.deepEqual(vortexItem.chapterIds,['1']);assert.deepEqual(vortexItem.lockedChapterIds,['2']);assert.ok(chapterListCached(vortexItem));

const kakalot=getProvider('mangakakalot'), kakalotUrl='https://www.mangakakalot.gg/manga/example';
const kakalotPage=(offset,chapter,more)=>({success:true,data:{chapters:[chapter],pagination:{total:2,offset,has_more:more}}});
const kakalotContext=context({
  [kakalotUrl]:'<div class="manga-info-top"><h1>Example</h1><li>Status : Ongoing</li></div><div id="contentBox">A summary</div>',
  'https://www.mangakakalot.gg/api/manga/example/chapters?limit=500&offset=0':kakalotPage(0,{chapter_num:0,chapter_slug:'chapter-0',chapter_name:'Prologue'},true),
  'https://www.mangakakalot.gg/api/manga/example/chapters?limit=500&offset=1':kakalotPage(1,{chapter_num:1,chapter_slug:'chapter-1',is_locked:true},false),
  [kakalotUrl+'/chapter-0']:'<div class="container-chapter-reader"><img src="https://img-r1.2xstorage.com/page.webp"></div>',
});
const kakalotItem=await kakalot.chapters(await kakalot.details({...base,url:kakalotUrl,slug:'mangakakalot-example'},kakalotContext),kakalotContext);
assert.deepEqual(kakalotItem.chapterIds,['0']);assert.deepEqual(kakalotItem.lockedChapterIds,['1']);
assert.equal(kakalotItem.chapterCount,2);assert.ok(chapterListCached(kakalotItem));
assert.equal((await kakalot.content(kakalotItem,{id:'0',url:kakalotItem.chapterUrls['0']},kakalotContext)).assets[0].referer,'https://www.mangakakalot.gg/');

const webtoon=getProvider('webtoon'), webtoonUrl='https://www.webtoons.com/en/fantasy/example/list?title_no=42';
const episode=(id,locked=false)=>`<li${locked?' class="ico_lock"':''}><a href="https://www.webtoons.com/en/fantasy/example/episode/viewer?title_no=42&amp;episode_no=${id}"><span class="subj">Episode ${id}</span></a></li>`;
const webtoonContext=context({
  [webtoonUrl]:`<meta property="og:url" content="${webtoonUrl}"><p class="summary">Full summary</p><ul id="_listUl">${episode(2)}${episode(3,true)}</ul><a href="${webtoonUrl}&amp;page=2">2</a>`,
  [webtoonUrl+'&page=2']:`<ul id="_listUl">${episode(1)}</ul>`,
});
const webtoonItem=await webtoon.chapters(await webtoon.details({...base,url:webtoonUrl,slug:'webtoon-en-42',language:'en'},webtoonContext),webtoonContext);
assert.deepEqual(webtoonItem.chapterIds,['1','2']);assert.deepEqual(webtoonItem.lockedChapterIds,['3']);
assert.ok(chapterListCached(webtoonItem));assert.equal(webtoonItem.slug,'webtoon-en-42');
assert.equal(webtoonItem.summary,'Full summary');

const discovered=await asura.discover({json:async()=>{},text:async url=>{
  if(url==='https://asurascans.com/')throw Error('Unavailable homepage');
  return '<a href="/novels/example">Example novel</a>';
}});
assert.equal(discovered[0].slug,'novel--example','one optional homepage failure does not block the other format');

// An adapter cannot import the native/storage/UI services it is meant to isolate.
for(const name of readdirSync(new URL('../src/lib/providers/',import.meta.url))) {
  const source=readFileSync(new URL('../src/lib/providers/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ["'](?:expo|react|react-native|.*(?:storage|app-state|network|releases|background-downloads))["']/);
}
console.log('Provider registry, capabilities, cursor validation, host boundaries, stable IDs, public content and adapter isolation passed');
