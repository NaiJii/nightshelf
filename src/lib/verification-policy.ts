export function verificationNavigationAllowed(url: string): boolean {
  if (url === "about:blank" || url === "about:srcdoc") return true;
  try {
    const value = new URL(url);
    return value.protocol === "https:" && !value.port && !value.username && !value.password &&
      (["www.mangakakalot.gg", "mangakakalot.gg", "challenges.cloudflare.com"].includes(value.hostname) || value.hostname.endsWith(".challenges.cloudflare.com"));
  } catch { return false; }
}
export function verificationNetworkKey(state: { type: string; isConnected: boolean | null; isInternetReachable?: boolean | null; details?: { isConnectionExpensive?: boolean } | null }): string {
  // Reachability changing from unknown to true is not a network change and must not remount WebView.
  return `${state.type}:${Boolean(state.isConnected)}:${state.isInternetReachable !== false}:${Boolean(state.details?.isConnectionExpensive)}`;
}
export const VERIFICATION_OBSERVER = `(() => {
  if (window.nightShelfVerificationTimer) clearInterval(window.nightShelfVerificationTimer);
  let attempts = 0;
  function inspect() {
    const challenge = /just a moment|attention required|verify you are human/i.test(document.title);
    const ready = !challenge && Boolean(document.querySelector('.comic-list, .panel_story_list, .manga-info-top, .container-chapter-reader'));
    if (ready) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'source-ready', url: location.href }));
    if (ready || ++attempts >= 600) clearInterval(window.nightShelfVerificationTimer);
  }
  window.nightShelfVerificationTimer = setInterval(inspect, 500);
  inspect();
})(); true;`;
