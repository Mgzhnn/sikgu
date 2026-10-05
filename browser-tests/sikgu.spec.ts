import {test,expect, type Page} from '@playwright/test';

const room = {id:'room_browser',restaurantId:'sinjeon',host:'테*트',pickup:'E3',pickupFull:'E3 택배보관함',closesAt:Date.now()+20*60000,total:15000,target:15000,people:2,capacity:4,apps:['baemin','coupang'],membership:'coupang',note:'테스트 주문방',myStatus:'approved',isHost:true,pendingCount:0};
async function mockApi(page: Page, options: {failFirst?:boolean;messages?:number}={}) {
  let boots=0,accepted=0,sent=0;
  const messages=Array.from({length:options.messages ?? 0},(_,i)=>({id:`msg_${i}`,sender_name:'테*트',body:`기록 ${i}`,created_at:Date.now()-300000+i*1000,mine:0}));
  await page.route('**/api/sikgu**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='POST'){
      const body=req.postDataJSON();
      if(body.action==='create_invite')return route.fulfill({json:{token:'a'.repeat(48),expiresAt:room.closesAt}});
      if(body.action==='accept_invite')accepted++;
      if(body.action==='send_message') {sent++;messages.push({id:`sent_${sent}`,sender_name:'테*트',body:body.body,created_at:Date.now()+sent,mine:1});}
      return route.fulfill({json:{ok:true,roomId:room.id}});
    }
    if(url.searchParams.get('action')==='room')return route.fulfill({json:{room,members:[{display_name:'테*트',role:'host',status:'approved',created_at:0}],messages:messages.slice(-200),nextMessagesCursor:null}});
    boots++;
    if(options.failFirst && boots===1)return route.fulfill({status:503,json:{error:'일시 오류'}});
    return route.fulfill({json:{user:{displayName:'테*트'},serverNow:Date.now(),rooms:[room],myRooms:[room],nextRoomsCursor:null,nextMyRoomsCursor:null}});
  });
  return {accepted:()=>accepted,sent:()=>sent};
}

test('R8: the rendered price summary keeps app requirements together',async({page})=>{
  await mockApi(page);await page.goto('/');
  await page.locator('.pool-card').first().click();
  const rows=page.locator('.app-estimate');
  await expect(rows.nth(0)).toContainText('배민');
  await expect(rows.nth(0)).toContainText('최소 주문금액 달성');
  await expect(rows.nth(0)).toContainText('1,500원');
  await expect(rows.nth(1)).toContainText('쿠팡');
  await expect(rows.nth(1)).toContainText('3,000원 더 필요해요');
  await expect(rows.nth(1)).toContainText('무료');
});

