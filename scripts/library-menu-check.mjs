import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/parser.ts";
import * as readingUx from "../src/lib/reading-ux.ts";

// Click the real component's handlers with native presentation stubbed out.
const alerts = [], routes = [], deletions = [];
let busy = false, cursor = 0; const slots=[];
const story = { slug: "example", title: "Example", hasLocalFiles: true, localChapters: ["1"] };
const edits=[];
const bulkEdits=[];
const shelf = { setStoriesOptions:(slugs,change)=>{bulkEdits.push([slugs,change]);edits.push(...slugs.map(slug=>[slug,change]));},setStoryOptions:(...args)=>edits.push(args),pauseDownload:()=>{}, catalog: [story], saved: {}, read: {}, updates: {}, deleting: false, downloadBusy: () => busy, removeDownloads: async (...args) => deletions.push(args) };
const element = (type, props) => ({ type, props });
const modules = {
  "react/jsx-runtime": { jsx: element, jsxs: element },
  react: { useState: initial => {const at=cursor++;if(!(at in slots))slots[at]=typeof initial==="function"?initial():initial;return [slots[at],value=>{slots[at]=typeof value==="function"?value(slots[at]):value;}];}, useDeferredValue: value => value, useMemo: fn => fn(), useCallback: value => value },
  "react-native": { TextInput:"TextInput",ActivityIndicator:"ActivityIndicator",FlatList: "FlatList", RefreshControl: "RefreshControl", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", Alert: { alert: (...args) => alerts.push(args) } },
  "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "expo-router": { router: { push: route => routes.push(route) }, useFocusEffect: () => {}, useLocalSearchParams: () => ({}) },
  "../../lib/app-state": { useDownloads:()=>[],useShelf: () => shelf },
  "../../components/action-sheet": { useActionSheet: () => (...args) => alerts.push(args) },
  "../../lib/storage": { readingHistory: () => ({}) },
  "../../lib/reading-ux": readingUx,
  "../../lib/parser": parser,
  "../../components/reading-action": {ReadingAction:"ReadingAction"},
  "../../lib/release-policy": { unreadReleases: () => [] },
  "../../components/ui": { PageHeading: "PageHeading", Chip: "Chip", Cover: "Cover", Icon: "Icon", color: {}, ui: {} },
  "../../components/series-card": { openSeries: () => {} },
  "../../components/story-row": { PublicationStatus: "PublicationStatus" },
  "../../components/download-list": { DownloadList: "DownloadList" },
  "../../components/story-options": { READING_LISTS: [["reading","Reading"]] },
};
const compiled = ts.transpileModule(readFileSync(new URL("../src/app/(tabs)/library.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => { if(name.endsWith("/pressable"))return {Pressable:"Pressable"}; assert.ok(modules[name], name); return modules[name]; } });
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []; }
const render=()=>{cursor=0;return exports.default();};
const root = render();
const list = nodes(root).find(node => node.type === "FlatList");
assert.ok(list, "library uses a virtualized list");
assert.equal(list.props.data.length, 1);
const countedTab=nodes(list.props.ListHeaderComponent).find(node=>node.props?.accessibilityRole==='tab'&&nodes(node).some(child=>child.props?.children?.[0]==='Downloads'));
assert.ok(nodes(countedTab).some(node=>node.props?.children?.at?.(-1)===1),'Downloads displays its actual story count');
assert.ok(nodes(list.props.ListHeaderComponent).some(node=>node.type==='Chip'&&node.props.text==='Unread · 1'),'Unread counts stories with unread saved chapters');
shelf.read={example:{'1':'read'}};
assert.ok(nodes(nodes(render()).find(node=>node.type==='FlatList').props.ListHeaderComponent).some(node=>node.type==='Chip'&&node.props.text==='Unread · 0'),'counts update immediately when read status changes');
shelf.read={};

assert.ok(!nodes(list.props.ListHeaderComponent).some(node => node.type === "DownloadList"), "queue controls live in the shared drawer rather than expanding the library header");
assert.equal(list.props.refreshControl.type, "RefreshControl");
assert.ok(!nodes(root).some(node => node.props?.accessibilityLabel === "Library actions for Example"), "rows are created lazily");
shelf.catalog = Array.from({length: 1500}, (_, index) => ({...story, slug: `story-${index}`}));
const large = nodes(render()).find(node => node.type === "FlatList");
assert.equal(large.props.data.length, 1500);
assert.equal(large.props.initialNumToRender, 8);
const button = nodes(list.props.renderItem({item: story})).find(node => node.props?.accessibilityLabel === "Library actions for Example");
assert.ok(button?.props.onPress, "library dots expose a working action handler");
button.props.onPress();
const actions = alerts.at(-1)[2];
assert.ok(actions.some(action => action.style === "cancel"), "the action sheet can be dismissed without choosing an operation");
actions.find(action => action.text === "Saved chapters").onPress();
assert.equal(routes.at(-1).params.filter, "downloaded");
const erase = actions.find(action => action.text === "Delete saved files");
erase.onPress();
assert.equal(deletions.length, 0, "opening the menu or confirmation cannot delete files");
alerts.at(-1)[2].find(action => action.text === "Delete").onPress();
assert.equal(deletions.length, 1);
assert.equal(deletions[0][0].slug, story.slug); assert.equal(deletions[0][2], true);
busy = true; erase.onPress();
assert.equal(alerts.at(-1)[0], "Download in progress");
assert.equal(deletions.length, 1, "active downloads block deletion");
console.log("Library menu navigation, confirmation and download guard checks passed");

shelf.catalog=[story,{...story,slug:'automatic',title:'Automatic',alternativeTitles:['Ragnar: L’Héritier de la Lame']}];
shelf.saved={automatic:{bookmarked:true,autoDownload:true}};
const autoTab=nodes(nodes(render()).find(node=>node.type==='FlatList').props.ListHeaderComponent).find(node=>node.props?.accessibilityRole==='tab'&&nodes(node).some(child=>child.props?.children?.[0]==='Auto-downloads'));
assert.ok(autoTab);autoTab.props.onPress();
assert.deepEqual(nodes(render()).find(node=>node.type==='FlatList').props.data.map(item=>item.slug),['automatic'],'Auto-downloads contains only enabled stories');

const findList=()=>nodes(render()).find(node=>node.type==='FlatList');
const libraryHeader=()=>nodes(findList().props.ListHeaderComponent);
libraryHeader().find(node=>node.props?.accessibilityRole==='tab'&&nodes(node).some(child=>child.props?.children?.[0]==='Downloads')).props.onPress();
libraryHeader().find(node=>node.props?.accessibilityLabel==='Search your library').props.onChangeText('auto');
assert.deepEqual(findList().props.data.map(item=>item.slug),['automatic'],'search filters the active shelf');
libraryHeader().find(node=>node.props?.accessibilityLabel==='Search your library').props.onChangeText('lheritier');
assert.deepEqual(findList().props.data.map(item=>item.slug),['automatic'],'alternate provider titles find the canonical library entry');
libraryHeader().find(node=>node.props?.accessibilityLabel==='Clear library search').props.onPress();
assert.equal(findList().props.data.length,2);
libraryHeader().find(node=>node.type==='PageHeading').props.action.props.onPress();
let selectable=findList();
nodes(selectable.props.renderItem({item:story})).find(node=>node.props?.accessibilityLabel==='Select Example').props.onPress();
let selectionNodes=nodes(render());
selectionNodes.find(node=>node.props?.accessibilityLabel==='Select visible stories').props.onPress();
nodes(render()).find(node=>node.props?.accessibilityLabel==='Bulk library actions').props.onPress();
alerts.at(-1)[2].find(action=>action.text==='Move to Reading').onPress();
assert.equal(bulkEdits.length,1,'a bulk selection dispatches one storage mutation');
assert.deepEqual(edits.map(([slug,change])=>[slug,change.list]),[['example','reading'],['automatic','reading']]);
assert.ok(!nodes(render()).some(node=>node.props?.accessibilityLabel==='Bulk library actions'),'bulk list changes exit selection mode');
console.log('Library search, selection and bulk list changes passed');
