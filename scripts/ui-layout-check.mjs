import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/parser.ts";
import * as providerInfo from "../src/lib/provider-info.ts";
import * as providerErrors from "../src/lib/provider-errors.ts";
import * as releasePolicy from "../src/lib/release-policy.ts";
import * as exploreSessions from "../src/lib/explore-session.ts";
import * as readingUx from "../src/lib/reading-ux.ts";
import * as requestControl from "../src/lib/request-control.ts";

function component(file, extraModules = {}, globals = {}) {
  const slots = [], effects = []; let cursor = 0;
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    react: {
      createContext: value => ({ Provider: "Provider", value }), useContext: context => context.value, useCallback: fn => fn,
      useMemo(fn, deps) { const at=cursor++, previous=slots[at]; if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index]))) slots[at]={value:fn(),deps}; return slots[at].value; },
      useEffect: (callback, deps) => effects.push({callback,deps}),
      useLayoutEffect: callback=>callback(),
      useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }]; },
      useRef(initial) { const at = cursor++; return slots[at] ||= { current: initial }; },
    },
    "react-native": Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "View", "FlatList", "TextInput", "ActivityIndicator"].map(name => [name, name])),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./ui": { color: {}, ui: {}, Icon: "Icon" },
    ...extraModules,
  };
  const exports = {};
  const script = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(script, { exports, AbortController, Error, setTimeout, clearTimeout, ...globals, require: name => { if (name.endsWith("/provider-info")) return providerInfo; if (name.endsWith("/provider-errors")) return providerErrors; if (name.endsWith("/pressable") || name === "./pressable") return {Pressable:"Pressable"}; assert.ok(modules[name], name); return modules[name]; } });
  return { effects, render(name, ...args) { cursor = 0; effects.length = 0; return exports[name](...args); } };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
const touch=component('../src/components/pressable.tsx');
const touchHandler=()=>{};
const touchButton=touch.render('Pressable',{onPress:touchHandler,accessibilityLabel:'Bookmark',disabled:false,style:{minHeight:48}});
assert.equal(touchButton.props.onPress,touchHandler);
assert.equal(touchButton.props.accessibilityLabel,'Bookmark');
assert.ok(touchButton.props.android_ripple,'Android touch feedback is native and does not await storage/network work');
assert.equal(touchButton.props.style({pressed:true})[0].minHeight,48,'touch feedback preserves button sizing');
assert.equal(touchButton.props.style({pressed:true})[1].opacity,0.72);

const browseRequests = [];
const exploreShelf = {
  catalog: [{slug:'first',title:'First'}], saved: {}, preferences: {source:'asura',sort:'title'},
  rememberSearch:()=>{},browse: (options, cursor, signal, manual) => new Promise((resolve,reject) => browseRequests.push({options,cursor,signal,manual,resolve,reject})),
};
let retryExplore;
const exploreModules = {
  'expo-router': {router:{}},
  '../../lib/app-state': {useShelf:()=>exploreShelf},
  '../../lib/parser': {filterDiscovery:items=>items,sortExplore:items=>items},
  '../../lib/explore-session': exploreSessions,
  '../../lib/scraper': {FIRST_PAGE:{page:1}},
  '../../components/ui': {ui:{},color:{},Icon:'Icon',Chip:'Chip',PageHeading:'PageHeading'},
  '../../components/series-card': {SeriesCard:'SeriesCard'},
  '../../components/use-source-retry': {useSourceRetry:retry=>{retryExplore=retry;return ()=>{};}},
  '../../components/discovery-controls': {DiscoveryControls:'DiscoveryControls',PopularPeriods:'PopularPeriods'},
};
const explore = component('../src/app/(tabs)/explore.tsx', exploreModules);
const exploreList = () => nodes(explore.render('ExploreResults',{provider:'asura-test'})).find(node=>node.type==='FlatList');
const settleExplore = async () => { await new Promise(resolve=>setTimeout(resolve,0)); const list=exploreList(); explore.effects.at(-1).callback(); return list; };
exploreList();
const stopExplore = explore.effects[1].callback();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(browseRequests.length,1);
let discovery = exploreList();
discovery.props.onLayout({nativeEvent:{layout:{height:600}}});
discovery.props.onContentSizeChange(400,3000);
browseRequests[0].resolve({ids:['first'],cursor:{page:2},hasMore:true});
await settleExplore();
assert.equal(browseRequests.length,1,'being far from the bottom does not fetch another page');
discovery=exploreList();
discovery.props.onScroll({nativeEvent:{contentOffset:{y:1900}}});
discovery.props.onEndReached();
discovery.props.onScroll({nativeEvent:{contentOffset:{y:1950}}});
assert.equal(browseRequests.length,2,'approaching the bottom prefetches once, despite repeated scroll/end events');
assert.ok(nodes(exploreList().props.ListFooterComponent).some(node=>node.type==='ActivityIndicator'),'pagination displays a loading indicator');
browseRequests[1].resolve({ids:[],cursor:{page:3},hasMore:true});
await settleExplore();
assert.equal(browseRequests.length,3,'pages hidden by filters keep advancing even without a content-size/end-reached event');
assert.equal(browseRequests[2].cursor.page,3);
browseRequests[2].reject(new Error('Offline'));
await settleExplore();
discovery=exploreList();
discovery.props.onEndReached();
discovery.props.onContentSizeChange(400,2900);
discovery.props.onScroll({nativeEvent:{contentOffset:{y:2100}}});
assert.equal(browseRequests.length,3,'failed pagination stops automatic requests until explicitly retried');
assert.ok(nodes(discovery.props.ListFooterComponent).find(node=>node.props?.accessibilityLabel==='Retry loading titles'));
retryExplore();
assert.equal(browseRequests.at(-1).cursor.page,browseRequests[2].cursor.page,'verification recovery retries the failed page instead of resetting the whole search');
assert.equal(browseRequests.length,4);
assert.equal(browseRequests[3].manual,true);
browseRequests[3].resolve({ids:[],cursor:{page:4},hasMore:false});
await settleExplore();
discovery=exploreList(); discovery.props.onEndReached(); discovery.props.onContentSizeChange(400,2900);
assert.equal(browseRequests.length,4,'exhausted results stop automatic pagination');
assert.ok(!nodes(discovery.props.ListFooterComponent).some(node=>node.type==='Pressable'),'normal pagination needs no Load more button');
stopExplore();
const revisited = component('../src/app/(tabs)/explore.tsx', exploreModules);
const revisitedList = () => nodes(revisited.render('ExploreResults',{provider:'asura-test'})).find(node=>node.type==='FlatList');
revisitedList(); const stopRevisited=revisited.effects[1].callback();
await new Promise(resolve=>setTimeout(resolve,0));
let remembered = revisitedList();
assert.equal(browseRequests.length,4,'returning to a provider restores loaded pages without requesting them again');
assert.equal(remembered.props.data[0].slug,'first');
const restoredOffsets=[];remembered.props.ref.current={scrollToOffset:value=>restoredOffsets.push(value.offset)};
remembered.props.onLayout({nativeEvent:{layout:{height:600}}});remembered.props.onContentSizeChange(400,2900);
assert.deepEqual(restoredOffsets,[2100],'returning to a provider restores the previous scroll position');
remembered.props.onRefresh();
stopRevisited(); revisitedList(); const stopRefresh=revisited.effects[1].callback();
await new Promise(resolve=>setTimeout(resolve,0));
remembered=revisitedList();
assert.equal(remembered.props.data[0].slug,'first','cached stories remain usable while refresh is pending');
assert.equal(remembered.props.refreshing,true);
assert.equal(browseRequests.length,5);
browseRequests[4].reject(Error('Refresh offline'));
await new Promise(resolve=>setTimeout(resolve,0));
remembered=revisitedList();
assert.equal(remembered.props.data[0].slug,'first','a failed refresh keeps the cached list');
assert.equal(remembered.props.refreshing,false);
stopRefresh();
remembered.props.ListHeaderComponent.props.children[1].props.children.find(node=>node.type==='TextInput').props.onChangeText(' remembered query ');
assert.equal(exploreSessions.exploreQuery('asura-test'),' remembered query ','queries are remembered per provider');
assert.equal(exploreSessions.exploreQuery('other-provider'),'');
exploreSessions.rememberExploreQuery('short-test','a');
const shortSearch=component('../src/app/(tabs)/explore.tsx',exploreModules);
shortSearch.render('ExploreResults',{provider:'short-test'});const stopShort=shortSearch.effects[1].callback();
const beforeShortSearch=browseRequests.length;await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(browseRequests.length,beforeShortSearch,'one-character queries do not page through the entire provider catalog');
stopShort();

