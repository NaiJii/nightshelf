import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const busy = useRef(false), launch = useRef(0), checkedLaunch = useRef(-1);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const latestCheck = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  const check = useCallback(async function checkUpdates(manual = false): Promise<void> {
    if (!installed || busy.current || (!manual && (preferences.autoAppUpdates === false || checkedLaunch.current === launch.current))) return;
    const generation = launch.current;
    busy.current = true;
    try {
      if (manual) await networkGuard("Check for a NightShelf update?")();
      else {
        const network = await NetInfo.fetch();
        if (AppState.currentState !== "active" || network.type !== "wifi" || !network.isConnected || network.isInternetReachable === false || network.details?.isConnectionExpensive) return;
      }
      if (generation !== launch.current || AppState.currentState !== "active") return;
      checkedLaunch.current = generation;
      setChecking(true); setError("");
      const controller = new AbortController(); request.current = controller;
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(RELEASES_API, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? "GitHub is limiting update checks. Try again later." : `Update check failed (${response.status}).`);
        const latest = selectAppUpdate(await response.json(), installed);
        if (controller.signal.aborted || generation !== launch.current) return;
        const at = Date.now();
        setUpdate(latest); setCheckedAt(at);
        ROOT.create({ intermediates: true, idempotent: true });
        new File(ROOT, "app-update.json").write(JSON.stringify({ checkedAt: at, update: latest }));
      } finally { clearTimeout(timer); request.current = null; }
    } catch (failure) { if (manual && generation === launch.current) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Update check timed out. Try again."); }
    finally {
      busy.current = false;
      if (mounted.current) setChecking(false);
      if (mounted.current && generation !== launch.current && AppState.currentState === "active") void latestCheck.current();
    }
  }, [installed, preferences.autoAppUpdates]);
  useLayoutEffect(() => { latestCheck.current = check; }, [check]);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { launch.current++; request.current?.abort(); };
    const timer = setTimeout(() => { void check(); }, 500);
    let state = AppState.currentState;
    const listener = AppState.addEventListener("change", next => {
      if (next === state) return;
      state = next;
      if (next === "active") void check();
      else invalidate();
    });
    const network = NetInfo.addEventListener(() => { void check(); });
    return () => { mounted.current = false; clearTimeout(timer); listener.remove(); network(); invalidate(); };
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
