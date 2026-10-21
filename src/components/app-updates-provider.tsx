import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Directory, File, Paths } from "expo-file-system";
import { useShelf } from "../lib/app-state";
import { ROOT } from "../lib/storage";
import { networkGuard } from "../lib/network";
import { installedApp } from "../lib/app-updates";
import { RELEASES_API, selectAppUpdate, validAppUpdate } from "../lib/app-update-policy";

function cache() {
  try { return JSON.parse(new File(ROOT, "app-update.json").textSync()) as { checkedAt?: number; update?: unknown }; } catch { return {}; }
}
function useUpdatesState() {
  const { preferences } = useShelf();
  const [installed] = useState(installedApp);
  const [initial] = useState(cache);
  const [update, setUpdate] = useState(() => installed ? validAppUpdate(initial.update, installed) : null);
  const [checkedAt, setCheckedAt] = useState(typeof initial.checkedAt === "number" ? initial.checkedAt : 0);
  const [checking, setChecking] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (installed && initial.update && !validAppUpdate(initial.update, installed)) {
      try { const folder = new Directory(Paths.cache, "app-updates"); if (folder.exists) folder.delete(); } catch { /* Android may already have evicted the APK cache. */ }
    }
  }, [installed, initial]);
  const busy = useRef(false), nextAttempt = useRef(0);
  const check = useCallback(async (manual = false) => {
    if (!installed || busy.current || (!manual && (preferences.autoAppUpdates === false || Date.now() < nextAttempt.current || (checkedAt <= Date.now() && Date.now() - checkedAt < 24 * 3600_000)))) return;
    busy.current = true;
    try {
      if (manual) await networkGuard("Check for a NightShelf update?")();
      else {
        const network = await NetInfo.fetch();
        if (AppState.currentState !== "active" || network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) return;
      }
      nextAttempt.current = Date.now() + 15 * 60_000;
      setChecking(true); setError("");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(RELEASES_API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? "GitHub is limiting update checks. Try again later." : `Update check failed (${response.status}).`);
        const latest = selectAppUpdate(await response.json(), installed);
        const at = Date.now();
        setUpdate(latest); setCheckedAt(at);
        ROOT.create({ intermediates: true, idempotent: true });
        new File(ROOT, "app-update.json").write(JSON.stringify({ checkedAt: at, update: latest }));
      } finally { clearTimeout(timer); }
    } catch (failure) { if (manual) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Update check timed out. Try again."); }
    finally { busy.current = false; setChecking(false); }
  }, [installed, checkedAt, preferences.autoAppUpdates]);
  useEffect(() => {
    const timer = setTimeout(() => { void check(); }, 500);
    const listener = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    const network = NetInfo.addEventListener(() => { void check(); });
    return () => { clearTimeout(timer); listener.remove(); network(); };
  }, [check]);
  return { installed, update, checking, checkedAt, error, check };
}
const UpdatesContext = createContext<ReturnType<typeof useUpdatesState> | null>(null);
export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  return <UpdatesContext.Provider value={useUpdatesState()}>{children}</UpdatesContext.Provider>;
}
export function useAppUpdates() {
  const context = useContext(UpdatesContext);
  if (!context) throw new Error("AppUpdatesProvider is missing");
  return context;
}