const summary = component("../src/components/expandable-summary.tsx");
const renderSummary = () => nodes(summary.render("ExpandableSummary", { text: "A summary of any character length." }));
const measure = count => renderSummary().find(node => node.props?.onTextLayout).props.onTextLayout({ nativeEvent: { lines: Array(count).fill({}) } });
measure(4);
assert.ok(!renderSummary().some(node => node.type === "Pressable"), "fitting summaries have no expansion control");
measure(5);
renderSummary().find(node => node.type === "Pressable").props.onPress();
assert.ok(renderSummary().some(node => node.props?.children === "Show less"));
assert.equal(renderSummary().filter(node => node.type === "Text" && node.props.children.startsWith?.("A summary"))[1].props.numberOfLines, undefined);
measure(3);
assert.ok(!renderSummary().some(node => node.type === "Pressable"), "remeasuring at a wider width or smaller font removes the unnecessary control");

const sheets = component("../src/components/action-sheet.tsx");
const renderSheet = () => sheets.render("ActionSheetProvider", { children: null });
const show = renderSheet().props.value;
let chosen = 0;
show("Confirm", "Delete?", [{ text: "Delete", style: "destructive", onPress: () => chosen++ }]);
const confirmation = nodes(renderSheet());
const confirm = confirmation.find(node => node.type === "Pressable" && nodes(node).some(child => child.props?.children === "Delete"));
confirm.props.onPress(); confirm.props.onPress();
assert.equal(chosen, 1, "rapid taps cannot execute a sheet action twice");
show("Actions", undefined, [{ text: "Next", onPress: () => show("Confirmation", undefined, [{ text: "Delete", onPress: () => chosen++ }]) }]);
nodes(renderSheet()).find(node => node.type === "Pressable" && nodes(node).some(child => child.props?.children === "Next")).props.onPress();
assert.ok(nodes(renderSheet()).some(node => node.props?.children === "Confirmation"), "nested confirmation replaces the menu without being dismissed by the old menu");
nodes(renderSheet()).find(node => node.type === "Modal").props.onRequestClose();
assert.equal(nodes(renderSheet()).find(node => node.type === "Modal").props.visible, false);
assert.equal(chosen, 1, "Android Back dismisses confirmation without performing its action");

