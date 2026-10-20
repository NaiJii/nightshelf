import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Click the real component's handlers with native presentation stubbed out.
const alerts = [], routes = [], deletions = [];
let busy = false, cursor = 0; const slots=[];
const story = { slug: "example", title: "Example", hasLocalFiles: true, localChapters: ["1"] };
const shelf = { catalog: [story], saved: {}, read: {}, updates: {}, deleting: false, downloadBusy: () => busy, removeDownloads: async (...args) => deletions.push(args) };
const element = (type, props) => ({ type, props });
const modules = {
  "react/jsx-runtime": { jsx: element, jsxs: element },
  react: { useState: initial => {const at=cursor++;if(!(at in slots))slots[at]=typeof initial==="function"?initial():initial;return [slots[at],value=>{slots[at]=typeof value==="function"?value(slots[at]):value;}];}, useMemo: fn => fn(), useCallback: value => value },
  "react-native": { FlatList: "FlatList", RefreshControl: "RefreshControl", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", Alert: { alert: (...args) => alerts.push(args) } },
  "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  "expo-router": { router: { push: route => routes.push(route) }, useFocusEffect: () => {}, useLocalSearchParams: () => ({}) },
  "../../lib/app-state": { useShelf: () => shelf },
  "../../components/action-sheet": { useActionSheet: () => (...args) => alerts.push(args) },
  "../../lib/storage": { readingHistory: () => ({}) },
  "../../lib/parser": { nextUnread: () => "1" },
  "../../lib/release-policy": { unreadReleases: () => [] },
  "../../components/ui": { PageHeading: "PageHeading", Chip: "Chip", Cover: "Cover", Icon: "Icon", color: {}, ui: {} },
  "../../components/series-card": { openSeries: () => {} },
  "../../components/story-row": { PublicationStatus: "PublicationStatus" },
  "../../components/download-list": { DownloadList: "DownloadList" },
  "../../components/story-options": { READING_LISTS: [] },
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
assert.ok(nodes(list.props.ListHeaderComponent).some(node => node.type === "DownloadList"), "download controls stay in the list header");
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

shelf.catalog=[story,{...story,slug:'automatic',title:'Automatic'}];
shelf.saved={automatic:{bookmarked:true,autoDownload:true}};
const autoTab=nodes(nodes(render()).find(node=>node.type==='FlatList').props.ListHeaderComponent).find(node=>node.props?.accessibilityRole==='tab'&&nodes(node).some(child=>child.props?.children==='Auto-downloads'));
assert.ok(autoTab);autoTab.props.onPress();
assert.deepEqual(nodes(render()).find(node=>node.type==='FlatList').props.data.map(item=>item.slug),['automatic'],'Auto-downloads contains only enabled stories');
