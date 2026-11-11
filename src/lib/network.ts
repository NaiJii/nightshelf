import NetInfo from "@react-native-community/netinfo";
import { Alert, AppState } from "react-native";
import { loadPreferences, savePreferences } from "./storage";
import { connectionAccess, connectionPauseMessage } from "./network-policy";

export class NetworkPaused extends Error { name = "NetworkPaused"; }
let pendingConsent: Promise<boolean> | undefined;

export function networkGuard(reason: string, automatic = false, backgroundDownload = false) {
  let approved = false;
  return async () => {
    if (AppState.currentState !== "active" && !backgroundDownload) throw new NetworkPaused("Paused while NightShelf is in the background. Reopen and pull down to sync or resume your download.");
    const network = await NetInfo.fetch();
    const access = connectionAccess(network, loadPreferences().mobileData, approved);
    if (access === "offline") throw new NetworkPaused(connectionPauseMessage(access, network));
    if (access === "allow") return;
    if (access === "deny") throw new NetworkPaused(connectionPauseMessage(access, network));
    if (AppState.currentState !== "active") throw new NetworkPaused("Waiting for unmetered Wi-Fi or metered-connection approval in the app.");
    if (automatic) throw new NetworkPaused(connectionPauseMessage(access, network));
    if (!pendingConsent) {
      pendingConsent = new Promise<boolean>(resolve => Alert.alert(network.type === "wifi" ? "Use metered Wi-Fi?" : network.type === "cellular" ? "Use mobile data?" : "Use this connection?",
        `${reason} ${network.type === "wifi" ? "Android marks this Wi-Fi as metered." : "This connection is cellular, metered, or cannot be verified as unmetered Wi-Fi."} Downloads can be large. Never uses only unmetered Wi-Fi until you change Settings.`,
        [
          { text: "Never", onPress: () => { savePreferences({ ...loadPreferences(), mobileData: "never" }); resolve(false); } },
          { text: "No", style: "cancel", onPress: () => resolve(false) },
          { text: "Yes", onPress: () => resolve(true) },
        ], { cancelable: false },
      )).finally(() => { pendingConsent = undefined; });
    }
    approved = await pendingConsent;
    // The connection may have changed while the consent dialog was open.
    const current = await NetInfo.fetch();
    const currentAccess = connectionAccess(current, loadPreferences().mobileData, approved);
    if (currentAccess !== "allow") throw new NetworkPaused(connectionPauseMessage(currentAccess, current));
  };
}