const story = { url: 'https://asurascans.com/comics/example', slug: 'example', title: 'Example', summary: 'Summary.', type: 'Comic', rating: '', chapterCount: 2, chapterIds: ['1','2'], localChapters: ['1'], detailsCached: true };
const requested = [];
const estimateCalls = [];
const positions = {example:{chapter:"2",fraction:0.6,chapters:{"1":{fraction:0.4},"2":{fraction:0.6}}}};
const shelf = { catalog: [story], read: {example:{}}, saved: {}, preferences: {}, downloads: [], detailsLoading: [], notice: '', downloadBusy: () => false, startDownload: (_, selection) => {requested.push(selection);return true;}, setReadStatus(slug, ids, value) {for (const id of ids) {if(value) shelf.read[slug][id]='read';else {delete shelf.read[slug][id];positions[slug].chapters[id].fraction=0;}}} };
const chapterSheets = [], readNowChoices = [];
const details = component('../src/app/series/[slug].tsx', {
  'expo-router': {useLocalSearchParams: () => ({slug:'example'}), useFocusEffect: () => {}, router: {}},
  '../../lib/parser': parser,
  '../../lib/storage': {readingHistory: () => positions, chapterIntact:()=>true},
  '../../lib/app-state': {useShelf: () => shelf,useDownloads:()=>shelf.downloads},
  '../../lib/library-tools': {estimateDownload: (...args) => {estimateCalls.push(args);return {bytes:1};}, formatBytes: () => '1 MB', freeBytes: () => 1000},
  '../../components/ui': {color: {}, ui: {}, Cover: 'Cover', Icon: 'Icon', Chip: 'Chip'},
  '../../components/story-row': {PublicationStatus: 'Status', SaveActions: 'SaveActions'},
  '../../lib/reading-ux': readingUx,
  '../../components/use-source-retry': {useSourceRetry:()=>()=>{}},
  '../../components/use-reader-navigation': {useReaderNavigation:()=>({go:id=>readNowChoices.push(id)})},
  '../../components/story-options': {ReadingListAction: 'ReadingListAction', ReleaseActions: 'ReleaseActions'},
  '../../components/download-list': {DownloadList: 'DownloadList'},
  '../../components/download-drawer': {useDownloadDrawer:()=>()=>{}},
  '../../components/expandable-summary': {ExpandableSummary: 'Summary'},
  '../../components/action-sheet': {useActionSheet: () => (...args) => chapterSheets.push(args)},
});
const list = () => nodes(details.render('default',{})).find(node => node.type === 'FlatList');
const header = () => nodes(list().props.ListHeaderComponent);
const row = id => nodes(list().props.renderItem({item:id}));
const readToggle = () => row('1').find(node => node.props?.accessibilityLabel === 'Chapter 1 read');
const progress = id => row(id).find(node=>node.props?.accessibilityRole==='progressbar');
assert.equal(progress('1').props.style.width,'40%','the background reflects this chapter, not just the most recent chapter');
assert.equal(progress('2').props.style.width,'60%');
assert.equal(progress('1').props.pointerEvents,'none','progress cannot intercept reading or selection taps');
assert.ok(row('1').some(node=>node.props?.name==='download-outline'),'downloaded chapters have an icon');
assert.ok(!row('2').some(node=>node.props?.name==='download-outline'));
assert.ok(!row('1').some(node=>node.props?.children==='Saved on phone'),'duplicate visual status text is removed');

readToggle().props.onPress();
assert.equal(progress('1').props.style.width,'100%');
assert.ok(header().some(node => node.props?.accessibilityLabel === 'Select all 1 unread chapters'));
readToggle().props.onPress();
assert.equal(progress('1').props.style.width,'0%','marking unread clears the full bar immediately');
positions.example.chapters['2'].fraction=1;
assert.equal(progress('2').props.style.width,'99%','position alone does not imply that the last panel was seen');
const selectUnread = header().find(node => node.props?.accessibilityLabel === 'Select all 2 unread chapters');
assert.ok(selectUnread && !selectUnread.props.disabled, 'marking a saved chapter unread immediately restores it to Select all unread');
selectUnread.props.onPress();
for (const id of ['1','2']) assert.equal(row(id).find(node => node.props?.accessibilityLabel === 'Select chapter '+id).props.accessibilityState.checked,true);
const screen = nodes(details.render('default',{}));
screen.find(node => node.type === 'Pressable' && nodes(node).some(child => child.props?.children?.join?.('') === 'Download (1)')).props.onPress();
assert.deepEqual(requested,['2'],'downloading an unread selection does not re-download chapters already saved');
details.render('default',{}); // The completed selection clears after enqueueing.
const estimatesBeforeProgress=estimateCalls.length;
for(let i=0;i<10;i++)details.render('default',{});
assert.equal(estimateCalls.length,estimatesBeforeProgress,'download progress rerenders do not rescan files for an unchanged size estimate');
console.log("Measured summary overflow, themed sheets and read/unread selection checks passed");
row('2').find(node=>node.props?.onLongPress).props.onLongPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Read from here').onPress();
assert.equal(row('1').find(node=>node.props?.accessibilityLabel==='Select chapter 1').props.accessibilityState.checked,false);
assert.equal(row('2').find(node=>node.props?.accessibilityLabel==='Select chapter 2').props.accessibilityState.checked,true,'long-press selects only the requested forward range');
row('2').find(node=>node.props?.onLongPress).props.onLongPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Read now').onPress();
assert.deepEqual(readNowChoices,['2'],'Read now uses the priority reader download path');
shelf.connection={label:'Offline'};
row('2').find(node=>node.props?.onLongPress).props.onPress();
assert.equal(chapterSheets.at(-1)[0],'Internet required','an unavailable unsaved chapter explains the connection requirement');
shelf.connection={label:'Wi-Fi'};story.lockedChapterIds=['3'];
row('3').find(node=>node.props?.onLongPress).props.onPress();
assert.equal(chapterSheets.at(-1)[0],'Provider access required');
assert.ok(!chapterSheets.at(-1)[2].some(action=>action.text==='Read now'),'restricted chapters never offer an unavailable download');
delete story.lockedChapterIds;
console.log('Chapter long-press range selection, Read now and contextual unavailable actions passed');


shelf.detailsErrors={example:'Vortex request failed (503)'};
shelf.loadDetails=(...args)=>requested.push(args);
const retry=header().find(node=>node.props?.accessibilityLabel==='Retry loading chapters');
assert.ok(retry,'chapter failures remain visible independently of global sync notices');
retry.props.onPress();
assert.equal(JSON.stringify(requested.at(-1)),JSON.stringify(['example',true]));

