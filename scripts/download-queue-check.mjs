import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { throwIfAborted, withAbort } from '../src/lib/request-control.ts';
const hook = registerHooks({resolve(specifier,context,next){
  if(specifier==='./request-control' && context.parentURL?.endsWith('/download-queue.ts'))return next(new URL('../src/lib/request-control.ts',import.meta.url).href,context);
  return next(specifier,context);
}});
const { DownloadQueue } = await import('../src/lib/download-queue.ts'); hook.deregister();
const {AbortController:LegacyAbortController}=createRequire(import.meta.url)('abort-controller');
const legacy=new LegacyAbortController();
assert.equal(typeof legacy.signal.throwIfAborted,'undefined','exercise the same legacy signal shape used by React Native');
const blocked=withAbort(()=>new Promise(()=>{}),legacy.signal); legacy.abort();
await assert.rejects(()=>blocked,{name:'AbortError'});
assert.throws(()=>throwIfAborted(legacy.signal),{name:'AbortError'});

const tick = () => new Promise(resolve => setImmediate(resolve));
const tasks = new Map(), removed = [], changes = [];
let active = 0, peak = 0, foreground = true;
const series = slug => ({slug,title:slug,url:`https://asurascans.com/comics/${slug}`});
const queue = new DownloadQueue([], async (job,signal,progress,plan) => {
  signal.throwIfAborted(); active++; peak = Math.max(peak,active);
  assert.ok(active <= 2,'at most two series run concurrently');
  plan(job.chapters || ['1','2']); progress('Page saved',0.5);
  try {
    await new Promise((resolve,reject) => {
      tasks.set(job.series.slug,{resolve,reject,signal,chapters:job.chapters});
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
    signal.throwIfAborted();
  } finally { active--; }
}, jobs=>changes.push(structuredClone(jobs)), slug=>{
  assert.ok(!queue.isBusy(slug) || !tasks.get(slug) || tasks.get(slug).signal.aborted,'delete follows abort');
  assert.equal(active,0,'this test only deletes after all writers stopped'); removed.push(slug);
}, ()=>foreground);

queue.enqueue(series('a'),'@latest'); queue.enqueue(series('b'),'@first'); queue.enqueue(series('c'),'1-2');
assert.equal(queue.enqueue(series('a'),'3-4'),false,'the same series cannot have competing writers');
await tick(); assert.equal(active,2); assert.equal(queue.jobs.find(job=>job.series.slug==='c').status,'queued');
queue.pause('a'); await tick();
assert.equal(queue.jobs.find(job=>job.series.slug==='a').status,'paused'); assert.ok(tasks.has('c'),'pausing frees a slot');
queue.resume('a'); tasks.get('b').resolve(); await tick();
assert.deepEqual(tasks.get('a').chapters,['1','2'],'resume uses the original chapter plan');
tasks.get('c').resolve(); tasks.get('a').resolve(); await tick(); assert.equal(queue.jobs.length,0);
queue.enqueue(series('keep'),''); await tick(); await queue.cancel('keep');
assert.deepEqual(removed,[],'cancel keeping files never invokes deletion');
queue.enqueue(series('delete'),''); await tick(); await queue.cancel('delete',true);
assert.deepEqual(removed,['delete']); assert.equal(active,0);
queue.enqueue(series('failed'),''); await tick(); tasks.get('failed').reject(Error('HTTP failure')); await tick();
assert.equal(queue.jobs[0].status,'error'); assert.equal(queue.isBusy('failed'),false);
queue.resume('failed'); await tick(); tasks.get('failed').resolve(); await tick();
queue.enqueue(series('manual'),''); queue.enqueue(series('background'),''); await tick();
queue.pause('manual'); foreground=false; queue.suspend(); await tick();
assert.equal(queue.jobs.find(job=>job.series.slug==='background').status,'waiting');
foreground=true; queue.resumeWaiting(); await tick();
assert.equal(queue.jobs.find(job=>job.series.slug==='manual').status,'paused','network recovery never resumes a user-paused job');
tasks.get('background').resolve(); await tick(); await queue.cancel('manual');
const restored = new DownloadQueue([{series:series('restart'),selection:'1-2',chapters:['1','2'],status:'downloading',message:'x',progress:0.5}],async()=>{},()=>{},()=>{});
assert.equal(restored.jobs[0].status,'paused','an app restart does not silently start downloads');
assert.deepEqual(restored.jobs[0].chapters,['1','2']);
assert.equal(peak,2); assert.ok(changes.length>0);
console.log('Concurrent download queue check passed');

// Native transfers leave the JS preparation slots free; cancellation still awaits the writer.
const nativeOrder=[];
const delegated=new DownloadQueue([],async()=>"native",()=>{},slug=>nativeOrder.push('deleted:'+slug));
for(const slug of ['n1','n2','n3'])delegated.enqueue(series(slug),'1');
await tick();await tick();
assert.equal(delegated.jobs.length,3);assert.ok(delegated.jobs.every(job=>job.native),'all queued series can be handed to Android while it limits actual image workers');
assert.equal(delegated.isBusy(),false,'JS metadata slots are released after native handoff');
delegated.reconcileNative({n1:{state:'done',active:false,message:'Done',progress:1},n2:{state:'running',active:true,message:'Pages',progress:0.5}});
assert.equal(delegated.jobs.length,2);assert.equal(delegated.jobs.find(job=>job.series.slug==='n2').progress,0.5);
let closeWriter;
const cancelNative=delegated.cancel('n2',true,()=>new Promise(resolve=>{closeWriter=()=>{nativeOrder.push('writer closed');resolve();};}));
await tick();assert.deepEqual(nativeOrder,[],'native files cannot be deleted before their stream closes');
closeWriter();await cancelNative;assert.deepEqual(nativeOrder,['writer closed','deleted:n2']);
delegated.pause('n3');
delegated.reconcileNative({n3:{state:'running',active:true,message:'Stopping',progress:0.2}});
assert.equal(delegated.jobs[0].status,'paused','a pending pause is not overwritten by stale native progress');
delegated.reconcileNative({n3:{state:'paused',active:false,message:'Paused',progress:0.2}});
assert.equal(delegated.jobs[0].status,'paused');
console.log('Native handoff, progress reconciliation and safe cancellation checks passed');
