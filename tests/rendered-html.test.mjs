import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { maskDisplayName } from "../app/name-mask.mjs";

test("builds the SIKGU product shell", async () => {
  const [layout, page, worker] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /const title = "SIKGU/);
  assert.match(layout, /<html lang="ko">/);
  assert.match(page, /function Home\(\)/);
  assert.match(page, /주문방 만들기/);
  assert.match(worker, /fetch/);
  assert.doesNotMatch(page, /Your site is taking shape|Building your site/);
});

test("includes the expanded local restaurant directory and picker", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const restaurant of [
    "마이카츠 현풍테크노폴리스점",
    "써브웨이 대구테크노폴리스점",
    "스텔라떡볶이 대구테크노현풍점",
    "도미노피자 현풍점",
    "BBQ 테크노행복점",
    "현풍닭칼국수 대구테크노폴리스점",
    "성서한옥집김치찜 현풍",
  ]) {
    assert.match(page, new RegExp(restaurant));
  }

  assert.match(page, /restaurant-picker-search/);
  assert.match(page, /restaurant-picker-categories/);
  assert.match(page, /카카오맵 확인/);
  assert.match(page, /배달앱의 실시간 영업·배달 가능 여부/);
  assert.doesNotMatch(page, /<select id="restaurant"/);
  assert.match(css, /\.restaurant-picker-list/);
  assert.match(css, /\.selected-restaurant-row/);
});

test("offers the expanded DGIST pickup point grid", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const pickup of [
    "E1 연구동 정문",
    "E2 택배보관함",
    "E3 택배보관함",
    "E4 택배보관함",
    "E5 택배보관함",
    "E6 택배보관함",
    "201-204 사이 택배 수령장소",
    "비슬빌리지 206동 택배 수령장소",
  ]) {
    assert.match(page, new RegExp(pickup.replace("·", "\\·")));
  }

  assert.match(page, /pickupPoints\.map\(\(point\)/);
  assert.match(page, /id: "E3", full: "E3 택배보관함", walk: 1, lat: 35\.705312, lng: 128\.457146/);
  assert.match(page, /code: "201-204"/);
  assert.match(page, /lat: 35\.7035625/);
  assert.match(page, /lng: 128\.4624375/);
  assert.match(page, /code: "206"/);
  assert.match(page, /lat: 35\.7037343/);
  assert.match(page, /lng: 128\.4633301/);
  assert.doesNotMatch(page, /pickupPoints\.slice\(0,\s*4\)/);
  assert.match(css, /\.choice-grid \{[\s\S]*grid-template-columns: repeat\(3, 1fr\)/);
});

test("ships with no fabricated live orders", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const initialPools: Pool\[\] = \[\];/);
  assert.doesNotMatch(page, /id: "p[1-4]"/);
  assert.doesNotMatch(page, /활성 주문 9개/);
  assert.doesNotMatch(page, /이번 주 절약[\s\S]*18,300원/);
  assert.match(page, /조건에 맞는 주문방이 없어요/);
});

test("supports selecting both delivery apps for one order pool", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /apps: DeliveryApp\[\]/);
  assert.match(page, /const \[apps, setApps\] = useState<DeliveryApp\[\]>\(\["baemin"\]\)/);
  assert.match(page, /aria-label="주문 앱 복수 선택"/);
  assert.match(page, /aria-pressed=\{apps\.includes\(value\)\}/);
  assert.match(page, /하나 또는 두 앱을 모두 선택할 수 있어요/);
  assert.match(css, /\.segmented\.multi-select button/);
});

test("does not ship the inactive notification control", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /aria-label="알림"/);
  assert.doesNotMatch(page, /className="icon-button notification"/);
  assert.doesNotMatch(css, /\.notification i/);
});