// Exercise the actual app-state handlers while keeping native effects dormant.
let route='/series/example', settings={source:'vortex',mobileData:'ask',autoSync:false,interval:10}, rejectDetails, rejectSync, detailsSignal;
const nativeControls={backgroundTransfers:null};
const automaticQueued=[], localDeletions=[];
let resolveNetwork;
const provider = component('../src/lib/app-state.tsx', {
  'expo-router': {usePathname:()=>route},
  'react-native': {AppState:{currentState:'active'}},
  '@react-native-community/netinfo': {__esModule:true,default:{fetch:()=>new Promise(resolve=>{resolveNetwork=resolve;})}},
  './parser': parser,
  './release-policy': releasePolicy,
  './storage': {catalogMetadata:()=>[story],loadCatalogAsync:async()=>[story],loadCatalog:()=>[story],loadPreferences:()=>settings,savePreferences:value=>{settings=value;},savedStories:()=>({example:{bookmarked:true,autoDownload:true,autoDownloadBaseline:['1']}}),readChapters:()=>({}),releaseUpdates:()=>({example:['2']}),loadDownloads:()=>[],deleteChapters:(...args)=>localDeletions.push(args)},
  './scraper': {refreshSeries:(_item,_guard,signal)=>{detailsSignal=signal;return new Promise((_,reject)=>{rejectDetails=reject;});},syncCatalog:()=>new Promise((_,reject)=>{rejectSync=reject;})},
  './network': {networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy': {connectionLabel:()=>({label:'Offline'})},
  './releases': {configureReleaseChecks:async()=>{}},
  './download-queue': {restoredDownloads:()=>[],DownloadQueue:class {jobs=[];isBusy(){return false;}pause(){}enqueue(...args){automaticQueued.push(args);} }},
  './request-control': requestControl,
  './background-downloads': nativeControls,
  './library-tools': {},
});
const app=()=>provider.render('AppProvider',{}).props.value;
const navigate=path=>{route=path;app();provider.effects[0].callback();};
navigate('/series/example');
const detailsPending=app().loadDetails('example',true);
await Promise.resolve();
navigate('/settings');
rejectDetails(Error('Vortex chapter list could not be read'));
await detailsPending;
assert.equal(app().notice,'','chapter failures cannot leak into other screens, including late failures');
assert.equal(app().detailsErrors.example,'Vortex chapter list could not be read','chapter errors stay attached to the affected story');
provider.render('AppProvider',{});
const abortedDetails=app().loadDetails('example',true);
await Promise.resolve();
app().cancelDetails('example');
assert.equal(detailsSignal.aborted,true,'leaving a story aborts the provider request itself');
await abortedDetails;
await requestControl.yieldToForeground();
assert.equal(app().detailsLoading.length,0,'leaving a story releases loading and foreground priority even if its request never settles');
const visibleSync=app().sync();rejectSync(Error('Source unavailable'));await visibleSync;
assert.equal(app().notice,'Source unavailable');
navigate('/library');
assert.equal(app().notice,'','navigation clears transient banners');
const lateSync=app().sync();navigate('/explore');rejectSync(Error('Old source warning'));await lateSync;
assert.equal(app().notice,'',"an older screen's sync cannot republish its warning after navigation");
const providerSync=app().sync();rejectSync(Error('Vortex unavailable'));await providerSync;
assert.equal(app().notice,'Vortex unavailable');
app().updatePreferences({source:'asura'});app();provider.effects[0].callback();
assert.equal(app().notice,'','changing providers clears the previous provider warning');
app().updatePreferences({sort:'rating',hideLiked:true});app().updatePreferences({source:'vortex'});
app().updatePreferences({sort:'updated',hideLiked:false});app().updatePreferences({source:'asura'});
assert.equal(app().preferences.sort,'rating','each provider restores its sorting and filters');
assert.equal(app().preferences.hideLiked,true);
app().updatePreferences({sort:'title'});app().updatePreferences({source:'asura'});
assert.equal(app().preferences.sort,'title','tapping the active provider cannot restore stale preferences');
nativeControls.backgroundTransfers={pause:async()=>{throw Error('Could not pause Android transfer');}};
nativeControls.stopTransfer=async()=>{throw Error('Could not stop Android transfer');};
app().pauseDownload('example');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(app().notice,'Could not pause Android transfer','native pause failures become visible instead of unhandled rejections');
app().resumeDownload('example');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(app().notice,'Could not stop Android transfer','native resume failures become visible instead of unhandled rejections');
nativeControls.transferStates=()=>({});
app();provider.effects.find(effect=>effect.deps?.length===5).callback();
const deletionPending=app().removeDownloads(story,['1']);
resolveNetwork({type:'wifi',isConnected:true});
await deletionPending;
assert.equal(localDeletions.length,1);
assert.equal(automaticQueued.length,0,'automatic transfers cannot start writing while files are being deleted');
app();provider.effects.find(effect=>effect.deps?.length===5).callback();resolveNetwork({type:'wifi',isConnected:true});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(automaticQueued.length,1,'automatic transfers work again once deletion finishes');
console.log('Screen-scoped chapter errors, navigation cleanup and late-sync warning checks passed');

const releaseChanges=[], releaseSheets=[], releaseRoutes=[];
const releaseShelf={catalog:[{...story,updatedAt:'2026-10-01'}, {...story,slug:'other',title:'Other',chapterIds:['3']}],saved:{example:{bookmarked:true},other:{bookmarked:true}},read:{example:{'2':'read'}},updates:{example:['1','2','2'],other:['3']},preferences:{releaseNotifications:false},setStoryOptions:(slug,change)=>{releaseChanges.push(change);releaseShelf.saved[slug]={...releaseShelf.saved[slug],...change};},setStoryNotifications:(...args)=>releaseChanges.push(args)};
const releaseActions=component('../src/components/story-options.tsx',{
  '../lib/app-state':{useShelf:()=>releaseShelf},
  './action-sheet':{useActionSheet:()=>(...args)=>releaseSheets.push(args)},
});
const cloud=()=>nodes(releaseActions.render('ReleaseActions',{item:story})).find(node=>node.props?.accessibilityLabel==='Auto-download new chapters');
cloud().props.onPress();assert.equal(cloud().props.accessibilityState.checked,true);assert.equal(releaseSheets.at(-1)[0],'Release alerts?');
releaseSheets.at(-1)[2].find(action=>action.text==='Notify me').onPress();assert.equal(JSON.stringify(releaseChanges.at(-1)),JSON.stringify(['example',true]));
cloud().props.onPress();assert.equal(cloud().props.accessibilityState.checked,false);
const feed=component('../src/components/release-feed.tsx',{
  './ui':{color:{},ui:{},Cover:'Cover',Icon:'Icon'},
  '../lib/app-state':{useShelf:()=>releaseShelf},'../lib/parser':parser,'../lib/release-policy':releasePolicy,
  'expo-router':{router:{push:route=>releaseRoutes.push(route),navigate:route=>releaseRoutes.push(route)}},
});
const feedNodes=nodes(feed.render('ReleaseFeed',{}));
assert.equal(feedNodes.filter(node=>node.type==='Pressable'&&node.props?.accessibilityLabel?.includes('new chapter')).length,2,'the feed groups releases into one row per story');
const feedStory=feedNodes.find(node=>node.props?.accessibilityLabel==='Example, 1 new chapter');assert.ok(feedStory,'read chapters and duplicate releases are excluded');
feedStory.props.onPress();assert.equal(releaseRoutes.at(-1).params.filter,'unread');
console.log('Auto-download icon, release alert proposal, grouped feed and unread navigation checks passed');

const readerSheets=[], readerRoutes=[], readerFetches=[];
const readerSaved=new Set(['1']);let readerFocus;
const readerShelf={preferences:{readerContinuous:true,readerPrefetch:true},fetchReaderChapter:(slug,chapter,automatic,signal,progress)=>new Promise((resolve,reject)=>{
  readerFetches.push({slug,chapter,automatic,signal,progress,reject,resolve:()=>{readerSaved.add(chapter);resolve();}});
  signal.addEventListener('abort',()=>reject(Object.assign(new Error('Cancelled'),{name:'AbortError'})),{once:true});
})};
const readerNavigation=component('../src/components/use-reader-navigation.ts',{
  'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  'expo-router':{router:{replace:route=>readerRoutes.push(route),push:route=>readerRoutes.push({...route,pushed:true})},useFocusEffect:callback=>{readerFocus=callback;}},
  '../lib/app-state':{useShelf:()=>readerShelf},
  '../lib/storage':{chapterIntact:(_,chapter)=>readerSaved.has(chapter)},
  './action-sheet':{useActionSheet:()=>(...args)=>readerSheets.push(args)},
  './use-source-retry':{useSourceRetry:()=>()=>{}},
});
const readerNav=()=>readerNavigation.render('useReaderNavigation','example','Example','2');
let nav=readerNav();const leaveReader=readerFocus();
nav.go('2');assert.equal(readerFetches.length,0,'missing manual navigation requests consent first');
readerSheets.at(-1)[2].find(action=>action.text==='Download and read').onPress();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerFetches[0].automatic,false);assert.equal(readerRoutes.length,0,'reader stays put until saved');
readerFetches[0].resolve();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.at(-1).params.chapter,'2');assert.equal(readerRoutes.at(-1).params.entry,'start');
readerSaved.delete('2');readerFetches.length=0;
nav=readerNav();nav.prefetch(.7);nav.prefetch(.8);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerFetches.length,1,'prefetch does not launch duplicate writers');assert.equal(readerFetches[0].automatic,true);
nav.go('2',true);readerFetches[0].resolve();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerFetches.length,1,'edge navigation reuses in-flight prefetch');
nav=readerNav();nav.go('1',true,true);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.at(-1).params.entry,'end','continuous backward navigation lands at the previous end');
nav=readerNav();nav.go('1',false,true);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.at(-1).params.entry,'end','the Previous button also lands at the final panels');
const inPlace=[];const routesBeforeInPlace=readerRoutes.length;
nav=readerNavigation.render('useReaderNavigation','example','Example','2',undefined,false,(id,end)=>inPlace.push({id,end}));
nav.go('1',false,true);await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(inPlace,[{id:'1',end:true}]);
assert.equal(readerRoutes.length,routesBeforeInPlace,'continuous navigation reuses the existing WebView without replacing the route');
readerShelf.preferences.readerContinuous=false;nav=readerNav();const routesBefore=readerRoutes.length;nav.go('1',true);
assert.equal(readerRoutes.length,routesBefore,'continuous navigation can be disabled');
readerShelf.preferences.readerContinuous=true;readerSaved.delete('2');nav=readerNav();nav.go('2');readerSheets.at(-1)[2].find(action=>action.text==='Download and read').onPress();await new Promise(resolve=>setTimeout(resolve,0));
leaveReader();assert.ok(readerFetches.at(-1).signal.aborted,'leaving the reader aborts its writer');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.length,routesBefore,'an aborted download never navigates after leaving');
console.log('Reader download consent, prefetch deduplication, continuous settings and cancellation checks passed');

