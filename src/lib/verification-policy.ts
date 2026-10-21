import { providerInfo, sourceIdForUrl } from "./provider-info";
export function verificationNavigationAllowed(url: string): boolean {
  if (url === "about:blank" || url === "about:srcdoc") return true;
  try {
    const value = new URL(url);
    return value.protocol === "https:" && !value.port && !value.username && !value.password &&
      (Boolean(sourceIdForUrl(url) && providerInfo(sourceIdForUrl(url)!).verification) || value.hostname === "challenges.cloudflare.com" || value.hostname.endsWith(".challenges.cloudflare.com"));
  } catch { return false; }
}
export function verificationNetworkKey(state: { type: string; isConnected: boolean | null; isInternetReachable?: boolean | null; details?: { isConnectionExpensive?: boolean } | null }): string {
  // Reachability changing from unknown to true is not a network change and must not remount WebView.
  return `${state.type}:${Boolean(state.isConnected)}:${state.isInternetReachable !== false}:${Boolean(state.details?.isConnectionExpensive)}`;
}
export function verificationObserver(selector: string): string { return `(() => {
  if (window.nightShelfVerificationTimer) clearInterval(window.nightShelfVerificationTimer);
  let attempts = 0;
  function inspect() {
    const challenge = /just a moment|attention required|verify you are human/i.test(document.title);
    const ready = !challenge && Boolean(document.querySelector(${JSON.stringify(selector)}));
    if (ready) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'source-ready', url: location.href }));
    if (ready || ++attempts >= 600) clearInterval(window.nightShelfVerificationTimer);
  }
  window.nightShelfVerificationTimer = setInterval(inspect, 500);
  inspect();
})(); true;`; }
export const VERIFICATION_OBSERVER = verificationObserver(providerInfo("mangakakalot").verification!.readySelector);
