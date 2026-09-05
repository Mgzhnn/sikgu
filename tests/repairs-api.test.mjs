import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi, identity } from './helpers/api-harness.mjs';

const host = identity('host@example.test', 'Test Host');
const member = identity('member@example.test', 'Test Member');
const outsider = identity('outsider@example.test', 'Test Outsider');
async function fixture() {
  const api = await createApi();
  const created = await api.post(host, { action: 'create_room', restaurantId: 'sinjeon', pickup: 'E3', apps: ['baemin'], minutes: 20, capacity: 4 });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;
  await api.post(member, { action: 'request_join', roomId });
  const ref = api.sql('SELECT review_token FROM room_members WHERE room_id=? AND user_email=?', roomId, 'member@example.test')[0].review_token;
  return { api, roomId, ref };
}

test('R1: removal committed before a send prevents the message write', async () => {
  const {api,roomId,ref}=await fixture();
  await api.post(host,{action:'review_member',roomId,memberRef:ref,decision:'approve'});
  const binding=globalThis.__sikguEnv.DB, prepare=binding.prepare.bind(binding);
  let armed=true;
  binding.prepare=sql=>{
    const s=prepare(sql);
    if(/INSERT INTO room_messages/.test(sql)) {
      const run=s.run.bind(s);
      s.run=async()=>{if(armed){armed=false;assert.equal((await api.post(host,{action:'remove_member',roomId,memberRef:ref})).status,200);}return run();};
    }
    return s;
  };
  const sent=await api.post(member,{action:'send_message',roomId,body:'must not persist'});
  assert.ok([403,409].includes(sent.status),`received ${sent.status}`);
  assert.equal(api.sql('SELECT * FROM room_messages').length,0);
  api.db.close();
});

for (const transition of ['deleting','expired']) {
  test(`R2: approval rechecks ${transition} at the write boundary`, async()=>{
    const {api,roomId,ref}=await fixture();
    const binding=globalThis.__sikguEnv.DB,batch=binding.batch.bind(binding);
    binding.batch=async statements=>{
      if(transition==='deleting')api.db.prepare("UPDATE rooms SET status='deleting' WHERE id=?").run(roomId);
      else api.db.prepare('UPDATE rooms SET closes_at=? WHERE id=?').run(Date.now()-5000,roomId);
      return batch(statements);
    };
    const response=await api.post(host,{action:'review_member',roomId,memberRef:ref,decision:'approve'});
    assert.equal(response.status,409);
    assert.equal(api.sql('SELECT status FROM room_members WHERE review_token=?',ref)[0].status,'requested');
    api.db.close();
  });
}

for (const action of ['request_join','create_invite']) {
  test(`${action} cannot succeed after concurrent room deletion`,async()=>{
    const {api,roomId}=await fixture();
    const binding=globalThis.__sikguEnv.DB,prepare=binding.prepare.bind(binding),batch=binding.batch.bind(binding);
    if(action==='request_join')binding.prepare=sql=>{
      const s=prepare(sql);
      if(/INSERT INTO room_members/.test(sql)){const run=s.run.bind(s);s.run=async()=>{api.db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);return run();};}
      return s;
    };
    else binding.batch=async statements=>{api.db.prepare('DELETE FROM rooms WHERE id=?').run(roomId);return batch(statements);};
    const response=await api.post(action==='create_invite'?host:outsider,{action,roomId});
    assert.ok([404,409].includes(response.status),`received ${response.status}`);
    api.db.close();
  });
}

test('R3/R6: invite expiry follows recruitment and hosts can recover a link at the cap',async()=>{
  const {api,roomId,ref}=await fixture();
  const tokens=[];
  for(let i=0;i<6;i++){
    const response=await api.post(host,{action:'create_invite',roomId});
    assert.equal(response.status,200);
    assert.ok(response.data.expiresAt <= api.sql('SELECT closes_at FROM rooms WHERE id=?',roomId)[0].closes_at);
    tokens.push(response.data.token);
  }
  assert.ok(tokens.slice(0,5).includes(tokens[5]));
  assert.equal(api.sql('SELECT * FROM room_invites WHERE room_id=?',roomId).length,5);
  await api.post(host,{action:'review_member',roomId,memberRef:ref,decision:'approve'});
  const memberRoom=await api.get(member,`?action=room&roomId=${roomId}`);
  assert.ok(!JSON.stringify(memberRoom.data).includes(tokens[0]));
  assert.equal((await api.post(member,{action:'create_invite',roomId})).status,403);
  api.db.prepare('UPDATE rooms SET closes_at=? WHERE id=?').run(Date.now()-1000,roomId);
  assert.equal((await api.post(outsider,{action:'accept_invite',roomId,token:tokens[0]})).status,409);
  api.db.close();
});