let readerNetwork={type:'wifi',isConnected:true,details:{isConnectionExpensive:false}}, closeReaderWriter;
const directReaderCalls=[], readerDeletions=[], readerPriority=[];
const intactReaderChapters=new Set(['1']);
const readerStory={...story,chapterIds:['1','2'],localChapters:['1']};
const readerProvider=component('../src/lib/app-state.tsx',{
  'expo-router':{usePathname:()=>'/reader/example/1'},
  'react-native':{AppState:{currentState:'active'}},
  '@react-native-community/netinfo':{__esModule:true,default:{fetch:async()=>readerNetwork}},
  './parser':parser,'./release-policy':releasePolicy,
  './storage':{catalogMetadata:()=>[readerStory],loadCatalogAsync:async()=>[readerStory],loadPreferences:()=>({source:'asura',deleteAfterReading:true,autoDownloadLimitMB:2048}),savedStories:()=>({}),readChapters:()=>({example:{'1':'read'}}),releaseUpdates:()=>({}),loadDownloads:()=>[],localChapters:()=>['1'],chapterIntact:(_,chapter)=>intactReaderChapters.has(chapter),deleteChapters:(...args)=>readerDeletions.push(args)},
  './scraper':{downloadChapters:async(...args)=>{await args[3]();directReaderCalls.push(args);await new Promise(resolve=>{closeReaderWriter=resolve;});requestControl.throwIfAborted(args[4]);intactReaderChapters.add(args[1]);}},
  './network':{networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy':{connectionLabel:()=>({label:'Wi-Fi'})},
  './releases':{},'./download-queue':{restoredDownloads:()=>[],DownloadQueue:class{jobs=[];isBusy(){return false;}async holdForReader(){readerPriority.push('hold');return ()=>readerPriority.push('release');}}},
  './request-control':requestControl,'./background-downloads':{transferStates:()=>({})},
  './library-tools':{freeBytes:()=>1024**3,libraryBytesAsync:async()=>0},
});
const readerApp=()=>readerProvider.render('AppProvider',{}).props.value;
const directSignal=new AbortController();
const directDownload=readerApp().fetchReaderChapter('example','2',true,directSignal.signal,()=>{});
const duplicateDownload=readerApp().fetchReaderChapter('example','2',true,directSignal.signal,()=>{});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(directReaderCalls.length,1,'the app enforces a single reader writer per story');
assert.equal(directReaderCalls[0][10],false,'reader transfer cannot replace Android queue plans');
assert.equal(readerApp().downloadBusy('example'),true);
assert.equal(await readerApp().removeDownloads(readerStory,[],true),false,'deletion is blocked while a reader writer is active');
readerApp().leaveChapter('example','1');
assert.equal(readerDeletions.length,1,'delete-after-reading remains available while a different chapter is prefetched');
closeReaderWriter();await Promise.all([directDownload,duplicateDownload]);
assert.equal(readerApp().downloadBusy('example'),false,'writer lock is released after saving');
intactReaderChapters.delete('2');readerNetwork={type:'cellular',isConnected:true};
await assert.rejects(()=>readerApp().fetchReaderChapter('example','2',true,new AbortController().signal,()=>{}),/unmetered Wi-Fi/);
assert.equal(directReaderCalls.length,1,'speculative downloads never use cellular');
readerNetwork={type:'wifi',isConnected:true,details:{isConnectionExpensive:false}};
const urgentReader=readerApp().fetchReaderChapter('example','2',false,new AbortController().signal,()=>{});
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(readerPriority,['hold'],'manual Read now acquires queue priority');
closeReaderWriter();await urgentReader;
assert.deepEqual(readerPriority,['hold','release'],'the bulk queue resumes after the reader finishes saving');

intactReaderChapters.delete('2');
const retiringSignal=new AbortController();
const retiringReader=readerApp().fetchReaderChapter('example','2',true,retiringSignal.signal,()=>{});
await new Promise(resolve=>setTimeout(resolve,0));
retiringSignal.abort();
const retired=assert.rejects(retiringReader,{name:'AbortError'});
const callsBeforeRetry=directReaderCalls.length;
const replacementReader=readerApp().fetchReaderChapter('example','2',true,new AbortController().signal,()=>{});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(directReaderCalls.length,callsBeforeRetry,'retry waits until the cancelled writer has actually closed');
closeReaderWriter();await retired;await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(directReaderCalls.length,callsBeforeRetry+1,'a fresh request does not inherit the cancelled writer failure');
closeReaderWriter();await replacementReader;
console.log('Reader writer locks, deletion safety and Wi-Fi prefetch policy checks passed');

// Chapter-number jumps locate exact decimals and never select restricted rows.
story.chapterIds=['1','2','125.5'];story.lockedChapterIds=['126'];story.chapterCount=4;
const chapterScrolls=[];
list().props.ref.current={scrollToIndex:options=>chapterScrolls.push(options),scrollToOffset:()=>{}};
header().find(node=>node.props?.accessibilityLabel==='Jump to chapter number').props.onPress();
header().find(node=>node.props?.accessibilityLabel==='Chapter number').props.onChangeText('125.5');
header().find(node=>node.props?.accessibilityLabel==='Go to chapter').props.onPress();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(list().props.data[chapterScrolls.at(-1).index],'125.5');
assert.ok(row('126').some(node=>node.props?.name==='lock-closed-outline'));
assert.equal(row('126').find(node=>node.props?.accessibilityLabel==='Select chapter 126').props.disabled,true);
nativeControls.backgroundTransfers=null;
app().rememberSearch('source-a',' First ');app().rememberSearch('source-a','Second');app().rememberSearch('source-a','first');
assert.equal(JSON.stringify(app().preferences.searchHistory['source-a']),JSON.stringify(['first','Second']));
app().rememberSearch('source-b','Other');app().rememberSearch('source-a',null);
assert.equal(app().preferences.searchHistory['source-b'][0],'Other','clearing recents never clears another provider');
const drawer=component('../src/components/download-drawer.tsx',{
  'expo-router':{usePathname:()=>'/library'},
  '../lib/app-state':{useDownloads:()=>[]},'./download-list':{DownloadList:'DownloadList'},
  './download-drawer-context':{DownloadDrawerContext:{Provider:'Provider'}},
});
const draw=()=>drawer.render('DownloadDrawerProvider',{children:'screen'});
assert.equal(nodes(draw()).find(node=>node.type==='Modal').props.visible,false);
draw().props.value();assert.equal(nodes(draw()).find(node=>node.type==='Modal').props.visible,true);
nodes(draw()).find(node=>node.type==='DownloadList').props.onOpenStory();
assert.equal(nodes(draw()).find(node=>node.type==='Modal').props.visible,false,'opening a story dismisses the download drawer');
exploreSessions.rememberExploreQuery('recent-test','');
exploreShelf.preferences.searchHistory={'recent-test':['Hunter']};
const recentSearch=component('../src/app/(tabs)/explore.tsx',exploreModules);
const recentNodes=()=>nodes(nodes(recentSearch.render('ExploreResults',{provider:'recent-test'})).find(node=>node.type==='FlatList').props.ListHeaderComponent);
recentNodes().find(node=>node.type==='Chip'&&node.props.text==='Hunter').props.onPress();
assert.equal(exploreSessions.exploreQuery('recent-test'),'Hunter');
recentNodes().find(node=>node.props?.accessibilityLabel==='Clear search').props.onPress();
assert.equal(exploreSessions.exploreQuery('recent-test'),'');
console.log('Chapter jump, restricted state, per-provider recents and queue drawer checks passed');

const resumeNavigation=readerNavigation.render('useReaderNavigation','example','Example',undefined,undefined,true);
const stopResume=readerFocus();resumeNavigation.go('1');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.at(-1).pushed,true,'Home pushes the reader so Back returns to Home');
assert.equal(readerRoutes.at(-1).params.entry,undefined,'Home resume preserves the saved position');stopResume();
const cardUI=component('../src/components/series-card.tsx',{
  'react-native':{Text:'Text',View:'View',StyleSheet:{create:value=>value}},
  'expo-router':{router:{}},'../lib/parser':parser,
  './ui':{color:{},Cover:'Cover',Icon:'Icon'},
});
const translatedCard=nodes(cardUI.render('SeriesCard',{item:{...story,url:'https://www.webtoons.com/fr/fantasy/example/list?title_no=42',language:'fr'}}));
assert.ok(translatedCard.some(node=>node.type==='Icon'&&node.props.name==='globe-outline'));
assert.ok(translatedCard.some(node=>node.type==='Text'&&JSON.stringify(node.props.children).includes('WEBTOON · FR')));
console.log('Home resume navigation and source/language card checks passed');

