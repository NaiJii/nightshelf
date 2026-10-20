import { NativeModule, requireOptionalNativeModule } from "expo";

declare class SourceSession extends NativeModule {
  verificationCookies(url: string): Promise<string>;
  verificationUserAgent(): Promise<string>;
}
const session = requireOptionalNativeModule<SourceSession>("NightShelfSourceSession");
export const SOURCE_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
let agent: Promise<string | undefined> | undefined;
export function verificationUserAgent(): Promise<string | undefined> {
  // Keep requests consistent with the unmodified WebView used for the human check.
  return agent ??= session ? session.verificationUserAgent().then(value => value || undefined).catch(error => { agent = undefined; throw error; }) : Promise.resolve(undefined);
}
let verificationUrl = "https://www.mangakakalot.gg/manga-list/hot-manga";
export function isVerificationHost(url: string): boolean {
  try { const value = new URL(url); return value.protocol === "https:" && !value.port && !value.username && !value.password && ["www.mangakakalot.gg", "mangakakalot.gg"].includes(value.hostname); } catch { return false; }
}
export function requireSourceVerification(url: string): Error {
  if (!isVerificationHost(url)) return new Error("Source request was blocked.");
  const page = new URL(url);
  const manga = page.pathname.match(/^\/api\/manga\/([^/]+)\/chapters\/?$/);
  verificationUrl = manga ? `${page.origin}/manga/${manga[1]}` : url;
  return new Error("MangaKakalot needs browser verification. Tap Verify source, complete the website’s check, then retry.");
}
export function sourceVerificationUrl(): string { return verificationUrl; }
export async function verificationCookies(url: string): Promise<string> { return isVerificationHost(url) && session ? session.verificationCookies(url) : ""; }
