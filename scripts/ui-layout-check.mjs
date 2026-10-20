import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/parser.ts";
import * as releasePolicy from "../src/lib/release-policy.ts";

function component(file, extraModules = {}) {
  const slots = [], effects = []; let cursor = 0;
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    react: {
      createContext: value => ({ Provider: "Provider", value }), useContext: context => context.value, useCallback: fn => fn,
      useMemo(fn, deps) { const at=cursor++, previous=slots[at]; if(!previous || deps.some((value,index)=>!Object.is(value,previous.deps[index]))) slots[at]={value:fn(),deps}; return slots[at].value; },
      useEffect: (callback, deps) => effects.push({callback,deps}),
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
  vm.runInNewContext(script, { exports, AbortController, Error, setTimeout, clearTimeout, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { effects, render(name, props) { cursor = 0; effects.length = 0; return exports[name](props); } };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }

const browseRequests = [];
const exploreShelf = {
  catalog: [{slug:'first',title:'First'}], saved: {}, preferences: {source:'asura',sort:'title'},
  browse: (options, cursor, signal, manual) => new Promise((resolve,reject) => browseRequests.push({options,cursor,signal,manual,resolve,reject})),
};
const explore = component('../src/app/(tabs)/explore.tsx', {
  'expo-router': {router:{}},
  '../../lib/app-state': {useShelf:()=>exploreShelf},
  '../../lib/parser': {filterDiscovery:items=>items,sortExplore:items=>items},
  '../../lib/scraper': {FIRST_PAGE:{page:1}},
  '../../components/ui': {ui:{},color:{},Icon:'Icon',Chip:'Chip',PageHeading:'PageHeading'},
  '../../components/series-card': {SeriesCard:'SeriesCard'},
  '../../components/discovery-controls': {DiscoveryControls:'DiscoveryControls',PopularPeriods:'PopularPeriods'},
});
const exploreList = () => nodes(explore.render('default',{})).find(node=>node.type==='FlatList');
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
nodes(discovery.props.ListFooterComponent).find(node=>node.props?.accessibilityLabel==='Retry loading titles').props.onPress();
assert.equal(browseRequests.length,4);
assert.equal(browseRequests[3].manual,true);
browseRequests[3].resolve({ids:[],cursor:{page:4},hasMore:false});
await settleExplore();
discovery=exploreList(); discovery.props.onEndReached(); discovery.props.onContentSizeChange(400,2900);
assert.equal(browseRequests.length,4,'exhausted results stop automatic pagination');
assert.ok(!nodes(discovery.props.ListFooterComponent).some(node=>node.type==='Pressable'),'normal pagination needs no Load more button');
stopExplore();

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
const details = component('../src/app/series/[slug].tsx', {
  'expo-router': {useLocalSearchParams: () => ({slug:'example'}), useFocusEffect: () => {}, router: {}},
  '../../lib/parser': parser,
  '../../lib/storage': {readingHistory: () => positions},
  '../../lib/app-state': {useShelf: () => shelf},
  '../../lib/library-tools': {estimateDownload: (...args) => {estimateCalls.push(args);return {bytes:1};}, formatBytes: () => '1 MB', freeBytes: () => 1000},
  '../../components/ui': {color: {}, ui: {}, Cover: 'Cover', Icon: 'Icon', Chip: 'Chip'},
  '../../components/story-row': {PublicationStatus: 'Status', SaveActions: 'SaveActions'},
  '../../components/story-options': {ReadingListAction: 'ReadingListAction', ReleaseActions: 'ReleaseActions'},
  '../../components/download-list': {DownloadList: 'DownloadList'},
  '../../components/expandable-summary': {ExpandableSummary: 'Summary'},
  '../../components/action-sheet': {useActionSheet: () => () => {}},
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

shelf.detailsErrors={example:'Vortex request failed (503)'};
shelf.loadDetails=(...args)=>requested.push(args);
const retry=header().find(node=>node.props?.accessibilityLabel==='Retry loading chapters');
assert.ok(retry,'chapter failures remain visible independently of global sync notices');
retry.props.onPress();
assert.equal(JSON.stringify(requested.at(-1)),JSON.stringify(['example',true]));

// Exercise the actual app-state handlers while keeping native effects dormant.
let route='/series/example', settings={source:'vortex',mobileData:'ask',autoSync:false,interval:10}, rejectDetails, rejectSync;
const nativeControls={backgroundTransfers:null};
const automaticQueued=[], localDeletions=[];
let resolveNetwork;
const provider = component('../src/lib/app-state.tsx', {
  'expo-router': {usePathname:()=>route},
  'react-native': {AppState:{currentState:'active'}},
  '@react-native-community/netinfo': {__esModule:true,default:{fetch:()=>new Promise(resolve=>{resolveNetwork=resolve;})}},
  './parser': parser,
  './release-policy': releasePolicy,
  './storage': {loadCatalog:()=>[story],loadPreferences:()=>settings,savePreferences:value=>{settings=value;},savedStories:()=>({example:{bookmarked:true,autoDownload:true,autoDownloadBaseline:['1']}}),readChapters:()=>({}),releaseUpdates:()=>({example:['2']}),loadDownloads:()=>[],deleteChapters:(...args)=>localDeletions.push(args)},
  './scraper': {refreshSeries:()=>new Promise((_,reject)=>{rejectDetails=reject;}),syncCatalog:()=>new Promise((_,reject)=>{rejectSync=reject;})},
  './network': {networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy': {connectionLabel:()=>({label:'Offline'})},
  './releases': {configureReleaseChecks:async()=>{}},
  './download-queue': {restoredDownloads:()=>[],DownloadQueue:class {jobs=[];isBusy(){return false;}pause(){}enqueue(...args){automaticQueued.push(args);} }},
  './request-control': {},
  './background-downloads': nativeControls,
  './library-tools': {},
});
const app=()=>provider.render('AppProvider',{}).props.value;
const navigate=path=>{route=path;app();provider.effects[0].callback();};
navigate('/series/example');
const detailsPending=app().loadDetails('example',true);
navigate('/settings');
rejectDetails(Error('Vortex chapter list could not be read'));
await detailsPending;
assert.equal(app().notice,'','chapter failures cannot leak into other screens, including late failures');
assert.equal(app().detailsErrors.example,'Vortex chapter list could not be read','chapter errors stay attached to the affected story');
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
nativeControls.backgroundTransfers={pause:async()=>{throw Error('Could not pause Android transfer');}};
nativeControls.stopTransfer=async()=>{throw Error('Could not stop Android transfer');};
app().pauseDownload('example');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(app().notice,'Could not pause Android transfer','native pause failures become visible instead of unhandled rejections');
app().resumeDownload('example');await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(app().notice,'Could not stop Android transfer','native resume failures become visible instead of unhandled rejections');
nativeControls.transferStates=()=>({});
app();provider.effects[1].callback();
const deletionPending=app().removeDownloads(story,['1']);
resolveNetwork({type:'wifi',isConnected:true});
await deletionPending;
assert.equal(localDeletions.length,1);
assert.equal(automaticQueued.length,0,'automatic transfers cannot start writing while files are being deleted');
app();provider.effects[1].callback();resolveNetwork({type:'wifi',isConnected:true});
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
