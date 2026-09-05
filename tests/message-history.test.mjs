import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeMessages,newMessageCount} from '../app/message-history.mjs';
test('R4: identity-based updates distinguish initial history, old pages and arrivals at the window limit',()=>{
  const initial=Array.from({length:200},(_,i)=>({id:`msg_${i}`,created_at:i}));
  assert.equal(newMessageCount(null,initial),0);
  const known=new Set(initial.map(m=>m.id));
  const incoming=[...initial.slice(1),{id:'msg_201',created_at:201}];
  assert.equal(newMessageCount(known,incoming),1);
  const merged=mergeMessages(initial,incoming);
  assert.equal(merged.length,201);assert.equal(merged.at(-1).id,'msg_201');
  assert.equal(mergeMessages(merged,[initial[0]]).length,201);
});
