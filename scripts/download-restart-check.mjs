import assert from 'node:assert/strict';
import { DownloadQueue } from '../src/lib/download-queue.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const series = {slug:'restart-audit',title:'Restart audit',url:'https://example.com/story'};
const job = extra => ({series,selection:'1',chapters:['1'],status:'downloading',message:'Saving',progress:.2,...extra});
const state = extra => ({state:'running',active:true,hasPlan:true,scheduled:false,message:'Saving',progress:.5,...extra});

// Simulate killing JS while the native enqueue promise is still in flight.
let disk = [], completeEnqueue;
const beforeKill = new DownloadQueue([],async (_job,_signal,_progress,_plan,handoff) => {
  handoff();
  await new Promise(resolve => { completeEnqueue = resolve; });
  return 'native';
},jobs => { disk = structuredClone(jobs); },()=>{});
beforeKill.enqueue(series,'1');
await tick();
assert.equal(disk[0].nativePending,true,'native ownership is committed before enqueue can finish');
assert.equal(disk[0].native,undefined);
let restarted = 0;
const afterKill = new DownloadQueue(disk,async()=>{restarted++;return 'native';},()=>{},()=>{});
afterKill.reconcileNative({[series.slug]:state({state:'done',active:false,hasPlan:false,progress:1})});
afterKill.resumeWaiting();await tick();
assert.equal(afterKill.jobs.length,0,'completion while closed removes the pending handoff');
assert.equal(restarted,0,'a completed background transfer is never prepared again');
completeEnqueue();await tick();

// A previous completed batch for the same story must not consume a new request.
const fresh = new DownloadQueue([job({native:false})],async()=>{},()=>{},()=>{},()=>false);
fresh.reconcileNative({[series.slug]:state({state:'done',active:false,hasPlan:false})});
assert.equal(fresh.jobs.length,1,'old Done state cannot discard an unhanded new selection');

// Also recover a handoff which is now waiting on Android constraints.
const waitingHandoff = new DownloadQueue([job({nativePending:true})],async()=>{throw Error('Unexpected preparation');},()=>{},()=>{});
waitingHandoff.reconcileNative({[series.slug]:state({state:'queued',active:false,scheduled:true})});
waitingHandoff.resumeWaiting();await tick();
assert.equal(waitingHandoff.jobs[0].native,true);
assert.equal(waitingHandoff.jobs[0].status,'queued');

// Replay a durable pause whether Android has recovered its writer yet or not.
for (const active of [true,false]) {
  let pauses = 0, resumes = 0, closePause;
  const stopping = new DownloadQueue([job({native:true,status:'paused',pauseRequested:true})],async()=>{resumes++;return 'native';},()=>{},()=>{},()=>true,()=>[],{
    load:()=>[],save:()=>{},pauseNative:async slug=>{
      assert.equal(slug,series.slug);pauses++;
      await new Promise(resolve=>{closePause=resolve;});
    },
  });
  const recovered = {[series.slug]:state({active})};
  stopping.reconcileNative(recovered);stopping.reconcileNative(recovered);
  stopping.resumeWaiting();await tick();
  assert.equal(pauses,1,'polling does not duplicate an in-flight stop');
  assert.equal(stopping.jobs[0].status,'paused');
  assert.equal(stopping.jobs[0].pauseRequested,true,'intent remains until the writer acknowledges it');
  assert.equal(resumes,0,'reopening never bypasses the pending pause');
  closePause();await tick();
  stopping.reconcileNative({[series.slug]:state({state:'paused',active:false})});
  assert.equal(stopping.jobs[0].pauseRequested,false);
  stopping.resume(series.slug);await tick();
  assert.equal(resumes,1,'an explicit resume still works after pause recovery');
}

// Force-stop leaves no owner for service-queued work. Reopening delegates once.
let starts=0;
const orphan = new DownloadQueue([job({native:true,status:'queued'})],async()=>{starts++;return 'native';},()=>{},()=>{});
const orphanState = {[series.slug]:state({state:'queued',active:false})};
orphan.reconcileNative(orphanState);
assert.equal(orphan.jobs[0].status,'waiting');
orphan.resumeWaiting();await tick();
assert.equal(starts,1);

let foreground=false, foregroundStarts=0;
const backgroundOrphan = new DownloadQueue([job({native:true,status:'queued'})],async()=>{foregroundStarts++;return 'native';},()=>{},()=>{},()=>foreground);
backgroundOrphan.reconcileNative(orphanState);backgroundOrphan.resumeWaiting();await tick();
assert.equal(foregroundStarts,0,'recovery cannot launch preparation while JS is backgrounded without a service');
foreground=true;backgroundOrphan.pump();await tick();
assert.equal(foregroundStarts,1,'foreground return starts the recovered orphan');
// A stale poll cannot launch another copy while the resume is in flight.
orphan.reconcileNative({[series.slug]:state()});orphan.resumeWaiting();await tick();
assert.equal(starts,1);

// Scheduled Wi-Fi/backoff waits and active queued writers retain Android ownership.
for (const nativeState of [
  ...['queued','running','waiting'].map(value=>state({state:value,active:false,scheduled:true})),
  state({state:'queued',active:true}),
]) {
  const scheduled = new DownloadQueue([job({native:true,status:'queued'})],async()=>{throw Error('Android-owned wait was bypassed');},()=>{},()=>{});
  scheduled.reconcileNative({[series.slug]:nativeState});scheduled.resumeWaiting();await tick();
  assert.equal(scheduled.jobs[0].status,'queued');
}

// Recovery must preserve explicit stops and unfinished deletion intents.
for (const status of ['paused','cancelling']) {
  const stopped = new DownloadQueue([job({native:true,status,pauseRequested:status==='paused',cancelDeleteFiles:true})],async()=>{throw Error('Stopped job restarted');},()=>{},()=>{});
  stopped.reconcileNative(orphanState);stopped.resumeWaiting();await tick();
  assert.equal(stopped.jobs[0].status,status);
  assert.equal(stopped.jobs[0].cancelDeleteFiles,true);
}
console.log('Process-death handoff, background completion, durable pause replay, orphan recovery and Android-owned waits passed');