test('invite secrets leave the URL before failed bootstrap and acceptance requires a gesture',async({page})=>{
  const api=await mockApi(page,{failFirst:true});
  await page.goto(`/?room=room_browser&invite=${'a'.repeat(48)}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('일시 오류',{exact:true})).toBeVisible();
  expect(api.accepted()).toBe(0);
  await page.getByRole('button',{name:/다시.*(불러|시도)/}).first().click();
  await expect(page.getByRole('dialog',{name:'주문방 초대 확인'})).toBeVisible();
  expect(api.accepted()).toBe(0);
  await page.getByRole('button',{name:'초대 수락',exact:true}).click();
  await expect.poll(api.accepted).toBe(1);
});

test('invite expiry copy uses recruitment time after reopening the room',async({page})=>{
  await mockApi(page);await page.goto('/');
  await page.locator('.pool-card').first().click();
  await page.getByRole('button',{name:/참여자 관리/}).click();
  await page.getByRole('button',{name:/초대 링크/}).first().click();
  await expect(page.locator('.invite-success')).toContainText('모집 마감까지');
  await expect(page.locator('.invite-success')).not.toContainText('24시간');
});

test('R4: the 201st and 202nd messages scroll and announce without replaying initial history',async({page})=>{
  const api=await mockApi(page,{messages:200});await page.goto('/');
  await page.locator('.pool-card').first().click();await page.getByRole('button',{name:/참여자 관리/}).click();
  await expect(page.locator('.chat-messages article')).toHaveCount(200);
  const live=page.locator('.chat-panel [role="status"]').first();
  await expect(live).toBeEmpty();
  const composer=page.getByRole('textbox',{name:'채팅 메시지'});
  await composer.fill('조합 중');
  await composer.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
  expect(api.sent()).toBe(0);
  for(const body of ['새 메시지 하나','새 메시지 둘']){
    await composer.fill(body);await composer.press('Enter');
    await expect(page.locator('.chat-messages article').last()).toContainText(body);
    await expect(live).toHaveText('새 메시지 1개');
    await expect.poll(()=>page.locator('.chat-messages').evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(3);
    await expect(composer).toBeFocused();
  }
  expect(api.sent()).toBe(2);
});

for(const width of [360,390])test(`restaurant choices remain readable at ${width}px and enlarged text`,async({page})=>{
  await page.setViewportSize({width,height:844});await mockApi(page);await page.goto('/');
  await expect(page.locator('.pool-card').first()).toBeVisible();
  await page.locator('.mobile-create-button').click();
  const dialog=page.getByRole('dialog',{name:'새 주문방 만들기'});
  await expect(dialog).toBeVisible();
  await expect.poll(()=>page.locator('.restaurant-picker-copy strong').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await expect.poll(()=>page.locator('.restaurant-picker-copy small').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
  await page.screenshot({path:`verification/mobile-${width}.png`,fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThan(3);
  expect(await page.locator('.restaurant-picker-search input').evaluate(el=>el.getBoundingClientRect().bottom <= el.parentElement!.getBoundingClientRect().bottom)).toBe(true);
  await page.screenshot({path:`verification/mobile-${width}-text-200.png`,fullPage:true});
  const search=page.locator('.restaurant-picker-search input');
  await search.focus();await search.fill('신전');
  await search.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,keyCode:229});
  await expect(dialog).toBeVisible();
  await search.press('Escape');await expect(dialog).toBeHidden();
  await expect(page.locator('.mobile-create-button')).toBeFocused();
});

test('history pagination is reachable from the profile and room UI',async({page})=>{
  await mockApi(page,{messages:200});
  // Override just this test's API with deterministic continuation pages.
  await page.unroute('**/api/sikgu**');
  const retained=Array.from({length:51},(_,i)=>({...room,id:`room_history_${i}`}));
  await page.route('**/api/sikgu**',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get('action')==='room')return route.fulfill({json:{room,members:[],messages:url.searchParams.has('messagesCursor')?[{id:'old-message',body:'더 오래된 메시지',created_at:1,mine:0,sender_name:'테*트'}]:[{id:'latest-message',body:'최근 메시지',created_at:100,mine:0,sender_name:'테*트'}],nextMessagesCursor:url.searchParams.has('messagesCursor')?null:'older-chat'}});
    return route.fulfill({json:{user:{displayName:'테*트'},serverNow:Date.now(),rooms:[room],myRooms:url.searchParams.has('myRoomsCursor')?retained.slice(50):retained.slice(0,50),nextMyRoomsCursor:url.searchParams.has('myRoomsCursor')?null:'older-rooms'}});
  });
  await page.goto('/');
  await expect(page.locator('.pool-card').first()).toBeVisible();
  await page.getByRole('navigation',{name:'모바일 주 메뉴'}).getByRole('button').last().click();
  await page.getByRole('button',{name:'이전 주문방 더 보기',exact:true}).click();
  await expect(page.locator('.my-room-list > button')).toHaveCount(51);
  await page.locator('.my-room-list > button').first().click();
  await page.getByRole('button',{name:'이전 메시지 더 보기'}).click();
  await expect(page.getByText('더 오래된 메시지',{exact:true})).toBeVisible();
  await expect(page.getByText('최근 메시지',{exact:true})).toBeVisible();
});

test('a superseded feed response cannot replace the current search',async({page})=>{
  await mockApi(page);await page.goto('/');
  await expect(page.locator('.pool-card').first()).toBeVisible();
  let releaseOld!:()=>void, started!:()=>void, finished!:()=>void;
  const oldStarted=new Promise<void>(r=>{started=r});
  const oldFinished=new Promise<void>(r=>{finished=r});
  await page.route('**/api/sikgu**',async route=>{
    const url=new URL(route.request().url());
    const selected=url.searchParams.get('searchRestaurants');
    if(selected==='sinjeon'){
      started();await new Promise<void>(r=>{releaseOld=r});
      try {await route.fulfill({json:{rooms:[room],myRooms:[room],user:{displayName:'테*트'},serverNow:Date.now()}});} catch { /* Aborted stale requests cannot update the view. */ }
      finally {finished();}
    } else if(selected==='mom'){
      await route.fulfill({json:{rooms:[{...room,id:'latest-room',restaurantId:'mom'}],myRooms:[room],user:{displayName:'테*트'},serverNow:Date.now()}});
    } else await route.fallback();
  });
  const search=page.getByRole('textbox',{name:'주문방 검색'});
  await search.fill('신전');await oldStarted;
  await search.fill('맘스터치');
  await expect(page.locator('.pool-card')).toHaveCount(1);
  await expect(page.locator('.pool-card').first()).toContainText('맘스터치');
  releaseOld();await oldFinished;
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await expect(page.locator('.pool-card').first()).toContainText('맘스터치');
});

test('a failed chat send preserves the Korean draft and focus',async({page})=>{
  await mockApi(page);await page.goto('/');
  await page.locator('.pool-card').first().click();await page.getByRole('button',{name:/참여자 관리/}).click();
  await page.route('**/api/sikgu**',async route=>{
    if(route.request().method()==='POST' && route.request().postDataJSON().action==='send_message')return route.fulfill({status:503,json:{error:'잠시 후 다시 시도해주세요.'}});
    await route.fallback();
  });
  const composer=page.getByRole('textbox',{name:'채팅 메시지'});
  await composer.fill('한글 초안은 보존되어야 해요');await composer.press('Enter');
  await expect(page.getByText('잠시 후 다시 시도해주세요.',{exact:true})).toBeVisible();
  await expect(composer).toHaveValue('한글 초안은 보존되어야 해요');await expect(composer).toBeFocused();
});

test('A1: a member enters an order amount and the room total is the sum',async({page})=>{
  const memberRoom={...room,isHost:false,myStatus:'approved',total:8000};
  const members=[{display_name:'테*트',role:'host',status:'approved',created_at:0,amount:8000,mine:0},{member_ref:'b'.repeat(32),display_name:'나*',role:'member',status:'approved',created_at:1,amount:null as number|null,mine:1}];
  let saved:unknown=null;
  await page.route('**/api/sikgu**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='POST'){
      const body=req.postDataJSON();
      if(body.action==='set_amount'){saved=body.amount;members[1].amount=body.amount;memberRoom.total=8000+(body.amount??0);return route.fulfill({json:{ok:true,amount:body.amount,total:memberRoom.total}});}
      return route.fulfill({json:{ok:true}});
    }
    if(url.searchParams.get('action')==='room')return route.fulfill({json:{room:memberRoom,members,messages:[],nextMessagesCursor:null}});
    return route.fulfill({json:{user:{displayName:'나*'},serverNow:Date.now(),rooms:[memberRoom],myRooms:[memberRoom],nextRoomsCursor:null,nextMyRoomsCursor:null}});
  });
  await page.goto('/');
  await page.locator('.pool-card').first().click();
  await page.getByRole('button',{name:'채팅방 열기'}).click();
  const dialog=page.getByRole('dialog',{name:'비공개 주문방 채팅'});
  await expect(dialog).toContainText('금액 미입력');
  await expect(dialog.locator('.order-info-summary')).toContainText('8,000원');
  const input=dialog.getByRole('spinbutton',{name:'내 주문 금액'});
  await input.fill('7000');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();
  await expect.poll(()=>saved).toBe(7000);
  await expect(dialog.locator('.member-list')).toContainText('7,000원');
  await expect(dialog.locator('.order-info-summary')).toContainText('15,000원');
  // The host's order form has no pooled-total field any more.
  await expect(dialog.getByText('현재 모인 주문금액')).toHaveCount(0);
});

test('A3: a pending request can be cancelled and a rejection is visible',async({page})=>{
  const pending={...room,id:'room_pending',isHost:false,myStatus:'requested' as string|null,pendingCount:0};
  const rejected={...room,id:'room_rejected',restaurantId:'mom',isHost:false,myStatus:'rejected',pendingCount:0};
  let left=0;
  await page.route('**/api/sikgu**',async route=>{
    const req=route.request();
    if(req.method()==='POST'){
      const body=req.postDataJSON();
      if(body.action==='leave_room'&&body.roomId==='room_pending'){left++;pending.myStatus=null;}
      return route.fulfill({json:{ok:true}});
    }
    return route.fulfill({json:{user:{displayName:'나*'},serverNow:Date.now(),rooms:[pending,rejected],myRooms:[pending],nextRoomsCursor:null,nextMyRoomsCursor:null}});
  });
  await page.goto('/');
  const cards=page.locator('.pool-card');
  await expect(cards.nth(0)).toContainText('승인 대기');
  await expect(cards.nth(1)).toContainText('거절됨');
  await cards.nth(0).click();
  const dialog=page.getByRole('dialog',{name:'신전떡볶이 공동주문'});
  await expect(dialog).toContainText('방장 승인을 기다리고 있어요');
  await dialog.getByRole('button',{name:'신청 취소',exact:true}).click();
  await expect.poll(()=>left).toBe(1);
  await expect(page.locator('.toast')).toContainText('참여 신청을 취소했어요.');
  await expect(cards.nth(0)).not.toContainText('승인 대기');
  await cards.nth(1).click();
  await expect(page.getByRole('button',{name:'거절됨 · 다시 신청',exact:true})).toBeEnabled();
});

test('A4: the room sheet closes itself with the right message when the room is gone',async({page})=>{
  await mockApi(page);
  await page.route('**/api/sikgu?action=room**',async route=>route.fulfill({status:404,json:{error:'삭제되었거나 더 이상 없는 주문방입니다.',code:'room_gone'}}));
  await page.goto('/');
  await page.locator('.pool-card').first().click();
  await page.getByRole('button',{name:/참여자 관리/}).click();
  await expect(page.locator('.toast')).toContainText('방장이 주문방을 삭제했어요.');
  await expect(page.getByRole('dialog',{name:'비공개 주문방 채팅'})).toHaveCount(0);
});
