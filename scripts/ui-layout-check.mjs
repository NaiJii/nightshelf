import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/parser.ts";

function component(file, extraModules = {}) {
  const slots = [], effects = []; let cursor = 0;
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    react: {
      createContext: value => ({ Provider: "Provider", value }), useContext: context => context.value, useCallback: fn => fn, useEffect: (callback, deps) => effects.push({callback,deps}),
      useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value; }]; },
      useRef(initial) { const at = cursor++; return slots[at] ||= { current: initial }; },
    },
    "react-native": Object.fromEntries(["Modal", "Pressable", "ScrollView", "Text", "View", "FlatList", "TextInput"].map(name => [name, name])),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "./ui": { color: {}, ui: {}, Icon: "Icon" },
    ...extraModules,
  };
  const exports = {};
  const script = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(script, { exports, AbortController, Error, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { effects, render(name, props) { cursor = 0; effects.length = 0; return exports[name](props); } };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
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
const positions = {example:{chapter:"2",fraction:0.6,chapters:{"1":{fraction:0.4},"2":{fraction:0.6}}}};
const shelf = { catalog: [story], read: {example:{}}, saved: {}, preferences: {}, downloads: [], detailsLoading: [], notice: '', downloadBusy: () => false, startDownload: (_, selection) => {requested.push(selection);return true;}, setReadStatus(slug, ids, value) {for (const id of ids) {if(value) shelf.read[slug][id]='read';else {delete shelf.read[slug][id];positions[slug].chapters[id].fraction=0;}}} };
const details = component('../src/app/series/[slug].tsx', {
  'expo-router': {useLocalSearchParams: () => ({slug:'example'}), useFocusEffect: () => {}, router: {}},
  '../../lib/parser': parser,
  '../../lib/storage': {readingHistory: () => positions},
  '../../lib/app-state': {useShelf: () => shelf},
  '../../lib/library-tools': {estimateDownload: () => ({bytes:1}), formatBytes: () => '1 MB', freeBytes: () => 1000},
  '../../components/ui': {color: {}, ui: {}, Cover: 'Cover', Icon: 'Icon', Chip: 'Chip'},
  '../../components/story-row': {PublicationStatus: 'Status', SaveActions: 'SaveActions'},
  '../../components/story-options': {ReadingListAction: 'ReadingListAction', StoryOptions: 'StoryOptions'},
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
console.log("Measured summary overflow, themed sheets and read/unread selection checks passed");

shelf.detailsErrors={example:'Vortex request failed (503)'};
shelf.loadDetails=(...args)=>requested.push(args);
const retry=header().find(node=>node.props?.accessibilityLabel==='Retry loading chapters');
assert.ok(retry,'chapter failures remain visible independently of global sync notices');
retry.props.onPress();
assert.equal(JSON.stringify(requested.at(-1)),JSON.stringify(['example',true]));

// Exercise the actual app-state handlers while keeping native effects dormant.
let route='/series/example', settings={source:'vortex',mobileData:'ask',autoSync:false,interval:10}, rejectDetails, rejectSync;
const provider = component('../src/lib/app-state.tsx', {
  'expo-router': {usePathname:()=>route},
  '@react-native-community/netinfo': {},
  './parser': parser,
  './storage': {loadCatalog:()=>[story],loadPreferences:()=>settings,savePreferences:value=>{settings=value;},savedStories:()=>({}),readChapters:()=>({}),releaseUpdates:()=>({}),loadDownloads:()=>[]},
  './scraper': {refreshSeries:()=>new Promise((_,reject)=>{rejectDetails=reject;}),syncCatalog:()=>new Promise((_,reject)=>{rejectSync=reject;})},
  './network': {networkGuard:()=>async()=>{},NetworkPaused:class extends Error{}},
  './network-policy': {connectionLabel:()=>({label:'Offline'})},
  './releases': {},
  './download-queue': {restoredDownloads:()=>[],DownloadQueue:class {jobs=[];isBusy(){return false;}}},
  './request-control': {},
  './background-downloads': {backgroundTransfers:null},
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
console.log('Screen-scoped chapter errors, navigation cleanup and late-sync warning checks passed');