test("removes unimplemented integrations and fabricated profile data", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const unsupported of [
    "DGIST OneID",
    "연결된 서비스",
    "Toss · KakaoPay",
    "함께한 주문",
    "누적 절약",
    "식구 매너",
    "일회용품 12개",
    "YOUR JULY IMPACT",
    "배달 멤버십",
    "멤버십 보유자가 결제",
    "이*연",
  ]) {
    assert.doesNotMatch(page, new RegExp(unsupported.replace("*", "\\*")));
  }

  assert.doesNotMatch(page, /aria-label="공유하기"/);
  assert.doesNotMatch(css, /\.connected-list/);
  assert.doesNotMatch(css, /\.impact-card/);
  assert.doesNotMatch(css, /\.membership-options/);
  assert.doesNotMatch(css, /\.participant-list/);
});

test("removes the delivery-app-owned order tracking section", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /id: "orders"/);
  assert.doesNotMatch(page, /function OrdersView/);
  assert.doesNotMatch(page, /내 주문을 한눈에 확인해요/);
  assert.doesNotMatch(css, /\.order-timeline/);
  assert.doesNotMatch(css, /\.settlement-card/);
});

test("supports a persistent current pickup location selector", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /aria-label="현재 위치 선택"/);
  assert.match(page, /pickupPoints\.map\(\(point\)/);
  assert.match(page, /localStorage\.setItem\(currentPickupStorageKey, currentPickup\)/);
  assert.match(page, /preferredPickup=\{currentPickup\}/);
  assert.match(css, /\.location-menu/);
  assert.match(css, /\.location-option\.active/);
});

test("opens an accessible order filter and composes useful room filters", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type PoolFilters = \{/);
  assert.match(page, /const defaultPoolFilters: PoolFilters = \{[\s\S]*availableOnly: false[\s\S]*currentPickupOnly: false[\s\S]*sortBy: "default"/);
  assert.match(page, /const \[filters, setFilters\] = useState<PoolFilters>\(defaultPoolFilters\)/);
  assert.match(page, /const \[filterOpen, setFilterOpen\] = useState\(false\)/);
  assert.match(page, /className=\{`filter-button \$\{activeFilterCount \? "active" : ""\}`\}/);
  assert.match(page, /aria-expanded=\{filterOpen\}/);
  assert.match(page, /aria-controls="pool-filter-popover"/);
  assert.match(page, /aria-haspopup="dialog"/);
  assert.match(page, /id="pool-filter-popover"[\s\S]{0,180}role="dialog"[\s\S]{0,180}aria-labelledby="pool-filter-title"/);
  assert.match(page, /id="pool-filter-title">주문방 필터/);
  assert.match(page, /type="checkbox"[\s\S]{0,120}checked=\{filters\.availableOnly\}/);
  assert.match(page, /type="checkbox"[\s\S]{0,120}checked=\{filters\.currentPickupOnly\}/);
  assert.match(page, /pool\.isHost \|\| pool\.myStatus === "approved" \|\| pool\.myStatus === "requested"/);
  assert.match(page, /!filters\.availableOnly[\s\S]{0,120}pool\.people < pool\.capacity[\s\S]{0,80}isRelated/);
  assert.match(page, /!filters\.currentPickupOnly \|\| pool\.pickup === currentPickup/);
  assert.match(page, /filters\.sortBy === "deadline"[\s\S]{0,100}filtered\.sort\(\(a, b\) => a\.closesAt - b\.closesAt\)/);
  assert.match(page, /filters\.sortBy === "remaining"[\s\S]{0,180}Math\.max\(0, a\.target - a\.total\) - Math\.max\(0, b\.target - b\.total\)/);
  assert.match(page, /const joinablePools = pools\.filter\(\(pool\) => \([\s\S]{0,100}pool\.people < pool\.capacity/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /filterTriggerRef\.current\?\.focus\(\)/);
  assert.match(page, /role="status" aria-live="polite">\{filtered\.length\}개 주문방 표시 중/);
  assert.match(page, /모든 조건 초기화/);
  assert.doesNotMatch(page, /role="menu"/);

  for (const selector of [
    "filter-anchor",
    "filter-popover",
    "filter-option",
    "filter-sort",
    "filter-reset",
  ]) {
    assert.match(css, new RegExp(`\\.${selector}`));
  }
  assert.match(css, /\.filter-button\.active/);
  assert.match(css, /\.filter-popover :focus-visible/);
});

test("persists rooms, approvals, invitations, and private chat in D1", async () => {
  const [hosting, schema, api, page] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1":\s*"DB"/);
  for (const table of ["rooms", "room_members", "room_invites", "room_messages"]) {
    assert.match(schema, new RegExp(`"${table}"`));
  }

  assert.match(page, /aria-label="주문방 최대 인원"/);
  assert.match(page, /\[2, 3, 4, 5, 6, 7, 8\]/);
  assert.match(page, /action: "request_join"/);
  assert.match(page, /action: "review_member"/);
  assert.match(page, /action: "create_invite"/);
  assert.match(page, /action: "send_message"/);
  assert.match(page, /messagesEndRef\.current\?\.scrollIntoView/);
  assert.match(page, /if \(!body \|\| sending\) return/);
  assert.match(page, /disabled=\{sending \|\| !message\.trim\(\)\}/);

  assert.match(api, /my_status !== "approved"/);
  assert.match(api, /방장만 참여자를 선택할 수 있습니다/);
  assert.match(api, /승인된 구성원만 채팅할 수 있습니다/);
  assert.match(api, /\.trim\(\)\.slice\(0, 1000\)/);
  assert.match(api, /ORDER BY created_at DESC[\s\S]*LIMIT 200[\s\S]*ORDER BY created_at ASC/);
});

test("removes the in-app menu and cart drawer", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /function MenuDrawer/);
  assert.doesNotMatch(page, /전체 메뉴/);
  assert.doesNotMatch(page, /메뉴를 담아주세요/);
  assert.doesNotMatch(page, /selectedRestaurant|setSelectedRestaurant|\bcart\b|setCart/);
  assert.doesNotMatch(css, /\.menu-drawer|\.menu-groups|\.drawer-footer|\.add-menu|\.stepper/);
  assert.match(page, /이 가게로 방 만들기/);
});