// The reader prepares exactly two ahead sequentially, not two concurrent writers.
let twoAhead=readerNavigation.render('useReaderNavigation','example','Example','8',undefined,false,undefined,'9');
readerNavigation.effects.find(effect=>effect.deps?.[0]==='8').callback();
const stopTwo=readerFocus();const beforeTwo=readerFetches.length, preparedAhead=[];
const buffered=twoAhead.prefetch(.7,id=>preparedAhead.push(id));
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerFetches.length,beforeTwo+1);assert.equal(readerFetches.at(-1).chapter,'8');
readerFetches.at(-1).resolve();await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(preparedAhead,['8'],'the immediate neighbor becomes readable before the second download finishes');
assert.equal(readerFetches.length,beforeTwo+2);assert.equal(readerFetches.at(-1).chapter,'9');
assert.equal(readerFetches.at(-1).automatic,true);
readerFetches.at(-1).resolve();await buffered;
assert.deepEqual(preparedAhead,['8','9']);
assert.equal(twoAhead.prefetch(.9),undefined,'repeated progress events cannot extend the buffer beyond two');
stopTwo();

let retryRevision=1,retryFocus,replayed=0;const verificationRoutes=[];
const verifiedRetry=component('../src/components/use-source-retry.ts',{
  'expo-router':{router:{push:route=>verificationRoutes.push(route)},useFocusEffect:callback=>{retryFocus=callback;}},
  '../lib/app-state':{useShelf:()=>({sourceSessionRevision:retryRevision})},
});
const beginVerify=()=>{const start=verifiedRetry.render('useSourceRetry',()=>replayed++);verifiedRetry.effects.forEach(effect=>effect.callback());return start;};
let verify=beginVerify();retryFocus();verify();verify();assert.equal(verificationRoutes.length,1,'rapid taps cannot stack duplicate verification screens');assert.equal(verificationRoutes.at(-1),'/verify-source');
retryRevision++;beginVerify();retryFocus();assert.equal(replayed,1,'successful verification replays the original operation once on return');
retryFocus();assert.equal(replayed,1,'subsequent focus changes cannot repeatedly replay a failed request');
verify=beginVerify();verify();beginVerify();retryFocus();assert.equal(replayed,1,'backing out of verification does not retry');
retryRevision++;beginVerify();retryFocus();assert.equal(replayed,1,'a later unrelated verification cannot revive a cancelled retry');
console.log('Two-chapter sequential prefetch and one-shot verification retry checks passed');

