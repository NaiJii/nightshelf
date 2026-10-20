import NetInfo from "@react-native-community/netinfo";
import { Alert, AppState } from "react-native";
import { loadPreferences, savePreferences } from "./storage";
import { connectionAccess, connectionPauseMessage } from "./network-policy";

export class NetworkPaused extends Error { name = "NetworkPaused"; }
let pendingConsent: Promise<boolean> | undefined;
let nextAutomaticPrompt = 0;

export function networkGuard(reason: string, automatic = false, backgroundDownload = false) {
  let approved = false;
  return async () => {
    if (AppState.currentState !== "active" && !backgroundDownload) throw new NetworkPaused("Paused while NightShelf is in the background. Reopen and pull down to sync or resume your download.");
    const network = await NetInfo.fetch();
    const access = connectionAccess(network, loadPreferences().mobileData, approved);
    if (access === "offline") throw new NetworkPaused(connectionPauseMessage(access));
    if (access === "allow") return;
    if (access === "deny") throw new NetworkPaused(connectionPauseMessage(access));
    if (AppState.currentState !== "active") throw new NetworkPaused("Waiting for Wi-Fi or mobile-data approval in the app.");
    if (automatic && Date.now() < nextAutomaticPrompt) throw new NetworkPaused(connectionPauseMessage(access));
    if (!pendingConsent) {
      pendingConsent = new Promise<boolean>(resolve => Alert.alert("Use mobile data?",
        `${reason} This connection is cellular, metered, or cannot be verified as Wi-Fi. Downloads can be large. Never keeps NightShelf Wi-Fi-only until you change Settings.`,
        [
          { text: "Never", onPress: () => { savePreferences({ ...loadPreferences(), mobileData: "never" }); resolve(false); } },
          { text: "No", style: "cancel", onPress: () => resolve(false) },
          { text: "Yes", onPress: () => resolve(true) },
        ], { cancelable: false },
      )).finally(() => { pendingConsent = undefined; nextAutomaticPrompt = Date.now() + 10 * 60_000; });
    }
    approved = await pendingConsent;
    // The connection may have changed while the consent dialog was open.
    const currentAccess = connectionAccess(await NetInfo.fetch(), loadPreferences().mobileData, approved);
    if (currentAccess !== "allow") throw new NetworkPaused(connectionPauseMessage(currentAccess));
  };
}
