import assert from 'node:assert/strict';
import test from 'node:test';
import {capturePendingInvite,validPendingInvite} from '../app/invite-continuation.mjs';

test('invites are scrubbed synchronously, retained on bootstrap failure, and require explicit consumption',()=>{
  let stored=null,cleaned='';
  const storage={getItem:()=>stored,setItem:(_,value)=>{stored=value},removeItem:()=>{stored=null}};
  const token='a'.repeat(48);
  const result=capturePendingInvite({search:`?room=room_example&invite=${token}`,pathname:'/',hash:''},{replaceState:(_,__,url)=>{cleaned=url}},storage,1000);
  assert.equal(cleaned,'/');
  assert.equal(result.token,token);
  assert.equal(capturePendingInvite({search:'',pathname:'/',hash:''},{},storage,2000).token,token);
  assert.ok(stored,'reading continuation must not consume it under another account');
  for(const value of [null,[],{},'bad',{...result,createdAt:3000},{...result,createdAt:-4000000}])assert.equal(validPendingInvite(value,2000),null);
});