// Update discovery stays quiet on metered connections and keeps a validated
// cached offer across app launches. Manual checks bypass the daily throttle.
const updatePolicy=await import('../src/lib/app-update-policy.ts');
const installedUpdate={version:'2.0.6',versionCode:23,architecture:'armv7',canInstall:false};
const publishedUpdate={version:'2.0.7',architecture:'armv7',url:'https://github.com/NaiJii/nightshelf/releases/download/v2.0.7/NightShelf-2.0.7-armv7.apk',sha256:'a'.repeat(64),size:40000000,notes:'Changes'};
const updateReleases=[{tag_name:'v2.0.7',draft:false,prerelease:false,body:'Changes',assets:[{name:'NightShelf-2.0.7-armv7.apk',state:'uploaded',browser_download_url:publishedUpdate.url,digest:'sha256:'+publishedUpdate.sha256,size:publishedUpdate.size}]}];
let updateNetwork={type:'cellular',isConnected:true}, updateRequests=0, updateConsent=0, updateCache='', updateHttpOk=true;
const updatePreferences={autoAppUpdates:true};
const updateModules={
 'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
 '@react-native-community/netinfo':{__esModule:true,default:{fetch:async()=>updateNetwork,addEventListener:()=>()=>{}}},
 'expo-file-system':{File:class{textSync(){return updateCache;}write(text){updateCache=text;}},Directory:class{exists=false;},Paths:{cache:'file:///cache/'}},
 '../lib/app-state':{useShelf:()=>({preferences:updatePreferences})},
 '../lib/storage':{ROOT:{create(){}}},'../lib/network':{networkGuard:()=>async()=>{updateConsent++;}},
 '../lib/app-updates':{installedApp:()=>installedUpdate},'../lib/app-update-policy':updatePolicy,
};
const updateGlobals={fetch:async()=>{updateRequests++;return {ok:updateHttpOk,status:updateHttpOk?200:403,json:async()=>updateReleases};}};
const updateProvider=component('../src/components/app-updates-provider.tsx',updateModules,updateGlobals);
const updater=()=>updateProvider.render('AppUpdatesProvider',{}).props.value;
await updater().check();assert.equal(updateRequests,0,'automatic update checks do not use mobile data');
updateNetwork={type:'wifi',isConnected:true,details:{isConnectionExpensive:false}};
await updater().check();assert.equal(updateRequests,1);assert.equal(updater().update.version,'2.0.7');
await updater().check();assert.equal(updateRequests,1,'reopening within 24 hours cannot repeatedly call GitHub');
updatePreferences.autoAppUpdates=false;await updater().check(true);
assert.equal(updateRequests,2);assert.equal(updateConsent,1,'manual checks honor the existing connection consent policy');
updateHttpOk=false;await updater().check(true);
assert.match(updater().error,/limiting/);assert.equal(updater().update.version,'2.0.7','a failed check preserves the last valid update offer');
const reopenedUpdateProvider=component('../src/components/app-updates-provider.tsx',updateModules,updateGlobals);
assert.equal(reopenedUpdateProvider.render('AppUpdatesProvider',{}).props.value.update.version,'2.0.7','a cached update survives reopening offline');

