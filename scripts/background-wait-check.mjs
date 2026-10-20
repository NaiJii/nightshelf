import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const nativeURL = `data:text/javascript,${encodeURIComponent(`export let state; export function set(value){state=value;} export const NativeModule=class{}; export function requireOptionalNativeModule(){return {states:()=>JSON.stringify(state?{job:state}:{}),pause:async()=>{}};}`)}`;
const hook=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.endsWith("/background-downloads.ts")) {
    if(specifier==="expo")return {url:nativeURL,shortCircuit:true};
    if(specifier==="./network")return {url:"data:text/javascript,export class NetworkPaused extends Error {}",shortCircuit:true};
    if(specifier==="./request-control")return next(new URL("../src/lib/request-control.ts",import.meta.url).href,context);
  }
  return next(specifier,context);
}});
const {waitForTransfer}=await import("../src/lib/background-downloads.ts");
const native=await import(nativeURL);
hook.deregister();
const aborted=new AbortController();aborted.abort();
const state={state:"queued",active:false,progress:0,message:"Queued",hasPlan:true};
native.set(state);
await assert.rejects(waitForTransfer("job",()=>{},()=>{},aborted.signal),{name:"AbortError"});
native.set(undefined);
await assert.rejects(waitForTransfer("job",()=>{},()=>{},aborted.signal),{name:"AbortError"});
native.set({...state,state:"running"});
await assert.rejects(waitForTransfer("job",()=>{},()=>{}),{name:"DownloadPaused"});
// Cancellation must still wait for an active native writer to close.
native.set({...state,state:"running",active:true});
let settled=false;
const closing=waitForTransfer("job",()=>{},()=>{},aborted.signal).finally(()=>{settled=true;});
await new Promise(resolve=>setTimeout(resolve,30));
assert.equal(settled,false);
native.set({...state,state:"paused"});
await assert.rejects(closing,{name:"AbortError"});
native.set({...state,state:"done"});
await waitForTransfer("job",()=>{},()=>{});
console.log("Native transfer cancellation, interrupted service and writer-close checks passed");
