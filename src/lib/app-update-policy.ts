export const RELEASES_API = "https://api.github.com/repos/NaiJii/nightshelf/releases?per_page=20";
export type InstalledApp = { version: string; versionCode: number; architecture: "arm64" | "armv7"; canInstall: boolean };
export type AppUpdate = { version: string; architecture: "arm64" | "armv7"; url: string; sha256: string; size: number; notes: string };
const versionParts = (value: string) => /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value) ? value.split(".").map(Number) : null;
export function newerVersion(next: string, current: string): boolean {
  const a = versionParts(next), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function validAppUpdate(value: unknown, installed: InstalledApp): AppUpdate | null {
  if (!value || typeof value !== "object") return null;
  const update = value as AppUpdate;
  if (typeof update.version !== "string" || !newerVersion(update.version, installed.version) || update.architecture !== installed.architecture || !Number.isSafeInteger(update.size) || update.size < 1024 || update.size > 300 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(update.sha256)) return null;
  const expected = `https://github.com/NaiJii/nightshelf/releases/download/v${update.version}/NightShelf-${update.version}-${installed.architecture}.apk`;
  if (update.url !== expected) return null;
  return { ...update, notes: typeof update.notes === "string" ? update.notes.slice(0, 10000) : "" };
}
export function selectAppUpdate(releases: unknown, installed: InstalledApp): AppUpdate | null {
  if (!Array.isArray(releases)) throw new Error("GitHub returned an invalid release list.");
  let latest: AppUpdate | null = null;
  for (const release of releases) {
    if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) continue;
    const version = release.tag_name.replace(/^v/, "");
    for (const asset of release.assets) {
      if (!asset || asset.name !== `NightShelf-${version}-${installed.architecture}.apk` || asset.state !== "uploaded" || typeof asset.digest !== "string" || !asset.digest.startsWith("sha256:")) continue;
      const update = validAppUpdate({ version, architecture: installed.architecture, url: asset.browser_download_url, sha256: asset.digest.slice(7), size: asset.size, notes: release.body }, installed);
      if (update && (!latest || newerVersion(update.version, latest.version))) latest = update;
    }
  }
  return latest;
}
