export function connectionLabel(state: { isConnected: boolean | null; isInternetReachable: boolean | null; type: string; details?: { isConnectionExpensive?: boolean } | null }) {
  if (state.isConnected === false || state.type === "none") return { label: "Offline", icon: "cloud-offline-outline" as const, warning: true };
  if (state.isInternetReachable === false) return { label: "No internet", icon: "cloud-offline-outline" as const, warning: true };
  if (state.isConnected === null || state.isInternetReachable === null || state.type === "unknown") return { label: "Checking…", icon: "ellipsis-horizontal" as const, warning: false };
  if (state.type === "cellular") return { label: "Mobile data", icon: "cellular-outline" as const, warning: true };
  if (state.type === "wifi") return { label: state.details?.isConnectionExpensive ? "Metered Wi-Fi" : "Wi-Fi", icon: "wifi-outline" as const, warning: Boolean(state.details?.isConnectionExpensive) };
  return { label: state.details?.isConnectionExpensive ? "Metered" : "Online", icon: "globe-outline" as const, warning: Boolean(state.details?.isConnectionExpensive) };
}

export function connectionAccess(
  state: { isConnected: boolean | null; isInternetReachable: boolean | null; type: string; details?: { isConnectionExpensive?: boolean } | null },
  policy: "ask" | "allow" | "never",
  approved: boolean,
): "allow" | "offline" | "deny" | "ask" {
  if (!state.isConnected || state.isInternetReachable === false) return "offline";
  if (state.type === "wifi" && state.details?.isConnectionExpensive !== true) return "allow";
  if (policy === "never") return "deny";
  return policy === "allow" || approved ? "allow" : "ask";
}

export function connectionPauseMessage(access: ReturnType<typeof connectionAccess>): string {
  return access === "allow" ? "" : access === "offline" ? "You’re offline. Your library is still available." : "Waiting for Wi-Fi. You can change mobile data access in Settings.";
}
