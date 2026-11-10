import * as downloadDisplay from "../src/lib/download-display.ts";
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
import * as readRetention from "../src/lib/read-retention.ts";
import * as requestControl from "../src/lib/request-control.ts";
import * as appUpdatePolicy from "../src/lib/app-update-policy.ts";

function component(file, extraModules = {}, globals = {}, expose = []) {
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
    "react-native": Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "View", "FlatList", "TextInput", "ActivityIndicator", "Switch"].map(name => [name, name])),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./ui": { color: {}, ui: {}, Icon: "Icon" },
    "./reader-transfers": {cancelReaderTransfer:()=>false,beginReaderTransfer:()=>({progress(){},finish(){}})},
    ...extraModules,
  };
  const exports = {};
  const script = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8") + expose.map(name=>`\nexport { ${name} };`).join(''), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(script, { exports, AbortController, Error, setTimeout, clearTimeout, ...globals, require: name => { if (name.endsWith("/read-retention")) return readRetention; if (name.endsWith("/provider-info")) return providerInfo; if (name.endsWith("/provider-errors")) return providerErrors; if (name.endsWith("/pressable") || name === "./pressable") return {Pressable:"Pressable"}; if (name.endsWith('/download-display')) return downloadDisplay;
assert.ok(modules[name], name); return modules[name]; } });
  return { exports, effects, render(name, ...args) { cursor = 0; effects.length = 0; return exports[name](...args); } };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
{
  let requests = 0;
  let connection = {type:'wifi',isConnected:true,isInternetReachable:true,details:{}};
  const preferences = {autoAppUpdates:true};
  const makeUpdates = () => component('../src/components/app-updates-provider.tsx', {
    'react-native': {AppState:{currentState:'active'}},
    '@react-native-community/netinfo': {fetch:async()=>connection},
    'expo-file-system': {File:class {textSync(){return JSON.stringify({checkedAt:Date.now()});} write(){}},Directory:class {},Paths:{}},
    '../lib/app-state': {useShelf:()=>({preferences})},
    '../lib/storage': {ROOT:{create(){}}},
    '../lib/network': {networkGuard:()=>async()=>{}},
    '../lib/app-updates': {installedApp:()=>({version:'2.0.9',architecture:'arm64'})},
    '../lib/app-update-policy': appUpdatePolicy,
  }, {fetch:async()=>{requests++;return {ok:true,json:async()=>[]};}});
  const updates = makeUpdates();
  const state = () => updates.render('AppUpdatesProvider',{children:null}).props.value;
  await state().check();
  assert.equal(requests,1,'fresh startup checks even when the disk cache was checked today');
  await state().check();
  assert.equal(requests,1,'repeated foreground/network events do not duplicate a successful startup check');
  const offlineUpdates = makeUpdates();
  connection = {...connection,isConnected:false};
  await offlineUpdates.render('AppUpdatesProvider',{}).props.value.check();
  assert.equal(requests,1,'offline startup stays quiet');
  connection = {...connection,isConnected:true};
  await offlineUpdates.render('AppUpdatesProvider',{}).props.value.check();
  assert.equal(requests,2,'reconnection can complete the pending startup check');
  preferences.autoAppUpdates = false;
  await makeUpdates().render('AppUpdatesProvider',{}).props.value.check();
  assert.equal(requests,2,'automatic update preference remains respected');
}
const touch=component('../src/components/pressable.tsx');
const touchHandler=()=>{};
const touchButton=touch.render('Pressable',{onPress:touchHandler,accessibilityLabel:'Bookmark',disabled:false,style:{minHeight:48}});
let stoppedPropagation=false;
assert.equal(typeof touchButton.props.onPress,'function');
touchButton.props.onPress({stopPropagation:()=>{stoppedPropagation=true;}});
assert.equal(stoppedPropagation,true,'nested icon presses cannot activate the containing row');
assert.equal(touchButton.props.pressRetentionOffset,8,'drifting off an icon cancels before reaching an unrelated control');
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
  '../../lib/reading-ux': readingUx,
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

