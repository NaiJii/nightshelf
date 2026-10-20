import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parser from "../src/lib/parser.ts";

function component(file, extraModules = {}) {
  const slots = []; let cursor = 0;
  const element = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx: element, jsxs: element },
    react: {
      createContext: value => ({ Provider: "Provider", value }), useContext: context => context.value, useCallback: fn => fn, useEffect: () => {},
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
  vm.runInNewContext(script, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { render(name, props) { cursor = 0; return exports[name](props); } };
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
const shelf = { catalog: [story], read: {example:{}}, saved: {}, preferences: {}, downloads: [], detailsLoading: [], notice: '', downloadBusy: () => false, startDownload: (_, selection) => {requested.push(selection);return true;}, setReadStatus(slug, ids, value) {for (const id of ids) {if(value) shelf.read[slug][id]='read';else delete shelf.read[slug][id];}} };
const details = component('../src/app/series/[slug].tsx', {
  'expo-router': {useLocalSearchParams: () => ({slug:'example'}), useFocusEffect: () => {}, router: {}},
  '../../lib/parser': parser,
  '../../lib/storage': {readingHistory: () => ({})},
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
readToggle().props.onPress();
assert.ok(header().some(node => node.props?.accessibilityLabel === 'Select all 1 unread chapters'));
readToggle().props.onPress();
const selectUnread = header().find(node => node.props?.accessibilityLabel === 'Select all 2 unread chapters');
assert.ok(selectUnread && !selectUnread.props.disabled, 'marking a saved chapter unread immediately restores it to Select all unread');
selectUnread.props.onPress();
for (const id of ['1','2']) assert.equal(row(id).find(node => node.props?.accessibilityLabel === 'Select chapter '+id).props.accessibilityState.checked,true);
const screen = nodes(details.render('default',{}));
screen.find(node => node.type === 'Pressable' && nodes(node).some(child => child.props?.children?.join?.('') === 'Download (1)')).props.onPress();
assert.deepEqual(requested,['2'],'downloading an unread selection does not re-download chapters already saved');
console.log("Measured summary overflow, themed sheets and read/unread selection checks passed");
