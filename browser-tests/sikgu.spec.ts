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
