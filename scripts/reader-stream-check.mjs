import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readerHtml, readerChapterHtml } from '../src/lib/reader-html.ts';

// Exercise the complete WebView script against a small layout model. Heights and
// offsets change when sections are inserted/removed, just as in the document.
function session() {
  let y = 0, timerId = 0;
  const timers = new Map();
  const messages = [], seeks = [], events = {};
  const host = {
    children: [],
    append(node) { this.children.push(node); },
    prepend(node) { this.children.unshift(node); },
    querySelectorAll(selector) { return this.children.flatMap(node => node.querySelectorAll(selector)); },
  };
  class Section {
    dataset = {};
    height = 2040;
    constructor() {
      this.panels = [0, 1].map(index => ({
        src: `file:///panel-${index}.webp`, complete: true, naturalWidth: 400, style: {},
        listeners: {}, nextElementSibling: { hidden: true },
        addEventListener(name, callback) { this.listeners[name] = callback; },
        getBoundingClientRect: () => ({ top: this.top() + index * 1000 - y, bottom: this.top() + (index + 1) * 1000 - y, left: 0, right: 400 }),
      }));
      for (const panel of this.panels) panel.parentElement = panel;
    }
    top() { return host.children.slice(0, Math.max(0, host.children.indexOf(this))).reduce((sum, node) => sum + node.height, 0); }
    set innerHTML(content) { if (content.startsWith('slow')) this.panels[0].complete = false; }
    getBoundingClientRect() { return { top: this.top() - y, bottom: this.top() + this.height - y }; }
    querySelectorAll(selector) { return selector === 'img' ? this.panels : []; }
    querySelector() { return null; }
    setAttribute(name, value) { this[name] = value; }
    remove() { host.children.splice(host.children.indexOf(this), 1); }
  }
  const root = new Section(); root.dataset.chapter = '3'; host.append(root);
  const controls = Object.fromEntries(['reader-scrubber','scrub-range','scrub-preview','scrub-crop','scrub-text','scrub-label','scrub-position'].map(id => [id, {
    hidden: true, style: {}, value: 0, offsetHeight: 68, clientHeight: 152,
    listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, setAttribute() {},
  }]));
  const ending = { hidden: true, dataset: {}, children: [], replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); } };
  const toast = { hidden: false, animate(keyframes, options) { this.animation = {keyframes, options}; } };
  const document = {
    hidden: false, body: { style: {} },
    documentElement: { style: {}, get scrollHeight() { return host.children.reduce((sum, node) => sum + node.height, 0); } },
    get images() { return host.querySelectorAll('img'); },
    getElementById(id) { return id === 'reader-ending' ? ending : id === 'chapter-toast' ? toast : id === 'reader-chapter' ? root : id === 'reader-chapters' ? host : controls[id]; },
    createElement() { return new Section(); },
  };
  const window = {
    visualViewport: { offsetTop: 0, offsetLeft: 0, height: 800, width: 400, scale: 1, addEventListener() {} },
    ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) },
  };
  const context = vm.createContext({
    window, document, innerHeight: 800, innerWidth: 400, Date,
    get scrollY() { return y; },
    scrollTo(_x, target) { y = Math.max(0, Math.min(target, document.documentElement.scrollHeight - 800)); seeks.push(y); },
    addEventListener(name, callback) { events[name] = callback; },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval() {},
  });
  vm.runInContext(readerHtml(['file:///first.webp','file:///last.webp'], 0, null, 19, 'dark', '3').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  events.load(); window.readerActive = true;
  window.readerSetNeighbors(['2','4'], true);
  return {
    window, host, document, messages, controls, seeks, events, ending, toast,
    y: () => y, scroll(value) { y = value; events.scroll(); },
    settle() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    report() { vm.runInContext('report()', context); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
    ids: () => host.children.map(node => node.dataset.chapter),
    root: () => vm.runInContext('chapterRoot', context),
  };
}

const stream = session();
stream.scroll(600);
stream.window.readerAttachChapter('4','saved'); await stream.flush();
assert.deepEqual(stream.ids(), ['3','4']);
assert.equal(stream.y(), 600, 'appending a chapter does not move the reader');
assert.ok(!stream.messages.some(message => message.activeChapter === '4' || message.complete), 'preparing adjacent panels never reads them');
const topBefore = stream.root().getBoundingClientRect().top;
stream.window.readerAttachChapter('2','saved'); await stream.flush();
assert.deepEqual(stream.ids(), ['2','3','4']);
assert.equal(stream.y(), 2640);
assert.equal(stream.root().getBoundingClientRect().top, topBefore, 'prepending preserves the exact visible panel offset');
stream.window.readerAttachChapter('2','saved'); await stream.flush();
assert.equal(stream.host.children.length, 3, 'duplicate preparations do not insert a second copy');

stream.scroll(3340);
assert.equal(stream.messages.find(message => message.complete)?.chapter, '3', 'the final visible panel completes its own chapter');
stream.scroll(4180);
assert.equal(stream.messages.filter(message => message.activeChapter).at(-1).activeChapter, '4', 'ordinary scrolling enters the next chapter with no edge gesture');
assert.equal(stream.toast.textContent, 'Chapter 4');
assert.equal(stream.toast.animation.options.duration, 1600, 'a brief transition label fades without blocking scrolling');
assert.equal(stream.messages.filter(message => Number.isFinite(message.fraction)).at(-1).fraction, 0, 'the first panel of the next chapter has zero progress');
const seeksDuringMomentum = stream.seeks.length;
stream.window.readerSetNeighbors(['3','5'], true);
assert.equal(stream.seeks.length, seeksDuringMomentum, 'rolling cleanup does not cancel a continuing fling');
stream.settle();
assert.deepEqual(stream.ids(), ['3','4']);
assert.equal(stream.y(), 2140, 'evicting an old chapter preserves position');
stream.window.readerAttachChapter('5','saved'); await stream.flush();
assert.deepEqual(stream.ids(), ['3','4','5'], 'the rolling document contains only the current chapter and its neighbors');
stream.scroll(3100); stream.report();
const progress = stream.messages.filter(message => Number.isFinite(message.fraction)).at(-1);
assert.equal(progress.chapter, '4');
assert.ok(Math.abs(progress.fraction - 1060 / 1240) < 0.001, 'progress is relative to the active chapter, not the combined document');
stream.window.readerChromeVisible = true; stream.window.readerUpdateControls();
stream.controls['scrub-range'].value = 5000;
stream.controls['scrub-range'].listeners.change();
assert.equal(stream.y(), 2660, 'scrubbing seeks within the active chapter only');
stream.window.readerChromeVisible = false;

stream.window.readerOpenChapter('3', true);
assert.equal(stream.y(), 1240, 'Previous enters the final viewport of the previous chapter');
assert.equal(stream.messages.filter(message => message.activeChapter).at(-1).activeChapter, '3');
stream.window.readerSetNeighbors(['2','4'], true); stream.settle();
assert.deepEqual(stream.ids(), ['3','4']);
stream.window.readerAttachChapter('2','saved'); await stream.flush();
stream.scroll(1000);
assert.equal(stream.messages.filter(message => message.activeChapter).at(-1).activeChapter, '2', 'reverse scrolling enters the preceding panels');
stream.window.readerSetNeighbors(['1','3'], true); stream.settle();
stream.window.readerAttachChapter('1','saved'); await stream.flush();
assert.equal(stream.host.children.length, 3);
const visibleBeforeDisable = stream.root().getBoundingClientRect().top;
stream.window.readerSetNeighbors([], false); stream.settle();
assert.deepEqual(stream.ids(), ['2']);
assert.equal(stream.root().getBoundingClientRect().top, visibleBeforeDisable, 'disabling continuous reading preserves the active viewport');

const late = session();
let detached;
const create = late.document.createElement;
late.document.createElement = () => (detached = create());
late.window.readerAttachChapter('4','slow');
late.window.readerAttachChapter('4','saved'); await late.flush();
assert.deepEqual(late.ids(), ['3']);
late.window.readerSetNeighbors([], false);
detached.panels[0].complete = true; detached.panels[0].listeners.load(); await late.flush();
assert.deepEqual(late.ids(), ['3'], 'late image loading cannot restore disabled neighboring content');

const zoomed = session();
zoomed.window.readerAttachChapter('4','saved'); await zoomed.flush();
zoomed.window.visualViewport.scale = 2;
zoomed.scroll(2100);
assert.ok(!zoomed.messages.some(message => message.activeChapter), 'panning a zoomed page cannot activate another chapter');
zoomed.window.visualViewport.scale = 1;
zoomed.window.readerTrackChapter();
assert.equal(zoomed.messages.filter(message => message.activeChapter).at(-1).activeChapter, '4');

const edge = session();
edge.scroll(800);
edge.events.touchstart({touches:[{clientX:100,clientY:400}]});
edge.events.touchmove({touches:[{clientX:100,clientY:300}]});
edge.scroll(1240);
assert.equal(edge.messages.filter(message => message.boundary).at(-1).boundary, 'next', 'an unsaved next chapter is requested on the same scroll that reaches the end');
assert.ok(edge.messages.some(message => message.prefetch), 'preparation is requested while moving, without waiting for momentum to settle');
edge.window.readerTrackChapter();
assert.equal(edge.messages.filter(message => message.boundary).length, 1, 'repeated edge events do not start duplicate requests');

assert.ok(!readerChapterHtml(['https://example.com/remote.webp']).includes('https://'));
console.log('Continuous chapter scrolling, reverse entry, bounded layout, chapter progress, scrubber, prefetch and delayed-image checks passed');

const caughtUp = session();
caughtUp.window.readerSetEnding({chapter:'4',title:'You’re caught up',detail:'Updated today',bookmarked:false,automatic:false});
assert.equal(caughtUp.ending.hidden,true,'the ending is not shown beneath an earlier chapter');
caughtUp.window.readerAttachChapter('4','saved'); await caughtUp.flush();
assert.equal(caughtUp.ending.hidden,false);
assert.equal(caughtUp.ending.children[0].textContent,'You’re caught up');
assert.equal(caughtUp.ending.children[1].textContent,'Updated today');
caughtUp.ending.children[2].onclick(); assert.equal(caughtUp.messages.at(-1).ending,'bookmark');
caughtUp.ending.children[3].onclick(); assert.equal(caughtUp.messages.at(-1).ending,'auto');
caughtUp.ending.children[4].onclick(); assert.equal(caughtUp.messages.at(-1).ending,'refresh');
caughtUp.window.readerSetEnding({chapter:'4',title:'Latest public chapter',detail:'Additional chapters require provider access.',bookmarked:true,automatic:true,refreshing:true});
assert.equal(caughtUp.ending.children[0].textContent,'Latest public chapter');
assert.equal(caughtUp.ending.children[2]['aria-pressed'],'true');
assert.equal(caughtUp.ending.children[4].disabled,true,'pending checks disable duplicate refreshes');
assert.ok(!caughtUp.messages.some(message=>message.complete),'a caught-up card does not mark unseen panels as read');
console.log('Transition label, caught-up controls and pending-update feedback checks passed');
