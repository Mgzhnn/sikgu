import assert from 'node:assert/strict';
import test from 'node:test';
import {createApi,identity} from './helpers/api-harness.mjs';
const host=identity('pages@example.test');
async function fixture(){
  const api=await createApi();
  const {roomId}=(await api.post(host,{action:'create_room',restaurantId:'sinjeon',pickup:'E3',apps:['baemin'],minutes:20,capacity:8})).data;
  return {api,roomId};
}
test('R7: all retained rooms and filtered feed entries remain reachable with tied timestamps',async()=>{
  const {api,roomId}=await fixture();
  const original=api.sql('SELECT * FROM rooms WHERE id=?',roomId)[0];
  const columns=Object.keys(original);
  const insert=api.db.prepare(`INSERT INTO rooms (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
  const membership=api.db.prepare("INSERT INTO room_members(room_id,user_email,display_name,role,status,created_at) VALUES(?,'pages@example.test','Test','host','approved',?)");
  for(let i=0;i<110;i++){
    const row={...original,id:`page_${String(i).padStart(3,'0')}`,restaurant_id:i===0?'sinjeon':'mom',created_at:original.created_at+1};
    insert.run(...columns.map(k=>row[k]));membership.run(row.id,row.created_at);
  }
  let cursor=null;const seen=[];
  do{
    const response=await api.get(host,'?action=bootstrap'+(cursor?`&myRoomsCursor=${encodeURIComponent(cursor)}`:''));
    assert.equal(response.status,200);assert.ok(response.data.myRooms.length<=50);
    seen.push(...response.data.myRooms.map(r=>r.id));
    cursor=response.data.nextMyRoomsCursor;
    assert.notEqual(cursor,undefined,'must expose pagination');
  }while(cursor);
  assert.equal(seen.length,111);assert.equal(new Set(seen).size,111);
  const filtered=await api.get(host,'?action=bootstrap&searchRestaurants=sinjeon&searchPickups=');
  assert.equal(filtered.data.rooms.length,2);
  assert.ok(filtered.data.rooms.some(r=>r.id==='page_000'));
  assert.equal((await api.get(host,'?action=bootstrap&myRoomsCursor=bad')).status,400);
  api.db.close();
});
test('R4: older chat pages are ordered, bounded and private, including timestamp ties',async()=>{
  const {api,roomId}=await fixture();
  const insert=api.db.prepare('INSERT INTO room_messages(id,room_id,sender_email,sender_name,body,created_at) VALUES(?,?,?,?,?,?)');
  for(let i=0;i<405;i++)insert.run(`msg_${String(i).padStart(4,'0')}`,roomId,'pages@example.test','Test',String(i),Date.now()-3600000+Math.floor(i/8)*1000);
  let cursor=null;const seen=[];
  do{
    const response=await api.get(host,`?action=room&roomId=${roomId}`+(cursor?`&messagesCursor=${encodeURIComponent(cursor)}`:''));
    assert.equal(response.status,200);assert.ok(response.data.messages.length<=200);
    seen.push(...response.data.messages.map(m=>m.id));
    cursor=response.data.nextMessagesCursor;assert.notEqual(cursor,undefined);
  }while(cursor);
  assert.equal(seen.length,405);assert.equal(new Set(seen).size,405);
  assert.equal((await api.get(identity('outsider@example.test'),`?action=room&roomId=${roomId}`)).status,403);
  api.db.prepare('UPDATE rooms SET closes_at=? WHERE id=?').run(Date.now()-31*86400000,roomId);
  assert.equal((await api.get(host,`?action=room&roomId=${roomId}`)).status,410);
  api.db.close();
});


test('room history and per-member rate windows use their bounded-read indexes',async()=>{
  const {api,roomId}=await fixture();
  const plan=sql=>api.sql('EXPLAIN QUERY PLAN '+sql,roomId).map(r=>r.detail).join(' ');
  assert.match(plan('SELECT id FROM room_messages WHERE room_id=? ORDER BY created_at DESC,id DESC LIMIT 201'),/room_messages_room_created_idx/);
  assert.match(plan("SELECT COUNT(*) FROM room_messages WHERE room_id=? AND sender_email='pages@example.test' AND created_at>0"),/room_messages_sender_created_idx/);
  api.db.close();
});