let sheetPath = "/series/example";
const sheets = component("../src/components/action-sheet.tsx", {"expo-router":{usePathname:()=>sheetPath}});
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
show('Old screen',undefined,[{text:'Stale action',onPress:()=>chosen++}]);
const staleAction=nodes(renderSheet()).find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Stale action'));
sheetPath='/library';renderSheet();sheets.effects.forEach(effect=>effect.callback());
assert.equal(nodes(renderSheet()).find(node=>node.type==='Modal').props.visible,false,'navigation dismisses the previous screen menu');
staleAction.props.onPress();assert.equal(chosen,1,'a queued press on an old menu cannot execute its action');

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
let catalogHydrations=0, nativePoll;
let resolveNetwork;
const provider = component('../src/lib/app-state.tsx', {
  'expo-router': {usePathname:()=>route},
  'react-native': {AppState:{currentState:'active'}},
  '@react-native-community/netinfo': {__esModule:true,default:{fetch:()=>new Promise(resolve=>{resolveNetwork=resolve;})}},
  './parser': parser,
  './release-policy': releasePolicy,
  './storage': {catalogMetadata:()=>[story],loadCatalogAsync:async()=>{catalogHydrations++;return [story];},loadCatalog:()=>[story],loadPreferences:()=>settings,savePreferences:value=>{settings=value;},savedStories:()=>({example:{bookmarked:true,autoDownload:true,autoDownloadBaseline:['1']}}),readChapters:()=>({}),releaseUpdates:()=>({example:['2']}),loadDownloads:()=>[],deleteChapters:(...args)=>localDeletions.push(args)},
  './scraper': {refreshSeries:(_item,_guard,signal)=>{detailsSignal=signal;return new Promise((_,reject)=>{rejectDetails=reject;});},syncCatalog:()=>new Promise((_,reject)=>{rejectSync=reject;})},
  './network': {networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy': {connectionLabel:()=>({label:'Offline'})},
  './releases': {configureReleaseChecks:async()=>{}},
  './download-queue': {restoredDownloads:()=>[],DownloadQueue:class {jobs=[];isBusy(){return false;}pause(){}enqueue(...args){automaticQueued.push(args);} }},
  './request-control': requestControl,
  './background-downloads': nativeControls,
  './library-tools': {},
}, {setInterval:callback=>{nativePoll=callback;return 0;},clearInterval(){}});
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
app();provider.effects.find(effect=>effect.deps?.length===6).callback();
const deletionPending=app().removeDownloads(story,['1']);
resolveNetwork({type:'wifi',isConnected:true});
await deletionPending;
assert.equal(localDeletions.length,1);
app().downloadQueue.jobs.push({series:story,selection:'2',chapters:['2'],status:'downloading'});
assert.equal(await app().removeDownloads(story,['1']),true,'an unrelated chapter can be deleted while the same series downloads');
assert.equal(await app().removeDownloads(story,['2']),false,'a chapter in the download plan cannot be deleted underneath its writer');
assert.equal(await app().removeDownloads(story,[],true),false,'whole-series deletion still protects active writers');
assert.equal(await app().removeDownloads({...story,slug:'other'},['1']),true,'another series download never blocks deletion');
app().downloadQueue.jobs.length=0;
assert.equal(automaticQueued.length,0,'automatic transfers cannot start writing while files are being deleted');
app();provider.effects.find(effect=>effect.deps?.length===6).callback();resolveNetwork({type:'wifi',isConnected:true});
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
const readerSaved=new Set(['1']);let readerFocus, navigationAppEvent;
const readerShelf={connection:{label:'Wi-Fi'},preferences:{readerContinuous:true,readerPrefetch:true},fetchReaderChapter:(slug,chapter,automatic,signal,progress)=>new Promise((resolve,reject)=>{
  readerFetches.push({slug,chapter,automatic,signal,progress,reject,resolve:()=>{readerSaved.add(chapter);resolve();}});
  signal.addEventListener('abort',()=>reject(Object.assign(new Error('Cancelled'),{name:'AbortError'})),{once:true});
})};
const readerNavigation=component('../src/components/use-reader-navigation.ts',{
  'react-native':{AppState:{currentState:'active',addEventListener:(_name,callback)=>{navigationAppEvent=callback;return {remove(){}};}}},
  'expo-router':{router:{replace:route=>readerRoutes.push(route),push:route=>readerRoutes.push({...route,pushed:true})},useFocusEffect:callback=>{readerFocus=callback;}},
  '../lib/app-state':{useShelf:()=>readerShelf},
  '../lib/storage':{chapterIntact:(_,chapter)=>readerSaved.has(chapter)},
  '../lib/parser':parser,
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
const originalReaderFetch=readerShelf.fetchReaderChapter;
const delayedReaderRequests=[];
readerShelf.fetchReaderChapter=(_slug,id,_automatic,signal)=>new Promise(resolve=>delayedReaderRequests.push({signal,resolve:()=>{if(!signal.aborted)readerSaved.add(id);resolve();}}));
nav=readerNavigation.render('useReaderNavigation','example','Example','8',undefined,true);
const blurSlowReader=readerFocus();
nav.go('8',true);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerNav().busy,true);
blurSlowReader();readerNav();readerFocus();
assert.equal(readerNav().busy,false,'returning after cancellation cannot leave a stuck reader spinner');
const beforeSlowRoutes=readerRoutes.length;
nav=readerNavigation.render('useReaderNavigation','example','Example','8',undefined,true);
nav.go('8',true);await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(delayedReaderRequests.length,1,'replacement reader request waits for the cancelled writer to drain');
delayedReaderRequests[0].resolve();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(delayedReaderRequests.length,2,'an aborted same-chapter promise is replaced instead of reused');
assert.equal(readerRoutes.length,beforeSlowRoutes,'an old request cannot navigate after refocusing the screen');
delayedReaderRequests[1].resolve();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.length,beforeSlowRoutes+1,'the new request can open the chapter normally');
readerShelf.read={example:{'8':'read'}};
nav=readerNavigation.render('useReaderNavigation','example','Example','8',undefined,true);
nav.go('8');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerRoutes.at(-1).params.entry,'start','Read again starts at the beginning of a completed chapter');
readerShelf.fetchReaderChapter=originalReaderFetch;readerSaved.delete("8");delete readerShelf.read;
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
  './storage':{catalogMetadata:()=>[readerStory],loadCatalogAsync:async()=>[readerStory],loadPreferences:()=>({source:'asura',deleteAfterReading:true,autoDownloadLimitMB:2048}),savedStories:()=>({}),readChapters:()=>({example:{'1':new Date(Date.now()-25*3600_000).toISOString()}}),releaseUpdates:()=>({}),loadDownloads:()=>[],localChapters:()=>['1'],chapterIntact:(_,chapter)=>intactReaderChapters.has(chapter),deleteChapters:(...args)=>readerDeletions.push(args)},
  './scraper':{downloadChapters:async(...args)=>{await args[3]();directReaderCalls.push(args);await new Promise(resolve=>{closeReaderWriter=resolve;});requestControl.throwIfAborted(args[4]);intactReaderChapters.add(args[1]);}},
  './network':{networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy':{connectionLabel:()=>({label:'Wi-Fi'})},
  './releases':{requestReleasePermission:async()=>true},'./download-queue':{restoredDownloads:()=>[],DownloadQueue:class{jobs=[];isBusy(){return false;}async holdForReader(){readerPriority.push('hold');return ()=>readerPriority.push('release');}}},
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
assert.equal(await readerApp().removeDownloads(readerStory,['1']),true,'reader prefetch only protects the chapter it is writing');
readerDeletions.length=0;
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

const deletedRead=[];
shelf.removeDownloads=async(...args)=>{deletedRead.push(args);return true;};
shelf.read.example={'1':'read','2':'read'};
header().find(node=>node.props?.accessibilityLabel==='Chapter actions').props.onPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Delete read chapters (1)').onPress();
assert.equal(deletedRead.length,0,'per-story read deletion requires confirmation');
chapterSheets.at(-1)[2].find(action=>action.text==='Delete').onPress();
assert.equal(JSON.stringify(deletedRead[0][1]),JSON.stringify(['1']),'only saved read chapters of this series are removed');
console.log('Per-series saved read deletion confirmation and scope passed');

const switchRows=component('../src/components/toggle-row.tsx');
let switchValue=false;const switchChanges=[];
const drawSwitch=()=>switchRows.render('ToggleRow',{title:'Delete after reading',description:'Only completed chapters',value:switchValue,onValueChange:value=>{switchValue=value;switchChanges.push(value);}});
let switchRow=drawSwitch();
assert.equal(switchRow.props.style.width,'100%','setting rows use all available content width');
nodes(switchRow).find(node=>node.type==='Pressable').props.onPress();
switchRow=drawSwitch();
assert.equal(nodes(switchRow).find(node=>node.type==='Switch').props.value,true,'label taps update the same controlled switch');
nodes(switchRow).find(node=>node.type==='Switch').props.onValueChange(false);
assert.deepEqual(switchChanges,[true,false],'label and native switch each produce exactly one toggle');
const disabledSetting=nodes(switchRows.render('ToggleRow',{title:'Notifications',value:true,busy:true,onValueChange:()=>{}}));
assert.ok(disabledSetting.find(node=>node.type==='Switch').props.disabled);
assert.ok(disabledSetting.find(node=>node.type==='Pressable').props.disabled,'busy settings block both label and switch');
const ownStyle={backgroundColor:'transparent',borderRadius:0};
const checkedButton=touch.render('Pressable',{style:ownStyle,accessibilityState:{checked:true}});
assert.equal(checkedButton.props.style({pressed:false})[0],ownStyle,'generic checked buttons cannot replace their component styling');
assert.equal(checkedButton.props.style({pressed:false}).filter(Boolean).length,1,'checked semantics do not inject a permanent highlight');
const readerToggleSettings=component('../src/components/reader-options.tsx',{
  './toggle-row':{ToggleRow:'ToggleRow'},
  '../lib/app-state':{useShelf:()=>({preferences:{readerBrightness:-1,readerVolumeScroll:true,readerPrefetch:true,deleteAfterReading:false},updatePreferences:()=>{}})},
  '../lib/reader-controls':{readerControls:null},
  'expo-router':{useFocusEffect:()=>{}},'react-native-webview':{},
});
const readerOptions=nodes(readerToggleSettings.render('ReaderOptions',{error:''}));
assert.equal(readerOptions.filter(node=>node.type==='ToggleRow').length,3,'all reader boolean options share the switch row');
assert.ok(!readerOptions.some(node=>node.props?.accessibilityRole==='checkbox'));
console.log('Full-width switch rows, label and switch interactions, busy states and highlight isolation passed');

row('2').find(node=>node.props?.accessibilityLabel==='Actions for chapter 2').props.onPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Select from here').onPress();
assert.equal(row('2').find(node=>node.props?.accessibilityLabel==='Select chapter 2').props.accessibilityState.checked,true);
assert.equal(row('125.5').find(node=>node.props?.accessibilityLabel==='Select chapter 125.5').props.accessibilityState.checked,true);
row('1').find(node=>node.props?.accessibilityLabel==='Actions for chapter 1').props.onPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Select range to here').onPress();
assert.equal(row('1').find(node=>node.props?.accessibilityLabel==='Select chapter 1').props.accessibilityState.checked,true);
assert.equal(row('125.5').find(node=>node.props?.accessibilityLabel==='Select chapter 125.5').props.accessibilityState.checked,false);
row('2').find(node=>node.props?.accessibilityLabel==='Actions for chapter 2').props.onPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Mark previous chapters read').onPress();
chapterSheets.at(-1)[2].find(action=>action.text==='Mark read').onPress();
assert.ok(shelf.read.example['1']);
const displayJob={series:story,selection:'1-2',status:'downloading',progress:.3,message:story.title+' · 2 · 3/10',currentChapter:'2',chapterProgress:.3,completedChapters:1,totalChapters:2};
assert.deepEqual(downloadDisplay.queuedChapters(displayJob),['1','2']);
assert.equal(downloadDisplay.downloadDetail(displayJob),'Chapter 2 · 3/10 panels · 1 chapter left');
assert.match(downloadDisplay.downloadDetail({...displayJob,status:'waiting',message:'Retrying automatically · Image request failed (503)'}),/Retrying automatically/,'retry reasons stay visible alongside chapter context');
console.log('Visible chapter actions, range selection, previous-read actions and contextual download labels passed');

const compactJobs=[{series:story,selection:'1',status:'downloading',message:'Saving chapter 1',progress:.25}];
const queueActions=[], stopSheets=[];
const compactDownloads=component('../src/components/download-list.tsx',{
  '../lib/app-state':{useDownloads:()=>compactJobs,useShelf:()=>({pauseDownload:slug=>queueActions.push(['pause',slug]),resumeDownload:slug=>queueActions.push(['resume',slug]),cancelDownload:(...args)=>queueActions.push(['stop',...args]),moveDownload:()=>{}})},
  './series-card':{openSeries:()=>{}},'../lib/parser':parser,
  './action-sheet':{useActionSheet:()=>(...args)=>stopSheets.push(args)},
  '../lib/background-downloads':{queueSummary:()=>({total:1,completed:0,progress:.25})},
  'expo-router':{router:{}},
});
let compactNodes=nodes(compactDownloads.render('DownloadList',{showHeading:false}));
assert.equal(compactNodes.filter(node=>node.type==='Text'&&node.props.children==='Downloads').length,0,'the drawer has one download heading');
assert.equal(compactNodes.filter(node=>node.type==='Text'&&node.props.children===story.title).length,1,'each download title appears once');
assert.equal(compactNodes.filter(node=>node.props?.accessibilityRole==='progressbar').length,1,'one pending job has one progress bar');
compactNodes.find(node=>node.props?.accessibilityLabel==='Pause Example').props.onPress();
assert.deepEqual(queueActions,[['pause','example']]);
const stopControl=compactNodes.find(node=>node.props?.accessibilityLabel==='Stop Example');
assert.equal(stopControl.props.style.minWidth,44,'compact icon controls retain comfortable tap targets');
stopControl.props.onPress();assert.equal(queueActions.length,1,'compact Stop still opens a confirmation');
stopSheets.at(-1)[2].find(action=>action.text==='Stop · keep files').onPress();
assert.deepEqual(queueActions.at(-1),['stop','example']);
compactJobs[0]={...compactJobs[0],status:'error',message:'Image request failed (403)'};
compactNodes=nodes(compactDownloads.render('DownloadList',{showHeading:false}));
assert.ok(compactNodes.some(node=>node.props?.children==='Image request failed (403)'),'compact layout preserves actionable failure text');
compactNodes.find(node=>node.props?.accessibilityLabel==='Retry Example').props.onPress();
assert.deepEqual(queueActions.at(-1),['resume','example']);
console.log('Compact download controls preserve labels, actions, error details and stop confirmation');
const readerWrites=[], readerCompletions=[], readerScripts=[], readerFocusEffects=[], chromeVisibility=[];
const readerLifecycle={currentState:'active',addEventListener:(_name,callback)=>{readerLifecycle.callback=callback;return {remove(){}};}};
let readerHistory={example:{chapter:'1',fraction:0.4,chapters:{'1':{fraction:0.4},'2':{fraction:0.7}}}};
const chapterView=component('../src/app/reader/[slug]/[chapter].tsx',{
  'react-native':{View:'View',Text:'Text',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',Animated:{},AppState:readerLifecycle},
  'react-native-webview':{WebView:'WebView'},
  'expo-router':{router:{},Stack:{Screen:'Screen'},useFocusEffect:callback=>readerFocusEffects.push(callback)},
  '../../../lib/storage':{chapterDirectory:()=>({uri:'file:///reader'}),chapterFiles:()=>['file:///1.webp','file:///2.webp'],novelChapter:()=>null,localChapters:()=>['1','2'],chapterIntact:()=>true,readingHistory:()=>readerHistory,savePosition:(...args)=>readerWrites.push(args)},
  '../../../lib/parser':parser,
  '../../../lib/reader-html':{readerHtml:()=>'<html/>',readerChapterHtml:()=>'<section/>'},
  '../../../lib/reader-controls':{readerControls:null},
  '../../../components/ui':{ui:{},color:{},Icon:'Icon'},
  '../../../lib/app-state':{useShelf:()=>({preferences:{readerContinuous:true},read:{},catalog:[{...story,chapterIds:['1','2','3']}],saved:{},detailsLoading:[],detailsErrors:{},loadDetails:()=>{},cancelDetails:()=>{},leaveChapter:()=>{},completeChapter:(...args)=>readerCompletions.push(args)})},
  '../../../components/action-sheet':{useActionSheet:()=>()=>{}},
  '../../../components/use-reader-navigation':{useReaderNavigation:()=>({prefetch(){}})},
  '../../../components/reader-options':{useReaderConveniences:()=>'',ReaderOptions:'ReaderOptions'},
}, {}, ['ChapterReader']);
const readerTree=chapterView.render('ChapterReader',{slug:'example',chapter:'1',hidden:true,setHidden:value=>chromeVisibility.push(value),optionsOpen:false,setOptionsOpen(){}});
const readerWeb=nodes(readerTree).find(node=>node.type==='WebView');
readerWeb.props.ref.current={injectJavaScript:script=>readerScripts.push(script)};
readerFocusEffects.forEach(callback=>callback());
const message=data=>readerWeb.props.onMessage({nativeEvent:{data:JSON.stringify(data)}});
readerWeb.props.onLoadEnd();
message({chapter:'1',fraction:0.5});
assert.deepEqual(readerWrites.at(-1),['example','1',0.5],'progress writes work without a native event timestamp');
message({chapter:'1',fraction:0.6});
readerLifecycle.currentState='background';readerLifecycle.callback('background');
assert.deepEqual(readerWrites.at(-1),['example','1',0.6],'backgrounding flushes the latest debounced progress');
message({chapter:'1',fraction:1,complete:true,snapshot:true});
assert.deepEqual(readerCompletions.at(-1),['example','1'],'a completion immediately before backgrounding is retained by its snapshot');
readerLifecycle.currentState='active';readerLifecycle.callback('active');
assert.equal(chromeVisibility.at(-1),false,'returning to the app restores visible reader controls');
message({chapter:'1',fraction:0.65});message({activeChapter:'2'});
assert.deepEqual(readerWrites.at(-1),['example','1',0.65],'a continuous chapter transition flushes the outgoing chapter first');
readerWeb.props.onLoadStart();
const beforeReload=readerWrites.length;
message({chapter:'1',fraction:0});
assert.equal(readerWrites.length,beforeReload,'reloading HTML cannot overwrite stored progress with its initial zero');
readerWeb.props.onLoadEnd();
assert.ok(readerScripts.some(script=>script.includes('readerRestorePosition?.("2",0.7)')),'WebView reload restores the active continuous chapter and its saved position');
console.log('Reader lifecycle, timestamp-free progress, background completion and WebView reload recovery passed');
nativeControls.backgroundTransfers={};
const pollQueue=app().downloadQueue;
const pollingJob={series:story,native:true,status:'downloading',progress:0.1,completedChapters:0};
pollQueue.jobs=[pollingJob];pollQueue.pump=()=>{};
pollQueue.reconcileNative=()=>{pollingJob.progress=0.2;};
const beforeHydration=catalogHydrations;
app();const stopNativePoll=provider.effects.find(effect=>effect.deps?.length===2&&effect.deps[0]===pollQueue).callback();
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(catalogHydrations,beforeHydration,'percentage-only updates never rescan the entire library');
pollQueue.reconcileNative=()=>{pollingJob.completedChapters=1;};
nativePoll();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(catalogHydrations,beforeHydration+1,'finishing a chapter refreshes its saved-file state');
stopNativePoll();pollQueue.jobs=[];
console.log('Native progress polling avoids library scans until chapter or transfer state changes');
let closingClock=0;
const closingState={active:true,hasPlan:true,state:'running'};
const closingNative={states:()=>JSON.stringify({job:closingState}),pause:async()=>{}};
const nativeClosing=component('../src/lib/background-downloads.ts',{
  expo:{NativeModule:class{},requireOptionalNativeModule:()=>closingNative},
  './network':{NetworkPaused:class extends Error{}},'./request-control':requestControl,
},{Date:{now:()=>closingClock+=30001}});
await assert.rejects(nativeClosing.render('stopTransfer','job'),/files were kept/i,'an unresponsive Android writer cannot leave cancellation spinning forever');
closingNative.pause=async()=>{closingState.active=false;};
await nativeClosing.render('stopTransfer','job');

let storageFocus;
const storageSheets=[], storageDeletes=[], summaries=[];
let scannedFiles=0;
const storageStory={...story,localChapters:['1','2','3'],hasLocalFiles:true};
let storageJobs=[{series:storageStory,chapters:['2'],selection:'2',status:'downloading'}];
const storageView=component('../src/app/storage.tsx',{
  'expo-router':{router:{},useFocusEffect:callback=>{storageFocus=callback;}},
  '../components/action-sheet':{useActionSheet:()=>(...args)=>storageSheets.push(args)},
  '../components/ui':{Page:'Page',ui:{},color:{},Icon:'Icon'},
  '../lib/app-state':{useDownloads:()=>storageJobs,useShelf:()=>({read:{example:{'1':'read','2':'read','3':'read'}},catalog:[storageStory],deleting:false,downloadBusy:()=>Boolean(storageJobs.length),startDownload(){},removeDownloads:async(...args)=>{storageDeletes.push(args);return true;}})},
  '../lib/library-tools':{formatBytes:value=>String(value),storageSummaryAsync:signal=>new Promise(resolve=>summaries.push({signal,resolve})),verifyChapterFiles:()=>{scannedFiles++;return {checked:1,damaged:1};}},
});
const storageNodes=()=>nodes(storageView.render('default',{}));
storageNodes();const blurStorage=storageFocus();
summaries[0].resolve({free:100,covers:0,stories:[{item:storageStory,bytes:20}]});await new Promise(resolve=>setTimeout(resolve,0));
const deleteReadControl=storageNodes().find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Delete read'));
assert.equal(deleteReadControl.props.disabled,false,'Storage keeps unrelated read-chapter deletion available during transfers');
deleteReadControl.props.onPress();storageSheets.at(-1)[2].find(action=>action.text==='Delete').onPress();
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(storageDeletes[0][1],['1','3'],'Storage cleanup preserves only the chapters in the pending plan');
storageJobs=[];
const scanButton=storageNodes().find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Check & repair'));
scanButton.props.onPress();blurStorage();await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(scannedFiles,0,'leaving Storage cancels its scan before touching more chapters');
assert.equal(storageSheets.length,1,'cancelled scans cannot open late repair menus');
storageNodes();storageFocus();
storageNodes().find(node=>node.type==='Pressable'&&nodes(node).some(child=>child.props?.children==='Check & repair')).props.onPress();
storageNodes().find(node=>node.props?.accessibilityLabel==='Cancel file check').props.onPress();
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(scannedFiles,0,'explicit Cancel stops a pending integrity check');
assert.ok(storageNodes().some(node=>node.props?.children==='Check cancelled.'));
console.log('Bounded native cancellation, scoped Storage deletion and cancellable screen-owned integrity scans passed');
const failedNative={series:story,native:false,status:'error',chapters:['1'],selection:'1',progress:0};
pollQueue.jobs=[failedNative];nativeControls.transferStates=()=>({example:{active:true,hasPlan:true,state:'running'}});
assert.equal(await app().removeDownloads(story,['1']),false,'an error label cannot bypass the native writer deletion guard');
assert.equal(await app().removeDownloads(story,['3']),true,'native safety guards still allow chapters outside its transfer plan');
pollQueue.jobs=[];nativeControls.transferStates=()=>({});
const transferNotices=[];let stoppedReaderTransfers=0;
const transfersModule=component('../src/lib/reader-transfers.ts',{
  './background-downloads':{backgroundTransfers:{readerProgress:async(...args)=>transferNotices.push(args)}},
});
const chapterTransfer=transfersModule.render('beginReaderTransfer',story,'2',()=>stoppedReaderTransfers++);
const transferStore=transfersModule.exports.readerTransfers;
assert.equal(transferStore.getSnapshot()[0].reader,true,'reader downloads join shared indicators without entering the persisted bulk queue');
const statusBeforeProgress=transferStore.getStatusSnapshot();
chapterTransfer.progress('Chapter 2 · 1/2 pages',0.5);
assert.equal(transferStore.getSnapshot()[0].progress,0.5);
assert.equal(transferStore.getStatusSnapshot(),statusBeforeProgress,'panel progress does not rerender status-only library subscribers');
assert.equal(transfersModule.render('cancelReaderTransfer','example'),true);
assert.equal(stoppedReaderTransfers,1);
assert.equal(transferStore.getSnapshot()[0].status,'cancelling');
chapterTransfer.finish();chapterTransfer.progress('Late callback',0.9);
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(transferStore.getSnapshot().length,0);
assert.equal(transferNotices.at(-1)[4],true,'notification updates finish with dismissal, never a resurrected late progress notification');

readerSaved.delete('mobile-chapter');readerShelf.connection={label:'Mobile data',warning:true};
nav=readerNavigation.render('useReaderNavigation','example','Example',undefined,undefined,true);readerFocus();
const confirmationsBeforeMobile=readerSheets.length;
nav.go('mobile-chapter');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(readerSheets.length,confirmationsBeforeMobile,'cellular reading uses one connection confirmation instead of stacking a generic download confirmation');
const mobileRequest=readerFetches.at(-1);
mobileRequest.progress('Saving panels',0.5);
assert.equal(readerNavigation.render('useReaderNavigation','example','Example',undefined,undefined,true).progress,0.5,'reader buttons expose actual numeric download progress');
mobileRequest.resolve();await new Promise(resolve=>setTimeout(resolve,0));
readerShelf.connection={label:'Wi-Fi'};

let notificationPermission={granted:false,status:'denied',canAskAgain:true}, permissionPrompts=0;
const permissionModule=component('../src/lib/releases.ts',{
  'expo-notifications':{setNotificationHandler(){},setNotificationChannelAsync:async()=>{},AndroidImportance:{DEFAULT:3},getPermissionsAsync:async()=>notificationPermission,requestPermissionsAsync:async()=>{permissionPrompts++;return notificationPermission;}},
  'expo-background-task':{},'expo-task-manager':{defineTask(){}},'@react-native-community/netinfo':{},
  'react-native':{},'./parser':{},'./scraper':{},'./storage':{},'./release-policy':{},'./background-downloads':{},'./library-tools':{},
});
await permissionModule.render('requestReleasePermission',false);await permissionModule.render('requestReleasePermission',false);
assert.equal(permissionPrompts,0,'downloads do not repeatedly request a denied Android notification permission');
notificationPermission={granted:false,status:'undetermined',canAskAgain:true};
await Promise.all([permissionModule.render('requestReleasePermission',false),permissionModule.render('requestReleasePermission',false)]);
assert.equal(permissionPrompts,1,'concurrent first downloads share one Android permission request');
console.log('Single cellular confirmation, shared reader progress, cancellation, notification cleanup and permission deduplication passed');
const homeChapterRoutes=[], homeReads=[];
const resumeShortcut=component('../src/components/reading-shortcut.tsx',{
  'expo-router':{router:{push:route=>homeChapterRoutes.push(route)}},
  '../lib/app-state':{useShelf:()=>({read:{example:{}}})},
  '../lib/parser':parser,'../lib/reading-ux':readingUx,
  '../lib/storage':{readingHistory:()=>({example:{chapter:'1',fraction:0}})},
  './use-reader-navigation':{useReaderNavigation:()=>({busy:false,status:'',go:id=>homeReads.push(id)})},
});
const resumeHomeNodes=nodes(resumeShortcut.render('ReadingShortcut',{item:story,chapter:'1'}));
const resumeHomeButton=resumeHomeNodes.find(node=>node.props?.accessibilityLabel==='Resume chapter 1 · Example');
assert.ok(resumeHomeButton,'a previously opened first panel is resumable even at zero percent');
const homeChapterButton=resumeHomeNodes.find(node=>node.props?.accessibilityLabel==='Chapter list for Example');
assert.ok(!nodes(resumeHomeButton).includes(homeChapterButton),'the rightmost chapter control is separate from the resume tap target');
homeChapterButton.props.onPress();assert.equal(homeReads.length,0);
assert.equal(homeChapterRoutes.at(-1).params.chapters,'1','the shortcut requests the chapter-list anchor');
resumeHomeButton.props.onPress();assert.deepEqual(homeReads,['1']);
console.log('Home Resume label and separate right-aligned chapter-list navigation passed');
let alertPermission=async()=>true;
let alertPrefs={source:'asura',releaseNotifications:false,mobileData:'ask'};
const alertFlags={example:{bookmarked:true,autoDownload:true,notifyReleases:false}};
const alertState=component('../src/lib/app-state.tsx',{
  'expo-router':{usePathname:()=>'/series/example'},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Alert:{alert(){throw Error('unexpected permission alert');}}},
  '@react-native-community/netinfo':{},'./parser':parser,'./release-policy':releasePolicy,
  './storage':{catalogMetadata:()=>[story],loadPreferences:()=>alertPrefs,savePreferences:value=>{alertPrefs=value;},savedStories:()=>alertFlags,readChapters:()=>({}),releaseUpdates:()=>({}),loadDownloads:()=>[]},
  './scraper':{},'./network':{},'./network-policy':{connectionLabel:()=>({label:'Wi-Fi'})},
  './releases':{releasePermissionGranted:async()=>false,requestReleasePermission:()=>alertPermission(),configureReleaseChecks:async()=>{throw Error('Android scheduler unavailable');}},
  './download-queue':{restoredDownloads:()=>[],DownloadQueue:class{jobs=[];}},
  './request-control':requestControl,'./background-downloads':{},
  './library-tools':{updateStoryOptions:(slug,change)=>{alertFlags[slug]={...alertFlags[slug],...change};}},
});
const notificationState=()=>alertState.render('AppProvider',{}).props.value;
await notificationState().setStoryNotifications('example',true);
assert.equal(notificationState().preferences.releaseNotifications,true);
assert.equal(notificationState().saved.example.notifyReleases,true,'a background scheduler failure cannot discard the requested series notification flag');
assert.match(notificationState().notice,/Background checks are unavailable/);
releaseShelf.preferences=notificationState().preferences;releaseShelf.saved=notificationState().saved;
const litBell=nodes(releaseActions.render('ReleaseActions',{item:story})).find(node=>node.props?.accessibilityLabel==='New chapter notifications');
assert.equal(litBell.props.accessibilityState.checked,true,'the bell reflects the stored series alert state after scheduler failure');
await notificationState().setStoryNotifications('example',false);
assert.equal(notificationState().saved.example.autoDownload,true,'disabling the bell does not disable auto-download');
assert.equal(notificationState().saved.example.notifyReleases,false);
console.log('Series bell state remains correct after notification permission succeeds but background scheduling fails');
const scopedVerify=verifiedRetry.render('useSourceRetry',()=>{},'asura');verifiedRetry.effects.forEach(effect=>effect.callback());retryFocus();scopedVerify();
assert.equal(verificationRoutes.at(-1).params.source,'asura','a source-specific retry cannot open a different provider verification page');
let acceptAlertPermission;
alertPermission=()=>new Promise(resolve=>{acceptAlertPermission=resolve;});
const staleEnable=notificationState().setStoryNotifications('example',true);
await notificationState().setStoryNotifications('example',false);acceptAlertPermission(true);await staleEnable;
assert.equal(notificationState().saved.example.notifyReleases,false,'late permission approval cannot undo a newer bell-off choice');
const staleBookmarkEnable=notificationState().setStoryNotifications('example',true);
notificationState().setStoryOptions('example',{bookmarked:false});acceptAlertPermission(true);await staleBookmarkEnable;
assert.equal(notificationState().saved.example.bookmarked,false,'late permission approval cannot re-bookmark a story the user removed');
notificationState();const stopPermissionRefresh=alertState.effects.at(-1).callback();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(notificationState().preferences.releaseNotifications,false,'revoked Android permission is reflected instead of leaving notification controls misleadingly enabled');stopPermissionRefresh();
console.log('Late notification approval preserves newer bell/bookmark choices and revoked OS permission is reflected');
let verificationFocus, verificationNetwork, finishVerificationProbe, verificationSignal, verifiedSessions=0, verificationBacks=0;
const verifyPage=component('../src/app/verify-source.tsx',{
 'react-native':{ActivityIndicator:'ActivityIndicator',Text:'Text',View:'View',AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
 'react-native-webview':{WebView:'WebView'},
 'expo-router':{router:{back:()=>verificationBacks++},useLocalSearchParams:()=>({source:'asura'}),useFocusEffect:callback=>{verificationFocus=callback;}},
 '@react-native-community/netinfo':{addEventListener:callback=>{verificationNetwork=callback;return ()=>{};}},
 '../lib/parser':parser,'../lib/app-state':{useDownloads:()=>[],useShelf:()=>({sourceSessionChanged:()=>verifiedSessions++,resumeDownload(){}})},
 '../lib/network':{networkGuard:()=>async()=>{}},
 '../lib/source-session':{sourceVerificationUrl:()=>story.url,isVerificationHost:url=>new URL(url).hostname==='asurascans.com'},
 '../lib/verification-policy':{verificationObserver:()=>'',verificationNavigationAllowed:()=>true,verificationNetworkKey:state=>state.type},
 '../lib/scraper':{verifySourceSession:(_url,_guard,signal)=>{verificationSignal=signal;return new Promise(resolve=>{finishVerificationProbe=resolve;});}},
 '../components/ui':{ui:{},color:{},Icon:'Icon'},
});
const verificationNodes=()=>nodes(verifyPage.render('default',{}));
verificationNodes();let closeVerification=verificationFocus();const stopVerificationNetwork=verifyPage.effects[0].callback();
verificationNetwork({type:'wifi',isConnected:true});await new Promise(resolve=>setTimeout(resolve,0));
let browserVerification=verificationNodes().find(node=>node.type==='WebView');
browserVerification.props.onMessage({nativeEvent:{data:JSON.stringify({type:'source-ready',url:story.url})}});
verificationNodes();verifyPage.effects.at(-1).callback();assert.ok(verificationSignal);
closeVerification();assert.equal(verificationSignal.aborted,true,'leaving verification aborts the access probe');
finishVerificationProbe();await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(verificationBacks,0,'a late access result cannot navigate another screen backwards');
assert.equal(verifiedSessions,0,'an abandoned probe cannot claim successful verification');
verificationNodes();closeVerification=verificationFocus();browserVerification=verificationNodes().find(node=>node.type==='WebView');
browserVerification.props.onError({nativeEvent:{description:'Connection failed'}});
assert.ok(!verificationNodes().some(node=>node.type==='ActivityIndicator'),'a failed verification page never leaves an endless loading indicator');
closeVerification();stopVerificationNetwork();
console.log('Verification focus ownership, late-result rejection and terminal loading feedback passed');
