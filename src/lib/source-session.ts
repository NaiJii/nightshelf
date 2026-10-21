import { NativeModule, requireOptionalNativeModule } from "expo";
import { ProviderError } from "./provider-errors";
import { providerInfo, sourceIdForUrl } from "./provider-info";
import { DESKTOP_AGENT } from "./providers/assets";

declare class SourceSession extends NativeModule {
  verificationCookies(url: string): Promise<string>;
  verificationUserAgent(): Promise<string>;
}
const session = requireOptionalNativeModule<SourceSession>("NightShelfSourceSession");
export const SOURCE_AGENT = DESKTOP_AGENT;
let agent: Promise<string | undefined> | undefined;
export function verificationUserAgent(): Promise<string | undefined> {
  // Keep requests consistent with the unmodified WebView used for the human check.
  return agent ??= session ? session.verificationUserAgent().then(value => value || undefined).catch(error => { agent = undefined; throw error; }) : Promise.resolve(undefined);
}
let verificationUrl = providerInfo("mangakakalot").verification!.url;
export function isVerificationHost(url: string): boolean {
  const source = sourceIdForUrl(url);
  return Boolean(source && providerInfo(source).verification);
}
export function requireSourceVerification(url: string): Error {
  const source = sourceIdForUrl(url);
  if (!source || !providerInfo(source).verification) return new Error("Source request was blocked.");
  const info = providerInfo(source);
  verificationUrl = info.verification!.pageUrl?.(url) || url;
  return new ProviderError("verification", source, `${info.name} needs browser verification. Tap Verify source, complete the website’s check, then retry.`);
}
export function sourceVerificationUrl(): string { return verificationUrl; }
export async function verificationCookies(url: string): Promise<string> { return isVerificationHost(url) && session ? session.verificationCookies(url) : ""; }
