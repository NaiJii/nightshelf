import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PROVIDERS, effectiveProviderSort, providerInfo, providerSorts, sourceIdForUrl } from '../src/lib/provider-info.ts';
import { isBrowserChallenge, ProviderError, needsVerification } from '../src/lib/provider-errors.ts';
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
assert.equal(getProvider('asura').verify,undefined,'Asura uses the anonymous public API without a browser verification flow');
assert.equal(needsVerification(new ProviderError('verification','mangakakalot','Localized message')),true);
assert.equal(needsVerification(new ProviderError('parser','vortex','verification appears in this text')),false);
assert.equal(needsVerification('MangaKakalot needs browser verification'),true,'old persisted queue messages remain usable');
assert.equal(isBrowserChallenge('<title>Just a moment...</title>'),true);
assert.equal(isBrowserChallenge('<title>Attention Required! | Cloudflare</title><script src="/cdn-cgi/challenge-platform/test"></script>'),true);
for (const body of ['Forbidden','{"error":"access denied"}','<title>Attention Required</title><p>You are blocked</p>','<title>Example</title><script src="/cdn-cgi/challenge-platform/test"></script>']) assert.equal(isBrowserChallenge(body),false,'plain refusals and passive scripts must not trigger verification');

const base={title:'Example',summary:'',cover:'',rating:'',bookmarks:'',status:'',type:'Comic',chapterCount:2,latestChapter:'2'};
const contexts=[];
function context(responses) {
  const calls=[];
  const read=async url=>{calls.push(url);assert.ok(url in responses,`Unexpected adapter request ${url}`);return responses[url];};
  const ctx={text:read,json:read};contexts.push(calls);return ctx;
}
const asura=getProvider('asura'), asuraUrl='https://asurascans.com/comics/example-f212c582';
const api='https://api.asurascans.com/api/series/example';
const asuraContext=context({
  [api]:{series:{slug:'example',public_url:'/comics/example-f212c582',title:'Example',chapter_count:3,bookmark_count:123,alt_titles:['Alias'],description:'Complete summary',cover:'https://cdn.example/cover.webp'}},
  [api+'/chapters']:{data:[{number:2,is_premium:true},{number:1,is_premium:false},{number:0,is_premium:false}]},
  [api+'/chapters/0']:{data:{is_locked:false,access_gate:'',chapter:{number:0,series_slug:'example',is_premium:false,page_count:1,pages:[{url:'https://cdn.example/page.webp'}]}}},
});
const asuraDetails=await asura.details({...base,url:asuraUrl,slug:'legacy-existing-slug'},asuraContext);
assert.equal(asuraDetails.chapterIds,undefined,'metadata does not fetch the chapter list');
assert.equal(contexts[0].length,1);
assert.equal(asuraDetails.bookmarks,'123');assert.deepEqual(asuraDetails.alternativeTitles,['Alias']);
const asuraItem=await asura.chapters(asuraDetails,asuraContext);
assert.equal(asuraItem.slug,'legacy-existing-slug');
assert.equal(asuraItem.asuraSlug,'example','the API slug remains separate from the stable local story ID');
assert.deepEqual(asuraItem.chapterIds,['0','1']);assert.deepEqual(asuraItem.lockedChapterIds,['2']);
assert.ok(chapterListCached(asuraItem));
assert.equal(asuraItem.chapterUrls['0'],asuraUrl+'/chapter/0');
assert.equal((await asura.content(asuraItem,{id:'0',url:asuraItem.chapterUrls['0']},asuraContext)).assets[0].url,'https://cdn.example/page.webp');
assert.equal(contexts[0].length,3,'only details, chapter list, and public reader API are requested');
for(const data of [
 {is_locked:true,chapter:{number:0,is_premium:false,pages:[{url:'https://cdn.example/leaked.webp'}],page_count:1}},
 {is_locked:false,access_gate:'premium',chapter:{number:0,is_premium:false}},
 {is_locked:false,chapter:{number:0,is_premium:true}},
 {chapter:{number:0,is_premium:false}},
 {is_locked:false,chapter:{number:1,is_premium:false}},
 {is_locked:false,chapter:{number:0,series_slug:'another-story',is_premium:false}},
 {is_locked:false,chapter:{number:0,is_premium:false,page_count:2,pages:[{url:'https://cdn.example/page.webp'}]}},
 {is_locked:false,chapter:{number:0,is_premium:false,page_count:1,pages:[{url:'http://cdn.example/page.webp'}]}},
]) await assert.rejects(()=>asura.content(asuraItem,{id:'0',url:asuraItem.chapterUrls['0']},{json:async()=>({data}),text:async()=>{throw Error('Unexpected HTML request');}}));
await assert.rejects(()=>asura.chapters({...asuraDetails,chapterCount:4},asuraContext),/incomplete chapter list/);
await assert.rejects(()=>asura.chapters(asuraDetails,{json:async()=>({data:[{number:0,is_premium:false},{number:0,is_premium:false},{number:1,is_premium:false}]})}),/incomplete chapter list/);
const gated=await asura.chapters({...asuraDetails,chapterCount:3},{json:async()=>({data:[{number:0},{number:1,is_premium:false,early_access_until:'2999-01-01T00:00:00Z'},{number:2,is_premium:false,is_locked:true}]})});
assert.deepEqual(gated.chapterIds,[],'unknown, early-access and explicitly locked chapters are not downloadable');

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

assert.equal(asura.discover,undefined,'API discovery must not request challenged HTML homepages');

// An adapter cannot import the native/storage/UI services it is meant to isolate.
for(const name of readdirSync(new URL('../src/lib/providers/',import.meta.url))) {
  const source=readFileSync(new URL('../src/lib/providers/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ["'](?:expo|react|react-native|.*(?:storage|app-state|network|releases|background-downloads))["']/);
}
console.log('Provider registry, capabilities, cursor validation, host boundaries, stable IDs, public content and adapter isolation passed');
