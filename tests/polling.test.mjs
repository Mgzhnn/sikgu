import assert from 'node:assert/strict';
import test from 'node:test';
import {startPolling} from '../app/polling.mjs';

for(const failure of [false,true])test(`R5: no timers or listeners survive cleanup during a ${failure?'failed':'successful'} read`,async()=>{
  let next=0,wake,finish,signal;const timers=new Map();
  const cleanup=startPolling({base:10,hidden:()=>false,subscribe:fn=>{wake=fn;return()=>{wake=null}},setTimer:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimer:id=>timers.delete(id),run:s=>{signal=s;return new Promise((resolve,reject)=>{finish=failure?()=>reject(Error('offline')):()=>resolve(true)})}});
  const [id,task]=timers.entries().next().value;timers.delete(id);task.fn();
  wake();wake();cleanup();finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.size,0);assert.equal(wake,null);assert.equal(signal.aborted,true);
});

test('polling backs off, resets on visibility, and serializes repeated wakes',async()=>{
  let wake,next=0,finish,calls=0;const timers=new Map();
  const cleanup=startPolling({base:10,hidden:()=>false,subscribe:fn=>{wake=fn;return()=>{}},setTimer:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimer:id=>timers.delete(id),run:async()=>{calls++;if(calls===1)return false;await new Promise(r=>{finish=r});return true}});
  let [id,task]=timers.entries().next().value;timers.delete(id);task.fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal([...timers.values()][0].ms,20);
  wake();wake();wake();assert.equal(calls,2);finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,3);finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,10);cleanup();
});
