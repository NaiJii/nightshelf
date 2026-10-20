import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import NetInfo from "@react-native-community/netinfo";
import { useShelf } from "../lib/app-state";
import { networkGuard } from "../lib/network";
import { isVerificationHost, sourceVerificationUrl } from "../lib/source-session";
import { verificationNavigationAllowed, verificationNetworkKey, VERIFICATION_OBSERVER } from "../lib/verification-policy";
import { verifySourceSession } from "../lib/scraper";
import { color, Icon, ui } from "../components/ui";

export default function VerifySource() {
  const { sourceSessionChanged } = useShelf();
  const [url] = useState(() => sourceVerificationUrl());
  const [webSource] = useState(() => ({ uri: url }));
  const label = "MangaKakalot";
  const [guard] = useState(() => networkGuard(`Open ${label} to verify this phone?`));
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const webRef = useRef<WebView>(null);
  const probeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true, lastKey = "", generation = 0;
    const unsubscribe = NetInfo.addEventListener(state => {
      const key = verificationNetworkKey(state);
      if (key === lastKey) return;
      lastKey = key;
      const version = ++generation;
      probeRef.current?.abort(); setChecking(false);
      setAllowed(false); setReady(false); setStalled(false); setLoading(true);
      void guard().then(() => { if (active && version === generation) { setAllowed(true); setError(""); } }).catch(error => { if (active && version === generation) { setAllowed(false); setError(error instanceof Error ? error.message : "Connection unavailable."); } });
    });
    return () => { active = false; generation++; unsubscribe(); probeRef.current?.abort(); };
  }, [guard, retry]);
  useEffect(() => {
    if (!allowed || ready) return;
    // Page reloads during a challenge must not reset this deadline.
    const timer = setTimeout(() => { setStalled(true); setLoading(false); setError("The website has not accepted verification. Update Android System WebView and Chrome, stay on the same network, then tap Reload. Some sites restrict in-app browsers."); }, 45_000);
    return () => clearTimeout(timer);
  }, [allowed, ready, retry]);
  async function finish() {
    if (checking || !ready) return;
    const controller = new AbortController(); probeRef.current = controller;
    setChecking(true); setError("");
    try {
      await verifySourceSession(url, guard, controller.signal);
      if (!controller.signal.aborted) { sourceSessionChanged(); router.back(); }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Verification failed. Reload and retry."); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  function reload() {
    probeRef.current?.abort(); setChecking(false); setReady(false); setStalled(false); setError(""); setLoading(true);
    setRetry(value => value + 1);
  }
  return <SafeAreaView style={ui.safe} edges={["top", "bottom"]}>
    <View style={[ui.row, { padding: 10 }]}><Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable><Text style={[ui.text, { flex: 1, fontWeight: "800" }]}>Verify {label}</Text><Pressable onPress={reload} style={{ padding: 12 }}><Text style={{ color: color.lilac }}>Reload</Text></Pressable></View>
    <Text style={[ui.muted, { paddingHorizontal: 20, paddingBottom: 10 }]}>Complete the website’s check below. Once the source page opens, tap Use session to test access and return.</Text>
    {loading && allowed && !stalled && <View style={[ui.row, { paddingHorizontal: 20, paddingBottom: 10 }]}><ActivityIndicator size="small" color={color.lilac} /><Text style={ui.muted}>Loading verification page…</Text></View>}
    {error ? <Text accessibilityLiveRegion="polite" style={[ui.muted, { paddingHorizontal: 20, paddingBottom: 10 }]}>{error}</Text> : null}
    {allowed ? <WebView ref={webRef} source={webSource} originWhitelist={["https://*", "about:blank", "about:srcdoc"]} style={{ flex: 1 }} sharedCookiesEnabled thirdPartyCookiesEnabled javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} mixedContentMode="never" onShouldStartLoadWithRequest={request => verificationNavigationAllowed(request.url)} injectedJavaScript={VERIFICATION_OBSERVER}
      onLoadStart={() => { setLoading(true); setReady(false); }}
      onLoadEnd={() => { setLoading(false); webRef.current?.injectJavaScript(VERIFICATION_OBSERVER); }}
      onMessage={event => {
        try { const data = JSON.parse(event.nativeEvent.data); if (data.type === "source-ready" && isVerificationHost(data.url)) { setReady(true); setLoading(false); setStalled(false); setError(""); } } catch { /* unrelated source scripts */ }
      }}
      onError={event => { setLoading(false); setError(event.nativeEvent.description); }}
    /> : !error && <ActivityIndicator color={color.lilac} style={{ padding: 30 }} />}
    <View style={{ padding: 16, borderTopWidth: 1, borderColor: color.line }}><Pressable disabled={!ready || checking} onPress={() => void finish()} style={[ui.primary, { opacity: ready ? 1 : 0.45 }]}>{checking ? <View style={ui.row}><ActivityIndicator color="white" size="small" /><Text style={ui.primaryText}>Testing source access…</Text></View> : <Text style={ui.primaryText}>{ready ? "Use session" : stalled ? "Verification not completed" : "Waiting for the source page"}</Text>}</Pressable></View>
  </SafeAreaView>;
}