let apkFile=false, apkSize=publishedUpdate.size, badUpdateHash=false, permissionResult='installer', appStateCallback;
const installationCalls=[], verifiedUpdates=[], deletedUpdates=[];
let updateFocus, waitForApk=false, finishApk;
const fakeUpdater={verify:async(...args)=>{verifiedUpdates.push(args);if(badUpdateHash)throw Error('Update checksum mismatch');return true;},install:async(...args)=>{installationCalls.push(args);return permissionResult;}};
const installerModules={
 'react-native':{ActivityIndicator:'ActivityIndicator',Text:'Text',View:'View',AppState:{currentState:'active',addEventListener:(_,callback)=>{appStateCallback=callback;return {remove(){}};}}},
 'expo-router':{router:{},useFocusEffect:callback=>{updateFocus=callback;}},
 '@react-native-community/netinfo':{__esModule:true,default:{fetch:async()=>({type:'wifi',isConnected:true}),addEventListener:()=>()=>{}}},
 'expo-file-system/legacy':{cacheDirectory:'file:///cache/',makeDirectoryAsync:async()=>{},deleteAsync:async uri=>{apkFile=false;deletedUpdates.push(uri);},getInfoAsync:async()=>({exists:apkFile,size:apkSize}),getContentUriAsync:async()=> 'content://com.ji.nightshelf.FileSystemFileProvider/cache/update.apk',createDownloadResumable:()=>({downloadAsync:async()=>{if(waitForApk)await new Promise(resolve=>{finishApk=resolve;});apkFile=true;return {status:200};},cancelAsync:async()=>{}})},
 '../components/app-updates-provider':{useAppUpdates:()=>({installed:installedUpdate,update:publishedUpdate,check(){}})},
 '../components/ui':{color:{},Icon:'Icon',Page:'Page',ui:{}},
 '../lib/app-updates':{appUpdates:fakeUpdater,installedApp:()=>installedUpdate},
 '../lib/network':{networkGuard:()=>async()=>{}},'../lib/storage':{loadPreferences:()=>({mobileData:'ask'})},
 '../lib/library-tools':{formatBytes:()=> '40 MB',freeBytes:()=>1024**3},
};
const installer=component('../src/app/app-update.tsx',installerModules);
const installView=()=>nodes(installer.render('default',{}));
const downloadUpdate=()=>installView().find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Download and install')).props.onPress();
downloadUpdate();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(verifiedUpdates.length,2,'both download completion and installation revalidate the APK');
assert.equal(installationCalls.length,1);assert.equal(verifiedUpdates[0][1],publishedUpdate.sha256);
assert.ok(installationCalls[0][1].startsWith('content://'),'the installer receives a granted content URI rather than a private file path');

badUpdateHash=true;apkFile=false;
const invalidInstaller=component('../src/app/app-update.tsx',installerModules);
nodes(invalidInstaller.render('default',{})).find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Download and install')).props.onPress();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(installationCalls.length,1,'a failed checksum can never launch the installer');
assert.equal(apkFile,false,'failed update downloads are deleted');
assert.ok(nodes(invalidInstaller.render('default',{})).some(node=>node.props?.children==='Update checksum mismatch'));

badUpdateHash=false;permissionResult='permission';apkFile=false;
const permissionInstaller=component('../src/app/app-update.tsx',installerModules);
nodes(permissionInstaller.render('default',{})).find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Download and install')).props.onPress();
await new Promise(resolve=>setTimeout(resolve,0));
permissionInstaller.render('default',{});permissionInstaller.effects[1].callback();
installedUpdate.canInstall=true;permissionResult='installer';const beforePermission=installationCalls.length;
appStateCallback('active');appStateCallback('active');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(installationCalls.length,beforePermission+1,'granting installation permission resumes once without stacking installer prompts');
console.log('Automatic Wi-Fi update checks, daily throttling, caching, APK validation failures and installer permission recovery passed');

waitForApk=true;apkFile=false;
const blurredUpdater=component('../src/app/app-update.tsx',installerModules);
const blurredView=()=>nodes(blurredUpdater.render('default',{}));
blurredView();const blurUpdate=updateFocus();
blurredView().find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Download and install')).props.onPress();
await new Promise(resolve=>setTimeout(resolve,0));
const installsBeforeBlur=installationCalls.length;
blurUpdate();finishApk();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(installationCalls.length,installsBeforeBlur,'an update finishing behind the reader cannot open the Android installer');
assert.ok(blurredView().some(node=>node.props?.children==='Install update'),'the verified download remains ready for later installation');
console.log('Update downloads finishing outside the update screen never interrupt reading');

const retryPrefetch=readerNavigation.render('useReaderNavigation','retry-story','Retry story','10');
readerNavigation.effects.find(effect=>effect.deps?.[0]==='10').callback();
const stopRetryPrefetch=readerFocus();
const failedPrefetch=retryPrefetch.prefetch(.75);await new Promise(resolve=>setTimeout(resolve,0));
readerFetches.at(-1).reject(Error('Waiting for Wi-Fi'));await failedPrefetch;
assert.equal(retryPrefetch.prefetch(.8),undefined,'failed speculative downloads have a cooldown instead of retrying on every scroll');
readerShelf.connection={label:'Wi-Fi'};
const recoveredPrefetch=readerNavigation.render('useReaderNavigation','retry-story','Retry story','10');
readerNavigation.effects.find(effect=>effect.deps?.[0]==='Wi-Fi').callback();
const beforeRetry=readerFetches.length;
const retriedPrefetch=recoveredPrefetch.prefetch(.8);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerFetches.length,beforeRetry+1,'returning to Wi-Fi makes a failed prefetch eligible again');
readerFetches.at(-1).resolve();await retriedPrefetch;
stopRetryPrefetch();
console.log('Failed prefetch cooldown and connection recovery passed');