test("removes the inactive order-detail header button", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /className="modal-topbar"[\s\S]{0,220}<span \/>/);
  assert.match(css, /\.modal-topbar \{[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\) 34px/);
  assert.match(css, /\.modal-topbar::after \{[\s\S]*content: ""/);
});

test("opens an accessible campus order map with guarded join actions", async () => {
  const [page, css, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /function MapView/);
  assert.doesNotMatch(page, /id: "map"/);
  assert.match(page, /function CampusMapPreview/);
  assert.match(page, /function CampusMapModal/);
  assert.match(page, /className="campus-map-expand"[\s\S]{0,180}onClick=\{\(\) => onOpen\(currentPickup\)\}/);
  assert.match(page, /aria-label="캠퍼스 주문 지도 크게 보기"/);
  assert.match(page, /aria-haspopup="dialog"/);
  assert.match(page, /className="campus-map-preview-marker"[\s\S]{0,220}onClick=\{\(\) => onOpen\(point\.id\)\}/);
  assert.match(page, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="campus-map-title"/);
  assert.match(page, /aria-label="캠퍼스 지도 닫기"/);
  assert.match(page, /event\.key === "Escape"/);
  assert.match(page, /onClick=\{\(\) => void joinPool\(pool\)\}/);
  assert.match(page, /disabled=\{busyRoomId !== null \|\| isPending \|\| isFull\}/);
  assert.match(page, /pool\.people >= pool\.capacity/);
  assert.match(page, /방장 승인 대기 중/);
  assert.match(page, /정원 마감/);
  assert.match(page, /onJoin=\{async \(pool\) =>/);
  assert.match(page, /sessionStorage\.setItem\(pendingJoinStorageKey/);
  assert.match(page, /로그인 후 참여 신청을 이어서 보냈어요/);
  assert.match(page, /loadRoomsRequestRef/);
  assert.match(page, /roomDialogRef\.current\?\.querySelector<HTMLElement>\("\.room-hub-close"\)\?\.focus\(\)/);
  assert.match(api, /if \(action === "request_join"\)/);
  assert.match(api, /approvedCount\(id\) >= room\.capacity/);
  assert.match(api, /주문방 정원이 모두 찼습니다\./);
  for (const selector of [
    "campus-map-preview",
    "campus-map-modal",
    "campus-map-marker",
    "campus-map-order-card",
  ]) {
    assert.match(css, new RegExp(`\\.${selector}`));
  }
  assert.match(css, /\.campus-map-modal :focus-visible/);
  assert.match(css, /\.mobile-campus-glance \{ display: block/);
  assert.match(css, /\.mobile-nav \{[\s\S]*grid-template-columns: repeat\(3, 1fr\)/);
});

test("opens an accessible feedback dialog with an email handoff", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const feedbackEmail = "gudwns5863@naver\.com"/);
  assert.match(page, /function FeedbackModal/);
  assert.match(page, /aria-labelledby="feedback-title"/);
  assert.match(page, /aria-describedby="feedback-description"/);
  assert.match(page, /window\.location\.href = `mailto:\$\{feedbackEmail\}/);
  assert.match(page, /encodeURIComponent\(subject\)/);
  assert.match(page, /encodeURIComponent\(body\)/);
  assert.match(page, /navigator\.clipboard\.writeText\(feedbackEmail\)/);
  assert.match(page, /showFeedback && <FeedbackModal/);
  assert.match(page, /currentScreen=\{viewCopy\}/);
  assert.match(css, /\.feedback-modal/);
  assert.match(css, /\.feedback-type-grid/);
});

test("lets hosts manage private order receipts and delete their rooms", async () => {
  const [hosting, schema, migration, api, page, css, worker] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_glossy_prodigy.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"r2":\s*"UPLOADS"/);
  assert.match(worker, /UPLOADS: R2Bucket/);
  for (const field of ["estimatedArrival", "orderTotal", "receiptKey", "receiptContentType", "receiptUploadedAt"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(migration, /DELETE FROM `room_messages`[\s\S]*DELETE FROM `room_invites`[\s\S]*DELETE FROM `room_members`[\s\S]*DELETE FROM `rooms`/);

  assert.match(api, /export async function PUT/);
  assert.match(api, /room\.host_email !== auth\.email/);
  assert.match(api, /maxReceiptBytes = 8 \* 1024 \* 1024/);
  assert.match(api, /detectReceiptType/);
  assert.match(api, /receipts\/\$\{id\}\/\$\{crypto\.randomUUID\(\)\}/);
  assert.match(api, /action === "receipt"/);
  assert.match(api, /room\.my_status !== "approved"/);
  assert.match(api, /"Cache-Control": "private, no-store"/);
  assert.match(api, /"X-Content-Type-Options": "nosniff"/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /DELETE FROM room_messages WHERE room_id = \?/);

  assert.match(page, /ORDER UPDATE/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /영수증 원본 이미지 열기/);
  assert.match(page, /참여자, 채팅, 초대 링크, 영수증 이미지가 모두 삭제/);
  assert.match(css, /\.order-info-card/);
  assert.match(css, /\.room-delete-confirm/);
});

test("masks Korean and English display names consistently", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(maskDisplayName("Ugrp"), "Ug**");
  assert.equal(maskDisplayName("Alex"), "Al**");
  assert.equal(maskDisplayName("권혁준"), "권*준");
  assert.equal(maskDisplayName("홍길동"), "홍*동");
  assert.equal(maskDisplayName("김준"), "김*");
  assert.equal(maskDisplayName("Ug**"), "Ug**");
  assert.equal(maskDisplayName("권*준"), "권*준");

  assert.match(page, /maskDisplayName\(user\.displayName\)/);
  assert.match(page, /maskDisplayName\(member\.display_name\)/);
  assert.match(page, /maskDisplayName\(item\.sender_name\)/);
  assert.match(api, /displayName: maskDisplayName\(displayName\(user\)\)/);
  assert.match(api, /host: maskDisplayName\(String\(row\.host_name\)\)/);
  assert.match(api, /sender_name: maskDisplayName\(String\(message\.sender_name\)\)/);
});
