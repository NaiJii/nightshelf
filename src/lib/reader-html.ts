import type { NovelText } from "./parser";

const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
const waitingPanel = `<button class="download-tail" onclick="window.ReactNativeWebView.postMessage(JSON.stringify({downloadPending:true,chapter:this.closest('section').dataset.chapter}))"><span class="download-ring" aria-hidden="true">↓</span><span class="download-label">Waiting for more panels…</span><small>Open download controls</small></button>`;

export function readerChapterHtml(files: string[], novel?: NovelText | null): string {
  return novel ? `<main class="novel"><h1>${escape(novel.title)}</h1>${novel.paragraphs.map(text => `<p>${escape(text)}</p>`).join("")}</main>` : files.filter(uri => uri.startsWith("file://")).map((uri, index) => `<div class="reader-panel"><img src="${escape(uri)}" alt="Page ${index + 1}" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false;window.ReactNativeWebView.postMessage(JSON.stringify({error:true,page:${index},chapter:this.closest('section').dataset.chapter}))"><button class="panel-repair" hidden onclick="window.ReactNativeWebView.postMessage(JSON.stringify({repair:${index},chapter:this.closest('section').dataset.chapter}))" aria-label="Repair page ${index + 1}">↻ Page ${index + 1} could not open · Tap to repair</button></div>`).join("");
}

