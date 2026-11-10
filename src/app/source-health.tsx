import { Pressable } from "../components/pressable";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SOURCES, SourceId } from "../lib/parser";
import { recordSourceHealth, sourceHealth } from "../lib/library-tools";
import { browseCatalog, FIRST_PAGE, verifySourceSession } from "../lib/scraper";
import { networkGuard, NetworkPaused } from "../lib/network";
import { useSourceRetry } from "../components/use-source-retry";
import { useShelf } from "../lib/app-state";
import { color, Icon, Page, ui } from "../components/ui";

export default function SourceStatus() {
  const { preferences, reloadLocal } = useShelf();
  const [health, setHealth] = useState(sourceHealth);
  const [busy, setBusy] = useState<SourceId | null>(null);
  const request = useRef<AbortController | null>(null);
  useFocusEffect(useCallback(() => { setHealth(sourceHealth()); setBusy(null); return () => { request.current?.abort(); request.current = null; }; }, []));
  async function check(source: SourceId) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(source);
    try {
      const access = networkGuard("Check this source’s public catalog?");
      const result = await browseCatalog({ source, mode: "comics", sort: "updated", period: "week", query: "", language: preferences.webtoonLanguage, refresh: true }, { ...FIRST_PAGE }, access, controller.signal, undefined, false);
      const verification = SOURCES.find(info => info.id === source)?.verification;
      if (verification) await verifySourceSession(verification.url, access, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ids.length) recordSourceHealth(source, "parser", "Website opened, but no catalog entries were recognized.");
      else recordSourceHealth(source, "ok", "Public catalog is working");
      reloadLocal();
    } catch (error) { if (!controller.signal.aborted) { if (error instanceof NetworkPaused) recordSourceHealth(source, "network", error.message); else if (!sourceHealth()[source] || sourceHealth()[source]?.state === "ok") recordSourceHealth(source, "parser", error instanceof Error ? error.message : "Catalog parsing failed"); } }
    finally { if (request.current === controller) { request.current = null; setHealth(sourceHealth()); setBusy(null); } }
  }
  const verificationSource = useRef(SOURCES.find(info => info.verification)?.id || SOURCES[0].id);
  const verify = useSourceRetry(() => { void check(verificationSource.current); }, () => verificationSource.current);
  const labels = { ok: "Working", verification: "Verification required", unavailable: "Website unavailable", network: "Connection problem", parser: "Parser needs attention" };
  return <Page title="Source health" subtitle="CONNECTIONS & CATALOGS" action={<Pressable accessibilityLabel="Back" onPress={() => router.back()} style={{ padding: 12 }}><Icon name="arrow-back" /></Pressable>}><View style={{ paddingHorizontal: 22 }}><Text style={ui.muted}>Status from this phone’s recent requests.</Text>
    {SOURCES.map(({ id, name, verification }) => { const value = health[id]; return <View key={id} style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: color.line }}><View style={ui.row}><Icon name={value?.state === "ok" ? "checkmark-circle" : value ? "alert-circle-outline" : "help-circle-outline"} tint={value?.state === "ok" ? "#65cba1" : value ? "#d6a84b" : color.muted} /><Text style={[ui.text, { flex: 1, fontSize:16, fontWeight:"700" }]}>{name}</Text><Pressable disabled={Boolean(busy)} onPress={() => void check(id)} style={{ padding:10,minHeight:44,minWidth:44,alignItems:"center",justifyContent:"center" }}>{busy === id ? <ActivityIndicator color={color.lilac} /> : <Text style={{ color: color.lilac }}>Check</Text>}</Pressable></View><Text style={[ui.text, { marginTop: 12 }]}>{value ? labels[value.state] : "Not checked yet"}</Text>{value && <>{value.state !== "ok" && <Text style={[ui.muted, { marginTop: 5 }]}>{value.message}</Text>}<Text style={[ui.muted, { fontSize: 11, marginTop: 8 }]}>Checked {new Date(value.checkedAt).toLocaleString()}{value.lastSuccess && value.lastSuccess !== value.checkedAt ? ` · Last success ${new Date(value.lastSuccess).toLocaleString()}` : ""}</Text></>}{verification && value?.state === "verification" && <Pressable onPress={() => { verificationSource.current = id; verify(); }} style={{ paddingVertical: 12 }}><Text style={{ color: color.lilac }}>Verify and retry</Text></Pressable>}</View>; })}
  </View></Page>;
}
