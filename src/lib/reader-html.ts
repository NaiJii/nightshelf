import type { NovelText } from "./parser";

export function readerHtml(files: string[], fraction = 0, novel?: NovelText | null, fontSize = 19, theme: "dark" | "sepia" = "dark"): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
  const safeFraction = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const size = Number.isFinite(fontSize) ? Math.max(14, Math.min(30, fontSize)) : 19;
  const sepia = Boolean(novel) && theme === "sepia";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=6, user-scalable=yes">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>html,body{touch-action:manipulation;margin:0;padding:0;background:${sepia ? "#f4ecd8" : "#08080b"};color:${sepia ? "#483b2c" : "#ded9e6"}}img{display:block;width:100%;height:auto;margin:0}.novel{max-width:720px;margin:auto;padding:24px 22px 50px}.novel p{font:${size}px/1.85 Georgia,serif;margin:0 0 1.2em;text-align:left;overflow-wrap:break-word}.novel h1{font:600 24px/1.4 sans-serif;margin:6px 0 30px}.end{font:12px sans-serif;text-align:center;padding:24px}</style></head><body>
${novel ? `<main class="novel"><h1>${escape(novel.title)}</h1>${novel.paragraphs.map(text => `<p>${escape(text)}</p>`).join("")}</main>` : files.filter(uri => uri.startsWith("file://")).map((uri, index) => `<div class="reader-panel"><img src="${escape(uri)}" alt="Page ${index + 1}" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false;window.ReactNativeWebView.postMessage(JSON.stringify({error:true,page:${index}}))"><button class="panel-repair" hidden onclick="window.ReactNativeWebView.postMessage(JSON.stringify({repair:${index}}))" aria-label="Repair page ${index + 1}">↻ Page ${index + 1} could not open · Tap to repair</button></div>`).join("")}
<style>
.reader-panel img[hidden],.panel-repair[hidden]{display:none}.panel-repair{display:block;width:100%;min-height:60vh;border:0;background:#17171f;color:#c9a7ff;font:14px/1.6 sans-serif;padding:24px;overflow-wrap:anywhere}
#reader-scrubber{position:fixed;z-index:2;box-sizing:border-box;padding:4px 20px 8px;background:#17171ff2;color:#aaa6b3;border-radius:16px;transform-origin:top left;font:11px/1.4 sans-serif;touch-action:none}
#reader-scrubber[hidden],#scrub-preview[hidden],#scrub-crop[hidden],#scrub-text[hidden]{display:none}
#scrub-range{display:block;width:100%;height:44px;margin:0;accent-color:#c9a7ff;touch-action:none}
#scrub-position{display:block;text-align:center}
#scrub-preview{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);width:132px;background:#17171f;border:1px solid #ffffff24;border-radius:10px;overflow:hidden;box-shadow:0 3px 12px #0008;pointer-events:none}
#scrub-crop{height:152px;background-repeat:no-repeat;background-color:#08080b}
#scrub-text{padding:12px;color:#f7f4fb;font:13px/1.5 Georgia,serif;max-height:140px;overflow:hidden}
#scrub-label{display:block;padding:7px;text-align:center;color:#c9a7ff}
</style>
<p class="end">End of chapter</p>
<aside id="reader-scrubber" hidden aria-label="Chapter navigation">
  <div id="scrub-preview" hidden aria-hidden="true"><div id="scrub-crop"></div><div id="scrub-text" hidden></div><span id="scrub-label"></span></div>
  <input id="scrub-range" type="range" min="0" max="10000" step="1" value="0" aria-label="Chapter position">
  <output id="scrub-position" for="scrub-range"></output>
</aside><script>
let timer; const images = [...document.images]; let restored = false, finished = false;
window.readerActive = false;
window.readerChromeVisible = false;
window.readerContinuous = false;
let swipe;
let tapTimer, tapPoint, touch, lastTouchEnd = -Infinity, chromeSettlesUntil = 0, scrolling = false;
const scrubber = document.getElementById('reader-scrubber'), range = document.getElementById('scrub-range');
const preview = document.getElementById('scrub-preview'), crop = document.getElementById('scrub-crop'), snippet = document.getElementById('scrub-text');
const scrubLabel = document.getElementById('scrub-label'), scrubPosition = document.getElementById('scrub-position');
let scrubbing = false;
function scrubFraction(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0; }
function scrubTarget(fraction) {
  const y = fraction * Math.max(0, document.documentElement.scrollHeight - innerHeight);
  const nodes = images.length ? images : [...document.querySelectorAll('.novel p')];
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
    crop.style.backgroundImage = 'url(' + JSON.stringify(target.node.src) + ')';
    crop.style.backgroundSize = '132px auto'; crop.style.backgroundPosition = 'center -' + offset + 'px';
  } else snippet.textContent = (target.node?.textContent || '').slice(0, 180);
  range.setAttribute('aria-valuetext', target.label); scrubPosition.textContent = target.label;
}
function cancelScrub() { scrubbing = false; preview.hidden = true; window.readerUpdateControls(); }
window.readerUpdateControls = () => {
  scrubber.hidden = !restored || !window.readerActive || !window.readerChromeVisible || document.hidden;
  if (scrubber.hidden) { scrubbing = false; preview.hidden = true; return; }
  const viewport = window.visualViewport, scale = viewport?.scale || 1;
  scrubber.style.width = (viewport ? viewport.width * scale : innerWidth) + 'px';
  scrubber.style.left = (viewport?.offsetLeft || 0) + 'px';
  scrubber.style.top = Math.max(0, (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - ((window.readerScrubberBottom || 96) + scrubber.offsetHeight) / scale) + 'px';
  scrubber.style.transform = 'scale(' + 1 / scale + ')';
  crop.style.height = Math.max(40, Math.min(152, (viewport?.height || innerHeight) * scale - (window.readerScrubberBottom || 96) - scrubber.offsetHeight - 60)) + 'px';
  range.disabled = document.documentElement.scrollHeight <= innerHeight;
  if (!scrubbing) {
    const fraction = scrubFraction((scrollY + (viewport?.offsetTop || 0)) / Math.max(1, document.documentElement.scrollHeight - innerHeight));
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
function scrubEvent(event) { return Boolean(event.target?.closest?.('#reader-scrubber,.panel-repair')); }
window.readerPanelRepairState = (index, busy, message) => {
  const button = images[index]?.nextElementSibling;
  if (!button) return;
  button.disabled = busy;
  button.textContent = message || '↻ Page ' + (index + 1) + ' could not open · Tap to repair';
};
window.readerReloadPanel = index => {
  const image = images[index]; if (!image) return;
  const anchor = images.find(value => value.parentElement.getBoundingClientRect().bottom > 0)?.parentElement;
  const top = anchor?.getBoundingClientRect().top || 0;
  image.onload = () => {
    image.hidden = false; image.nextElementSibling.hidden = true;
    if (anchor) scrollTo(0,scrollY + anchor.getBoundingClientRect().top - top);
    window.readerPanelRepairState(index,false); window.readerUpdateControls();
    window.ReactNativeWebView.postMessage(JSON.stringify({repaired:index}));
  };
  window.readerPanelRepairState(index,true,'Opening repaired page…');
  image.src = image.src.split('?')[0] + '?repair=' + Date.now();
};
function hideControls() { window.readerChromeVisible = false; window.readerUpdateControls(); window.ReactNativeWebView.postMessage(JSON.stringify({controls:'hide'})); }
addEventListener('touchstart', event => {
  if (scrubEvent(event)) { touch = null; swipe = null; clearTimeout(tapTimer); tapTimer = undefined; return; }
  if (event.touches.length > 1) hideControls();
  const finger = event.touches[0];
  swipe = event.touches.length === 1 && (window.visualViewport?.scale || 1) <= 1.05
    ? {x:finger.clientX,y:finger.clientY,dx:0,dy:0,top:scrollY <= 2,bottom:scrollY + innerHeight >= document.documentElement.scrollHeight - 2} : null;
  const secondTap = Boolean(tapTimer && finger && tapPoint && Math.hypot(finger.clientX - tapPoint.x, finger.clientY - tapPoint.y) < 32);
  clearTimeout(tapTimer); tapTimer = undefined;
  touch = event.touches.length === 1
    ? {x:finger.clientX, y:finger.clientY, at:Date.now(), double:secondTap} : null;
}, {passive:true});
addEventListener('touchmove', event => {
  if (scrubEvent(event)) return;
  if (swipe) {
    if (event.touches.length !== 1 || (window.visualViewport?.scale || 1) > 1.05) swipe = null;
    else { swipe.dx = event.touches[0].clientX - swipe.x; swipe.dy = event.touches[0].clientY - swipe.y; }
  }
  if (touch && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - touch.x, event.touches[0].clientY - touch.y) > 10)) { touch = null; chromeSettlesUntil = 0; hideControls(); }
}, {passive:true});
addEventListener('touchcancel', () => { swipe = null; touch = null; clearTimeout(tapTimer); tapTimer = undefined; });
addEventListener('touchend', event => {
  lastTouchEnd = Date.now();
  if (scrubEvent(event)) return;
  if (swipe && !event.touches.length && window.readerContinuous && window.readerActive && !document.hidden && !window.readerChromeVisible && Math.abs(swipe.dy) > 60 && Math.abs(swipe.dy) > Math.abs(swipe.dx) * 1.5) {
    if (swipe.bottom && swipe.dy < 0 && finished) window.ReactNativeWebView.postMessage(JSON.stringify({boundary:'next'}));
    else if (swipe.top && swipe.dy > 0) window.ReactNativeWebView.postMessage(JSON.stringify({boundary:'previous'}));
  }
  swipe = null;
  if (touch && !event.touches.length && Date.now() - touch.at < 350) {
    if (touch.double && window.readerActive) {
      hideControls();
      const scale = window.visualViewport?.scale || 1;
      window.ReactNativeWebView.postMessage(JSON.stringify({zoom:scale > 1.05 ? 1 / scale : 2}));
    } else {
      tapPoint = {x:touch.x, y:touch.y};
      tapTimer = setTimeout(() => {
      tapTimer = undefined;
      if (window.readerActive) {
        chromeSettlesUntil = Date.now() + 400;
        window.readerChromeVisible = !window.readerChromeVisible;
        window.readerUpdateControls();
        window.ReactNativeWebView.postMessage(JSON.stringify({controls:window.readerChromeVisible ? 'show' : 'hide'}));
      }
      }, 300);
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
  if (finished || !restored || !window.readerActive || window.readerChromeVisible || document.hidden) return false;
  const last = images.at(-1) || document.querySelector('.novel p:last-child');
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0, left = viewport ? viewport.offsetLeft : 0;
  // Opening a short chapter or remaining on its first page is not a completed read.
  const firstPage = images.length > 1 && images[0].getBoundingClientRect().bottom > top;
  if (scrollY + top <= 1 || firstPage || !last || !finalPanelVisible(last.getBoundingClientRect(), {top, left, bottom:top + (viewport ? viewport.height : innerHeight), right:left + (viewport ? viewport.width : innerWidth)}) || !images.every(image => image.complete && image.naturalWidth > 0)) return false;
  finished = true;
  window.ReactNativeWebView.postMessage(JSON.stringify({complete:true, fraction:1}));
  return true;
}
function report() {
  window.readerUpdateControls();
  if (!restored || !window.readerActive || document.hidden) return;
  if (checkCompletion()) return;
  const viewport = window.visualViewport;
  const top = viewport ? viewport.offsetTop : 0;
  const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const page = Math.max(0, images.findIndex(image => image.getBoundingClientRect().bottom > top));
  const atStart = images.length > 1 ? page === 0 : scrollY + top <= 1;
  window.ReactNativeWebView.postMessage(JSON.stringify({fraction: finished ? 1 : atStart ? 0 : Math.max(0, Math.min(1, (scrollY + top) / max)), page: page + 1}));
}
addEventListener('load', () => { scrollTo(0, ${safeFraction} * Math.max(0, document.documentElement.scrollHeight - innerHeight)); restored = true; report(); });
function onScroll() {
  window.readerUpdateControls();
  // Momentum is not finger movement. Preserve intentional taps, including the viewport resize when chrome appears.
  if (!scrubbing && !touch && !tapTimer && Date.now() >= chromeSettlesUntil && !scrolling) hideControls();
  checkCompletion();
  scrolling = true;
  clearTimeout(timer); timer = setTimeout(() => { scrolling = false; if (restored) report(); }, 400);
}
addEventListener('scroll', onScroll, {passive:true});
window.visualViewport?.addEventListener('scroll', onScroll, {passive:true});
window.visualViewport?.addEventListener('resize', window.readerUpdateControls);
addEventListener('resize', window.readerUpdateControls);
setInterval(checkCompletion, 250);
</script></body></html>`;
}