export function readerHtml(files: string[], fraction = 0, novel?: NovelText | null, fontSize = 19, theme: "dark" | "sepia" = "dark", chapter = "", complete = true): string {
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const size = Number.isFinite(fontSize) ? Math.max(14, Math.min(30, fontSize)) : 19;
  const sepia = Boolean(novel) && theme === "sepia";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>html,body{overflow-anchor:none;touch-action:manipulation;margin:0;padding:0;background:${sepia ? "#f4ecd8" : "#08080b"};color:${sepia ? "#483b2c" : "#ded9e6"}}img{display:block;width:100%;height:auto;margin:0}.novel{max-width:720px;margin:auto;padding:24px 22px 50px}.novel p{font:${size}px/1.85 Georgia,serif;margin:0 0 1.2em;text-align:left;overflow-wrap:break-word}.novel h1{font:600 24px/1.4 sans-serif;margin:6px 0 30px}.end{font:11px sans-serif;text-align:center;padding:14px 8px;margin:0;color:#8b8494}</style><style id="reader-appearance"></style></head><body>
<div id="reader-chapters"><section id="reader-chapter" class="reader-chapter" data-chapter="${escape(chapter)}" data-complete="${complete}">${readerChapterHtml(files, novel)}<p class="end" ${complete ? "" : "hidden"}>End of chapter</p>${complete ? "" : waitingPanel}</section></div>
<style>
.reader-panel img[hidden],.panel-repair[hidden]{display:none}.panel-repair{display:block;width:100%;min-height:60vh;border:0;background:#17171f;color:#c9a7ff;font:14px/1.6 sans-serif;padding:24px;overflow-wrap:anywhere}
.download-tail{width:100%;min-height:180px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;border:0;background:#111117;color:#c9a7ff;font:13px sans-serif;padding:28px;box-sizing:border-box}.download-tail[hidden],.end[hidden]{display:none}.download-tail small{color:#8b8494;font-size:11px}.download-ring{position:relative;display:grid;place-items:center;width:38px;height:38px;font-size:24px}.download-ring:before{content:'';position:absolute;inset:0;border:2px solid #c9a7ff30;border-top-color:#c9a7ff;border-radius:50%;animation:download-spin 1s linear infinite}@keyframes download-spin{to{transform:rotate(360deg)}}
.reader-chapter[data-complete="false"]{min-height:100vh}
.download-tail[data-state="paused"] .download-ring:before,.download-tail[data-state="error"] .download-ring:before,.download-tail[data-state="stopped"] .download-ring:before{animation:none;border-top-color:#c9a7ff30}
#reader-scrubber{position:fixed;z-index:2;box-sizing:border-box;padding:4px 20px 8px;background:#17171ff2;color:#aaa6b3;border-radius:16px;transform-origin:top left;font:11px/1.4 sans-serif;touch-action:none}
#reader-scrubber[hidden],#scrub-preview[hidden],#scrub-crop[hidden],#scrub-text[hidden]{display:none}
#scrub-range{display:block;width:100%;height:44px;margin:0;accent-color:#c9a7ff;touch-action:none}
#scrub-position{display:block;text-align:center}
#scrub-preview{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);width:132px;background:#17171f;border:1px solid #ffffff24;border-radius:10px;overflow:hidden;box-shadow:0 3px 12px #0008;pointer-events:none}
#scrub-crop{height:152px;background-repeat:no-repeat;background-color:#08080b}
#scrub-text{padding:12px;color:#f7f4fb;font:13px/1.5 Georgia,serif;max-height:140px;overflow:hidden}
#scrub-label{display:block;padding:7px;text-align:center;color:#c9a7ff}
</style>
<div id="chapter-toast" aria-live="polite"></div>
<aside id="reader-ending" hidden aria-label="End of available chapters"></aside>
<style>
#chapter-toast{position:fixed;z-index:3;bottom:24px;left:50%;transform:translateX(-50%);padding:7px 12px;border-radius:12px;background:#17171fe6;color:#ccc5d6;font:11px sans-serif;pointer-events:none;opacity:0}
#reader-ending{padding:32px 24px 56px;text-align:center;font:13px/1.6 sans-serif;color:#aaa6b3}
#reader-ending h2{font-size:19px;color:inherit;margin:0 0 8px}#reader-ending p{margin:0 0 18px}
#reader-ending button{font:12px sans-serif;border:1px solid #9385aa55;border-radius:12px;padding:12px;margin:4px;background:transparent;color:inherit}
</style>
<aside id="reader-scrubber" hidden aria-label="Chapter navigation">
  <div id="scrub-preview" hidden aria-hidden="true"><div id="scrub-crop"></div><div id="scrub-text" hidden></div><span id="scrub-label"></span></div>
  <input id="scrub-range" type="range" min="0" max="10000" step="1" value="0" aria-label="Chapter position">
  <output id="scrub-position" for="scrub-range"></output>
</aside><script>
let timer; let images = [...document.images]; let restored = false, finished = false;
let chapterRoot = document.getElementById('reader-chapter'), readerChapter = chapterRoot?.dataset.chapter || '';
const completedChapters = new Set();
function chapterBounds() {
  const rect = chapterRoot?.getBoundingClientRect();
  return {start:rect ? rect.top + scrollY : 0, end:rect ? rect.bottom + scrollY : document.documentElement.scrollHeight};
}
function chapterNodes(selector) { return [...(chapterRoot || document).querySelectorAll(selector)]; }
window.readerActive = false;
window.readerChromeVisible = false;
window.readerContinuous = false;
let swipe, userScrolled = false;
let touch, lastTouchEnd = -Infinity, chromeSettlesUntil = 0, scrolling = false;
const scrubber = document.getElementById('reader-scrubber'), range = document.getElementById('scrub-range');
const preview = document.getElementById('scrub-preview'), crop = document.getElementById('scrub-crop'), snippet = document.getElementById('scrub-text');
const scrubLabel = document.getElementById('scrub-label'), scrubPosition = document.getElementById('scrub-position');
let scrubbing = false;
function scrubFraction(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0; }
function scrubTarget(fraction) {
  const bounds = chapterBounds();
  const y = bounds.start + fraction * Math.max(0, bounds.end - bounds.start - innerHeight);
  const nodes = images.length ? images : chapterNodes('.novel p');
  let index = nodes.findIndex(node => node.getBoundingClientRect().bottom + scrollY > y);
  if (index < 0) index = Math.max(0, nodes.length - 1);
  const node = nodes[index], rect = node?.getBoundingClientRect();
  const within = rect ? Math.max(0, y - rect.top - scrollY) : 0;
  const percent = Math.round(fraction * 100);
  const label = images.length ? 'Page ' + (index + 1) + '/' + images.length + (rect && rect.bottom - rect.top > innerHeight ? ' · ' + Math.round(within / Math.max(1, rect.bottom - rect.top) * 100) + '%' : '') : percent + '% of chapter';
  return {y, node, rect, within, label};
}
function showScrubPreview() {
  if (scrubber.hidden) return;
  scrubbing = true;
  const target = scrubTarget(scrubFraction(Number(range.value) / 10000));
  preview.hidden = false; scrubLabel.textContent = target.label;
  crop.hidden = !images.length; snippet.hidden = Boolean(images.length);
  if (images.length && target.node && target.rect) {
    const ratio = 132 / Math.max(1, target.rect.right - target.rect.left);
    const offset = Math.min(target.within * ratio, Math.max(0, (target.rect.bottom - target.rect.top) * ratio - crop.clientHeight));
    const image = 'url(' + JSON.stringify(target.node.src) + ')';
    if (crop.style.backgroundImage !== image) crop.style.backgroundImage = image;
    crop.style.backgroundSize = '132px auto'; crop.style.backgroundPosition = 'center -' + offset + 'px';
  } else snippet.textContent = (target.node?.textContent || '').slice(0, 180);
  range.setAttribute('aria-valuetext', target.label); scrubPosition.textContent = target.label;
}
function cancelScrub() { scrubbing = false; preview.hidden = true; window.readerUpdateControls(); }
window.readerUpdateControls = () => {
  const toast = document.getElementById('chapter-toast');
  if (toast) toast.hidden = !window.readerActive || window.readerChromeVisible || document.hidden;
  scrubber.hidden = !restored || !window.readerActive || !window.readerChromeVisible || document.hidden;
  if (scrubber.hidden) { scrubbing = false; preview.hidden = true; return; }
  const viewport = window.visualViewport, scale = viewport?.scale || 1;
  scrubber.style.width = (viewport ? viewport.width * scale : innerWidth) + 'px';
  scrubber.style.left = (viewport?.offsetLeft || 0) + 'px';
  scrubber.style.top = Math.max(0, (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - ((window.readerScrubberBottom || 96) + scrubber.offsetHeight) / scale) + 'px';
  scrubber.style.transform = 'scale(' + 1 / scale + ')';
  crop.style.height = Math.max(40, Math.min(152, (viewport?.height || innerHeight) * scale - (window.readerScrubberBottom || 96) - scrubber.offsetHeight - 60)) + 'px';
  const bounds = chapterBounds();
  range.disabled = bounds.end - bounds.start <= innerHeight;
  if (!scrubbing) {
    const fraction = scrubFraction((scrollY + (viewport?.offsetTop || 0) - bounds.start) / Math.max(1, bounds.end - bounds.start - innerHeight));
    range.value = String(Math.round(fraction * 10000));
    const label = scrubTarget(fraction).label;
    scrubPosition.textContent = label; range.setAttribute('aria-valuetext', label);
  }
};
range.addEventListener('input', showScrubPreview);
range.addEventListener('change', () => {
  if (scrubber.hidden || range.disabled) { cancelScrub(); return; }
  const target = scrubTarget(scrubFraction(Number(range.value) / 10000));
  scrubbing = false; preview.hidden = true; chromeSettlesUntil = Date.now() + 600;
  scrollTo(0, target.y); report(); window.readerUpdateControls();
});
range.addEventListener('pointercancel', cancelScrub);
range.addEventListener('touchcancel', cancelScrub);
range.addEventListener('blur', cancelScrub);
function scrubEvent(event) { return Boolean(event.target?.closest?.('#reader-scrubber,.panel-repair,#reader-ending')); }
function panelImages(id) {
  return id && chapterHost ? [...sectionFor(id)?.querySelectorAll('img') || []] : images;
}
window.readerPanelRepairState = (index, busy, message, id) => {
  const button = panelImages(id)[index]?.nextElementSibling;
  if (!button) return;
  button.disabled = busy;
  button.textContent = message || '↻ Page ' + (index + 1) + ' could not open · Tap to repair';
};
window.readerReloadPanel = (index, id = readerChapter) => {
  const image = panelImages(id)[index]; if (!image) return;
  const anchor = images.find(value => value.parentElement.getBoundingClientRect().bottom > 0)?.parentElement;
  const top = anchor?.getBoundingClientRect().top || 0;
  const anchorChapter = readerChapter;
  image.onload = () => {
    image.hidden = false; image.nextElementSibling.hidden = true;
    if (anchor && anchorChapter === readerChapter && anchor.isConnected !== false) scrollTo(0,scrollY + anchor.getBoundingClientRect().top - top);
    window.readerPanelRepairState(index,false,undefined,id); window.readerUpdateControls();
    window.ReactNativeWebView.postMessage(JSON.stringify({repaired:index,chapter:id}));
  };
  window.readerPanelRepairState(index,true,'Opening repaired page…',id);
  image.src = image.src.split('?')[0] + '?repair=' + Date.now();
};
function hideControls() { window.readerChromeVisible = false; window.readerUpdateControls(); window.ReactNativeWebView.postMessage(JSON.stringify({controls:'hide'})); }
window.readerSetActive = active => {
  if (!active) report(true);
  window.readerActive = active;
  swipe = null; touch = null;
  scrolling = false; chromeSettlesUntil = Date.now() + 600;
  window.readerUpdateControls();
  if (active) report();
};
addEventListener('touchstart', event => {
  pendingPanelRestore = undefined;
  restoreTarget = undefined;
  if (scrubEvent(event)) { touch = null; swipe = null; return; }
  if (event.touches.length > 1) hideControls();
  const finger = event.touches[0];
  swipe = event.touches.length === 1 && (window.visualViewport?.scale || 1) <= 1.05
    ? {x:finger.clientX,y:finger.clientY,dx:0,dy:0,top:scrollY <= 2,bottom:scrollY + innerHeight >= document.documentElement.scrollHeight - 2} : null;

  touch = event.touches.length === 1
    ? {x:finger.clientX, y:finger.clientY, at:Date.now()} : null;
}, {passive:true});
addEventListener('touchmove', event => {
  if (scrubEvent(event)) return;
  if (swipe) {
    if (event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.05) swipe = null;
    else { userScrolled = true; swipe.dx = event.touches[0].clientX - swipe.x; swipe.dy = event.touches[0].clientY - swipe.y; }
  }
  if (touch && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - touch.x, event.touches[0].clientY - touch.y) > 10)) { touch = null; chromeSettlesUntil = 0; hideControls(); }
}, {passive:true});
addEventListener('touchcancel', () => { swipe = null; touch = null; });
addEventListener('touchend', event => {
  lastTouchEnd = Date.now();
  if (scrubEvent(event)) return;
  if (swipe && !event.touches.length && window.readerContinuous && window.readerActive && !document.hidden && !window.readerChromeVisible && Math.abs(swipe.dy) > 60 && Math.abs(swipe.dy) > Math.abs(swipe.dx) * 1.5) {
    if (swipe.bottom && swipe.dy < 0 && finished) window.ReactNativeWebView.postMessage(JSON.stringify({boundary:'next',chapter:readerChapter}));
    else if (swipe.top && swipe.dy > 0) window.ReactNativeWebView.postMessage(JSON.stringify({boundary:'previous',chapter:readerChapter}));
  }
  swipe = null;
  if (touch && !event.touches.length && Date.now() - touch.at < 350) {
    if (window.readerActive) {
      chromeSettlesUntil = Date.now() + 400;
      window.readerChromeVisible = !window.readerChromeVisible;
      window.readerUpdateControls();
      window.ReactNativeWebView.postMessage(JSON.stringify({controls:window.readerChromeVisible ? 'show' : 'hide'}));
    }
  }
  touch = null;
}, {passive:true});
// Screen-reader activation and mouse clicks do not generate touch events.
addEventListener('click', event => {
  if (scrubEvent(event)) return;
  if (Date.now() - lastTouchEnd > 600 && window.readerActive) {
    chromeSettlesUntil = Date.now() + 400;
    window.readerChromeVisible = !window.readerChromeVisible;
    window.readerUpdateControls();
    window.ReactNativeWebView.postMessage(JSON.stringify({controls:window.readerChromeVisible ? 'show' : 'hide'}));
  }
});
function finalPanelVisible(rect, viewport) {
  return rect.bottom > viewport.top && rect.bottom <= viewport.bottom + 1 && rect.right > viewport.left && rect.left < viewport.right;
}
function checkCompletion() {
  if (finished || !restored || !window.readerActive || document.hidden || chapterRoot?.dataset?.complete === 'false') return false;
  const last = images.at(-1) || (chapterRoot || document).querySelector('.novel p:last-child');
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0, left = viewport ? viewport.offsetLeft : 0;
  const visibleBottom = top + (viewport ? viewport.height : innerHeight) - (window.readerChromeVisible ? (window.readerScrubberBottom || 96) + scrubber.offsetHeight : 0);
  // Opening a short chapter or remaining on its first page is not a completed read.
  const firstPage = images.length > 1 && images[0].getBoundingClientRect().bottom > top;
  if (scrollY + top - chapterBounds().start <= 1 || firstPage || !last || !finalPanelVisible(last.getBoundingClientRect(), {top, left, bottom:visibleBottom, right:left + (viewport ? viewport.width : innerWidth)}) || !images.every(image => image.complete && image.naturalWidth > 0)) return false;
  finished = true; completedChapters.add(readerChapter);
  window.ReactNativeWebView.postMessage(JSON.stringify({complete:true, fraction:1,chapter:readerChapter}));
  return true;
}
function report(snapshot = false) {
  window.readerUpdateControls();
  if (!restored || (!snapshot && (!window.readerActive || document.hidden))) return;
  if (!snapshot && checkCompletion()) return;
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const bounds = chapterBounds();
  const max = Math.max(1, bounds.end - bounds.start - innerHeight);
  const visiblePage = images.findIndex(image => image.getBoundingClientRect().bottom > top);
  const page = visiblePage < 0 ? Math.max(0, images.length - 1) : visiblePage;
  const atStart = scrollY + top - bounds.start <= 1;
  const imageRect = images[page]?.getBoundingClientRect();
  const panel = imageRect ? {index:page,offset:Math.max(0,Math.min(1,(top-imageRect.top)/Math.max(1,imageRect.bottom-imageRect.top)))} : undefined;
  window.ReactNativeWebView.postMessage(JSON.stringify({fraction: finished ? 1 : atStart ? 0 : Math.max(0, Math.min(chapterRoot?.dataset?.complete === 'false' ? 0.99 : 1, (scrollY + top - bounds.start) / max)), page: page + 1,panel,chapter:readerChapter,snapshot,complete:snapshot && finished ? true : undefined}));
}
addEventListener('load', () => { const bounds = chapterBounds(); scrollTo(0, bounds.start + ${safeFraction} * Math.max(0, bounds.end - bounds.start - innerHeight)); restored = true; report(); });
function onScroll() {
  window.readerUpdateControls();
  // Momentum is not finger movement. Preserve intentional taps, including the viewport resize when chrome appears.
  if (!scrubbing && !touch && Date.now() >= chromeSettlesUntil && !scrolling) hideControls();
  checkCompletion();
  window.readerTrackChapter?.();
  scrolling = true;
  clearTimeout(timer); timer = setTimeout(() => { scrolling = false; window.readerTrimChapters?.(); if (restored) report(); }, 400);
}
addEventListener('scroll', onScroll, {passive:true});
window.visualViewport?.addEventListener('scroll', onScroll, {passive:true});
window.visualViewport?.addEventListener('resize', window.readerUpdateControls);
addEventListener('resize', window.readerUpdateControls);
setInterval(checkCompletion, 250);
${readerStreamScript}
</script></body></html>`;
}

// Runs inside the reader WebView, sharing its chapter/progress helpers.
const readerStreamScript = `
const chapterHost = document.getElementById('reader-chapters');
const attaching = new Map(), prefetchRequested = new Set();
let edgeRequested = '';
let lastStreamY = scrollY;
let restoreTarget;
let pendingPanelRestore;
window.readerNeighbors = [];
let endingConfig;
function sectionFor(id) { return [...chapterHost.children].find(node => node.dataset.chapter === id); }
function setDownloadState(node, complete, total) {
  node.dataset.complete = String(complete);
  node.dataset.total = String(total);
  if (!complete) { completedChapters.delete(node.dataset.chapter); if (node === chapterRoot) finished = false; }
  const end = node.querySelector('.end');
  if (end) end.hidden = !complete;
  let tail = node.querySelector('.download-tail');
  if (!complete && !tail) {
    const holder = document.createElement('div'); holder.innerHTML = ${JSON.stringify(waitingPanel)};
    tail = holder.firstElementChild; node.appendChild(tail);
  }
  if (tail) {
    tail.hidden = complete;
    const count = node.querySelectorAll('.reader-panel').length;
    tail.querySelector('.download-label').textContent = total > count ? count + '/' + total + ' panels saved · Waiting for more…' : 'Waiting for download to finish…';
  }
}
window.readerUpdateChapter = (id, content, complete, total) => {
  const node = chapterHost && sectionFor(id);
  if (!node) return;
  const requested = node.readerRequest;
  if (requested?.pending && requested.content === content && requested.complete === complete && requested.total === total) return;
  const version = node.readerUpdateVersion = (node.readerUpdateVersion || 0) + 1;
  const request = node.readerRequest = {content, complete, total, pending:false};
  if (node.readerContent === content && node.dataset.complete === String(complete) && node.dataset.total === String(total)) return;
  const holder = document.createElement('div'); holder.innerHTML = content;
  const prose = holder.querySelector('.novel'), oldProse = node.querySelector('.novel');
  const panels = [...holder.querySelectorAll('.reader-panel')];
  const existing = [...node.querySelectorAll('.reader-panel')], count = existing.length;
  const apply = () => {
    if (sectionFor(id) !== node || node.readerUpdateVersion !== version) return;
    const change = () => {
      if (prose && !oldProse) node.insertBefore(prose, node.querySelector('.end'));
      else if (!prose && oldProse) oldProse.remove();
      for (const panel of existing.slice(panels.length)) panel.remove();
      const before = node.querySelector('.end') || node.querySelector('.download-tail');
      for (const panel of panels.slice(count)) node.insertBefore(panel, before);
      setDownloadState(node, complete, total); node.readerContent = content;
    };
    if (node === chapterRoot) change(); else keepReaderAnchor(change);
    if (node === chapterRoot) { images = [...node.querySelectorAll('img')]; window.readerUpdateControls(); }
    if (pendingPanelRestore?.id === id) window.readerRestorePanel(id, pendingPanelRestore.panel);
  };
  // Decode additions before changing a preceding section's height. Keeping the
  // current anchor then accounts for the full layout change in a single step.
  const pending = node === chapterRoot ? [] : [...holder.querySelectorAll('img')].filter(image => !image.complete).map(image => new Promise(resolve => {
    image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true});
  }));
  if (pending.length) {
    request.pending = true;
    Promise.all(pending).then(() => { request.pending = false; apply(); });
  } else apply();
};
window.readerSetDownloadStatus = (id, status) => {
  const node = sectionFor(id), tail = node?.querySelector('.download-tail');
  if (!tail || tail.hidden) return;
  tail.dataset.state = status;
  const count = node.querySelectorAll('.reader-panel').length, total = Number(node.dataset.total) || 0;
  const label = status === 'paused' ? 'Download paused · Your saved panels are still readable' : status === 'stopped' ? 'Download stopped · Tap to continue' : status === 'cancelling' ? 'Stopping download…' : status === 'error' ? 'Download needs attention' : status === 'waiting' ? 'Download waiting · Open controls for details' : status === 'queued' ? 'More panels are queued…' : total > count ? count + '/' + total + ' panels saved · Waiting for more…' : 'Saving remaining panels…';
  tail.querySelector('.download-label').textContent = label;
};
function keepReaderAnchor(change) {
  const top = chapterRoot.getBoundingClientRect().top;
  change();
  const delta = chapterRoot.getBoundingClientRect().top - top;
  if (delta) scrollTo(0, scrollY + delta);
}
function trimChapters() {
  if (!chapterHost) return;
  keepReaderAnchor(() => {
    for (const node of [...chapterHost.children]) {
      if (node !== chapterRoot && !window.readerNeighbors.includes(node.dataset.chapter)) node.remove();
    }
    renderEnding();
  });
}
window.readerTrimChapters = trimChapters;
window.readerSetNeighbors = (ids, continuous) => {
  window.readerNeighbors = ids;
  window.readerContinuous = continuous;
  // Removing content above the viewport requires scrollTo, which stops Android
  // momentum. Wait for scrolling to settle before reclaiming those sections.
  if (!scrolling) trimChapters();
  lastStreamY = scrollY;
};
function activateChapter(node) {
  if (pendingPanelRestore && pendingPanelRestore.id !== node.dataset.chapter) pendingPanelRestore = undefined;
  if (restoreTarget && restoreTarget.id !== node.dataset.chapter) restoreTarget = undefined;
  if (node === chapterRoot) return;
  chapterRoot = node; readerChapter = node.dataset.chapter;
  images = [...node.querySelectorAll('img')]; finished = completedChapters.has(readerChapter);
  const toast = document.getElementById('chapter-toast');
  if (toast && window.readerActive) {
    toast.textContent = 'Chapter ' + readerChapter;
    toast.getAnimations?.().forEach(animation => animation.cancel());
    toast.animate?.([{opacity:0},{opacity:1,offset:0.12},{opacity:1,offset:0.7},{opacity:0}], {duration:1600});
  }
  window.ReactNativeWebView.postMessage(JSON.stringify({activeChapter:readerChapter}));
}
window.readerRestorePosition = (id, fraction) => {
  const node = chapterHost && sectionFor(id);
  if (!node) { restoreTarget = {id, fraction}; return; }
  restoreTarget = undefined;
  activateChapter(node);
  const bounds = chapterBounds();
  scrollTo(0, bounds.start + scrubFraction(fraction) * Math.max(0, bounds.end - bounds.start - innerHeight));
  report();
};
window.readerRestorePanel = (id, panel) => {
  if (!Number.isInteger(panel?.index) || panel.index < 0 || !Number.isFinite(panel.offset)) return;
  const node = sectionFor(id), image = node?.querySelectorAll('img')[panel.index];
  if (!image) { pendingPanelRestore = {id,panel}; return; }
  if (!image.complete || !image.naturalWidth) {
    const pending = {id,panel}; pendingPanelRestore = pending;
    image.addEventListener('load', () => { if (pendingPanelRestore === pending) window.readerRestorePanel(id, panel); }, {once:true});
    return;
  }
  pendingPanelRestore = undefined;
  activateChapter(node);
  const rect = image.getBoundingClientRect();
  scrollTo(0, Math.max(0, scrollY + rect.top + Math.max(0,Math.min(1,panel.offset)) * (rect.bottom-rect.top)));
  report();
};
window.readerTrackChapter = () => {
  if (!chapterHost || !restored || !window.readerActive || document.hidden || !window.readerContinuous || scrubbing || (window.visualViewport?.scale || 1) > 1.05) return;
  const y = window.visualViewport?.offsetTop || 0;
  const node = [...chapterHost.children].find(node => {
    const rect = node.getBoundingClientRect(); return rect.top <= y + 1 && rect.bottom > y + 1;
  });
  if (node && node !== chapterRoot) { report(); activateChapter(node); edgeRequested = ''; report(); }
  // Request a missing neighbor during the same scroll that reaches the edge.
  // Saved neighbors are already in the document and need no navigation at all.
  const bounds = chapterBounds();
  if (!prefetchRequested.has(readerChapter) && scrollY - bounds.start >= (bounds.end - bounds.start - innerHeight) * 0.65) {
    prefetchRequested.add(readerChapter);
    window.ReactNativeWebView.postMessage(JSON.stringify({prefetch:true,chapter:readerChapter}));
  }
  const direction = scrollY > lastStreamY ? 'next' : scrollY < lastStreamY ? 'previous' : '';
  lastStreamY = scrollY;
  const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
  const atTop = scrollY <= 2;
  if (userScrolled && !window.readerChromeVisible && ((direction === 'next' && atEnd && finished) || (direction === 'previous' && atTop))) {
    const edge = readerChapter + '/' + direction;
    if (edgeRequested !== edge) {
      edgeRequested = edge;
      window.ReactNativeWebView.postMessage(JSON.stringify({boundary:direction,chapter:readerChapter}));
    }
  } else if (!atEnd && !atTop) edgeRequested = '';
};
window.readerAttachChapter = (id, content, complete = true, total = 0) => {
  if (!chapterHost || attaching.has(id)) return;
  if (sectionFor(id)) { window.readerUpdateChapter(id, content, complete, total); return; }
  const node = document.createElement('section');
  node.className = 'reader-chapter'; node.dataset.chapter = id;
  node.innerHTML = content + '<p class="end">Chapter ' + id.replace(/[^0-9.]/g,'') + ' · End</p>';
  setDownloadState(node, complete, total);
  node.readerContent = content;
  const pending = [...node.querySelectorAll('img')].map(image => new Promise(resolve => {
    if (image.complete) resolve();
    else { image.addEventListener('load', resolve, {once:true}); image.addEventListener('error', resolve, {once:true}); }
  }));
  attaching.set(id, node);
  Promise.all(pending).then(() => {
    attaching.delete(id);
    // Downloads can finish after changing chapter or turning continuous mode off.
    if (!window.readerContinuous || (!window.readerNeighbors.includes(id) && restoreTarget?.id !== id) || sectionFor(id)) return;
    keepReaderAnchor(() => window.readerNeighbors[0] === id ? chapterHost.prepend(node) : chapterHost.append(node));
    lastStreamY = scrollY; renderEnding();
    if (restoreTarget?.id === id) window.readerRestorePosition(id, restoreTarget.fraction);
    if (pendingPanelRestore?.id === id) window.readerRestorePanel(id, pendingPanelRestore.panel);
    window.ReactNativeWebView.postMessage(JSON.stringify({attachedChapter:id}));
    window.readerUpdateControls();
  });
};
window.readerOpenChapter = (id, end) => {
  if (!chapterHost) return;
  if (pendingPanelRestore?.id !== id) pendingPanelRestore = undefined;
  if (restoreTarget?.id !== id) restoreTarget = undefined;
  const node = sectionFor(id);
  if (!node) return;
  activateChapter(node);
  userScrolled = false; edgeRequested = '';
  const rect = node.getBoundingClientRect();
  scrollTo(0, Math.max(0, scrollY + (end ? rect.bottom - innerHeight : rect.top)));
  lastStreamY = scrollY; report();
};
window.readerSetAppearance = (size, theme) => {
  if (!chapterHost) return;
  const anchor = chapterNodes('.novel p').find(node => node.getBoundingClientRect().bottom > 0);
  const top = anchor?.getBoundingClientRect().top || 0;
  const appearance = document.getElementById('reader-appearance');
  if (appearance) appearance.textContent = '.novel p{font-size:' + Math.max(14,Math.min(30,size)) + 'px}';
  const prose = Boolean(chapterRoot?.querySelector('.novel'));
  const sepia = prose && theme === 'sepia';
  document.body.style.background = document.documentElement.style.background = sepia ? '#f4ecd8' : '#08080b';
  document.body.style.color = sepia ? '#483b2c' : '#ded9e6';
  if (anchor) scrollTo(0, scrollY + anchor.getBoundingClientRect().top - top);
};
function renderEnding() {
  const ending = document.getElementById('reader-ending');
  if (!ending) return;
  const wasHidden = ending.hidden;
  ending.hidden = !endingConfig || !sectionFor(endingConfig.chapter);
  if (ending.hidden) return;
  const key = JSON.stringify(endingConfig);
  if (!wasHidden && ending.dataset.config === key) return;
  ending.dataset.config = key;
  ending.replaceChildren();
  const heading = document.createElement('h2'), detail = document.createElement('p');
  heading.textContent = endingConfig.title; detail.textContent = endingConfig.error || endingConfig.detail;
  ending.append(heading, detail);
  for (const [action,label] of [
    ['bookmark', endingConfig.bookmarked ? '✓ Bookmarked' : '☆ Bookmark'],
    ['auto', endingConfig.automatic ? '✓ Auto-download' : '↓ Auto-download'],
    ['refresh',endingConfig.refreshing ? 'Checking…' : endingConfig.error ? '↻ Retry update check' : '↻ Check for updates'],
  ]) {
    const button = document.createElement('button'); button.textContent = label;
    if (action !== 'refresh') button.setAttribute('aria-pressed', String(action === 'bookmark' ? endingConfig.bookmarked : endingConfig.automatic));
    if (action === 'refresh') button.disabled = Boolean(endingConfig.refreshing);
    button.onclick = () => window.ReactNativeWebView.postMessage(JSON.stringify({ending:action}));
    ending.append(button);
  }
}
window.readerSetEnding = config => { endingConfig = config; if (chapterHost) keepReaderAnchor(renderEnding); };

`;
