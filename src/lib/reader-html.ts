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
${novel ? `<main class="novel"><h1>${escape(novel.title)}</h1>${novel.paragraphs.map(text => `<p>${escape(text)}</p>`).join("")}</main>` : files.filter(uri => uri.startsWith("file://")).map((uri, index) => `<img src="${escape(uri)}" alt="Page ${index + 1}" decoding="async" onerror="window.ReactNativeWebView.postMessage(JSON.stringify({error:true}))">`).join("")}
<p class="end">End of chapter</p><script>
let timer; const images = [...document.images]; let restored = false, finished = false;
window.readerActive = false;
window.readerChromeVisible = false;
let tapTimer, tapPoint, touch, lastTouchEnd = -Infinity, chromeSettlesUntil = 0, scrolling = false;
function hideControls() { window.readerChromeVisible = false; window.ReactNativeWebView.postMessage(JSON.stringify({controls:'hide'})); }
addEventListener('touchstart', event => {
  if (event.touches.length > 1) hideControls();
  const finger = event.touches[0];
  const secondTap = Boolean(tapTimer && finger && tapPoint && Math.hypot(finger.clientX - tapPoint.x, finger.clientY - tapPoint.y) < 32);
  clearTimeout(tapTimer); tapTimer = undefined;
  touch = event.touches.length === 1
    ? {x:finger.clientX, y:finger.clientY, at:Date.now(), double:secondTap} : null;
}, {passive:true});
addEventListener('touchmove', event => {
  if (touch && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - touch.x, event.touches[0].clientY - touch.y) > 10)) { touch = null; chromeSettlesUntil = 0; hideControls(); }
}, {passive:true});
addEventListener('touchcancel', () => { touch = null; clearTimeout(tapTimer); tapTimer = undefined; });
addEventListener('touchend', event => {
  lastTouchEnd = Date.now();
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
        window.ReactNativeWebView.postMessage(JSON.stringify({controls:window.readerChromeVisible ? 'show' : 'hide'}));
      }
      }, 300);
    }
  }
  touch = null;
}, {passive:true});
// Screen-reader activation and mouse clicks do not generate touch events.
addEventListener('click', () => {
  if (Date.now() - lastTouchEnd > 600 && window.readerActive) {
    chromeSettlesUntil = Date.now() + 400;
    window.readerChromeVisible = !window.readerChromeVisible;
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
  // Momentum is not finger movement. Preserve intentional taps, including the viewport resize when chrome appears.
  if (!touch && !tapTimer && Date.now() >= chromeSettlesUntil && !scrolling) hideControls();
  checkCompletion();
  scrolling = true;
  clearTimeout(timer); timer = setTimeout(() => { scrolling = false; if (restored) report(); }, 400);
}
addEventListener('scroll', onScroll, {passive:true});
window.visualViewport?.addEventListener('scroll', onScroll, {passive:true});
setInterval(checkCompletion, 250);
</script></body></html>`;
}
