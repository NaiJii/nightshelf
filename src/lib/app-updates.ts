import { NativeModule, requireOptionalNativeModule } from "expo";
import type { InstalledApp } from "./app-update-policy";
declare class AppUpdates extends NativeModule {
  installed(): string;
  verify(uri: string, sha256: string, version: string): Promise<boolean>;
  install(uri: string, contentUri: string): Promise<"permission" | "installer">;
}
export const appUpdates = requireOptionalNativeModule<AppUpdates>("NightShelfAppUpdates");
export function installedApp(): InstalledApp | null {
  try { return appUpdates ? JSON.parse(appUpdates.installed()) : null; } catch { return null; }
}
