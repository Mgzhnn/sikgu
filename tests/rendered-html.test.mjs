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
  assert.match(page, /const \[apps, setApps\] = useState<DeliveryApp\[\]>\(\[\]\)/);
  assert.match(page, /aria-label="주문 앱 복수 선택"/);
  assert.match(page, /aria-pressed=\{apps\.includes\(value\)\}/);
  assert.match(page, /하나 또는 두 앱을 모두 선택할 수 있어요/);
  assert.match(page, /apps\.length \? "식구 찾기 시작" : "주문 앱을 선택해 주세요"/);
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

test("shows membership-backed delivery as free", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /type MembershipApp = DeliveryApp \| ""/);
  assert.match(page, /membership: "배민클럽"/);
  assert.match(page, /membership: "쿠팡 와우"/);
  assert.match(page, /const membershipApplied = membershipApp !== null && pool\.apps\.includes\(membershipApp\)/);
  assert.match(page, /await onCreate\(\{\s*restaurantId,\s*pickup,\s*apps,\s*minutes,\s*capacity,\s*membership,?\s*\}\)/);
  assert.match(page, /\{hasFreeDelivery \? "무료" : money\(eachFee\)\}/);
  assert.match(page, /\{!hasFreeDelivery && <small> \/ 1인<\/small>\}/);
  assert.match(api, /if \(membership && !apps\.includes\(membership\)\)/);
  assert.match(api, /선택한 주문 앱과 무료배달 멤버십이 일치하지 않습니다/);
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
  assert.match(page, /import \{ roomCapacities, roomDurations \} from "\.\/sikgu-rules\.mjs"/);
  assert.match(page, /\{roomCapacities\.map\(\(value\) =>/);
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
  assert.match(api, /cleanText\(payload\.body, 1000\)/);
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
  assert.match(page, /function useDialogLifecycle/);
  assert.match(page, /useDialogLifecycle\(roomDialogRef, onClose\)/);
  assert.match(page, /previouslyFocused\?\.focus\(\)/);
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

test("opens an accessible feedback dialog with static contact guidance", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const feedbackModal = page.slice(
    page.indexOf("function FeedbackModal"),
    page.indexOf("function PoolModal"),
  );

  assert.match(page, /const feedbackEmail = "gudwns5863@naver\.com"/);
  assert.match(feedbackModal, /function FeedbackModal/);
  assert.match(feedbackModal, /aria-labelledby="feedback-title"/);
  assert.match(feedbackModal, /aria-describedby="feedback-description"/);
  assert.match(feedbackModal, /수정할 내용이나 버그가 있으면 아래 이메일로 버그 내용을 적어서 보내주세요\./);
  assert.match(feedbackModal, /<strong>\{feedbackEmail\}<\/strong>/);
  assert.match(page, /showFeedback && <FeedbackModal/);
  assert.doesNotMatch(feedbackModal, /mailto:/);
  assert.doesNotMatch(feedbackModal, /navigator\.clipboard/);
  assert.doesNotMatch(feedbackModal, /feedback-details/);
  assert.doesNotMatch(feedbackModal, /이메일 앱 열기/);
  assert.doesNotMatch(page, /currentScreen=\{viewCopy\}/);
  assert.match(css, /\.feedback-modal/);
  assert.match(css, /\.feedback-instruction/);
  assert.match(css, /\.feedback-recipient strong/);
  assert.doesNotMatch(css, /\.feedback-type-grid/);
  assert.doesNotMatch(css, /\.feedback-field/);
});

test("lets hosts manage private order receipts and delete their rooms", async () => {
  const [
    hosting,
    schema,
    baseMigration,
    mutationMigration,
    api,
    receiptImage,
    page,
    css,
    worker,
  ] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_glossy_prodigy.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_mutation_locks.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sikgu/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/receipt-image.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"r2":\s*"UPLOADS"/);
  assert.match(worker, /UPLOADS: R2Bucket/);
  for (const field of ["estimatedArrival", "orderTotal", "receiptKey", "receiptContentType", "receiptUploadedAt"]) {
    assert.match(schema, new RegExp(field));
  }
  for (const field of ["mutationToken", "mutationStartedAt"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(baseMigration, /DELETE FROM `room_messages`[\s\S]*DELETE FROM `room_invites`[\s\S]*DELETE FROM `room_members`[\s\S]*DELETE FROM `rooms`/);
  assert.match(mutationMigration, /ALTER TABLE `rooms` ADD `mutation_token` text/);
  assert.match(mutationMigration, /ALTER TABLE `rooms` ADD `mutation_started_at` integer/);

  assert.match(api, /export async function PUT/);
  assert.match(api, /room\.host_email !== auth\.email/);
  assert.match(api, /maxReceiptBytes = 8 \* 1024 \* 1024/);
  assert.match(api, /detectReceiptType/);
  assert.match(api, /newReceiptKey = `receipts\/\$\{id\}\/\$\{mutationToken\}\.\$\{receiptFileExtension\}`/);
  assert.doesNotMatch(api, /room\.receipt_key\?\.endsWith\("\/a"\)/);
  assert.match(api, /from "\.\.\/\.\.\/receipt-image\.mjs"/);
  assert.match(api, /sanitizeReceiptImage\(originalBuffer, detectedType\)/);
  assert.match(api, /validateReceiptImageData\(normalizedReceiptBuffer, detectedType\)/);
  assert.match(receiptImage, /const maxReceiptDimension = 2400/);
  assert.match(receiptImage, /const maxReceiptPixels = 5_760_000/);
  assert.match(api, /async function acquireRoomMutation/);
  assert.match(api, /SET mutation_token = \?, mutation_started_at = \?/);
  assert.match(api, /await acquireRoomMutation\(id, auth\.email, "update"\)/);
  assert.match(api, /UPDATE rooms[\s\S]{0,300}mutation_token = NULL, mutation_started_at = NULL[\s\S]{0,180}WHERE id = \? AND host_email = \? AND status = 'open' AND mutation_token = \?/);
  assert.match(api, /action === "receipt"/);
  assert.match(api, /room\.my_status !== "approved"/);
  assert.match(api, /"Cache-Control": "private, no-store"/);
  assert.match(api, /"X-Content-Type-Options": "nosniff"/);
  assert.match(api, /async function listReceiptKeysForRoom/);
  assert.match(api, /bucket\.list\(\{[\s\S]{0,100}prefix: `receipts\/\$\{id\}\/`/);
  assert.match(api, /await bucket\.delete\(allKeys\.slice\(offset, offset \+ 1000\)\)/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /await acquireRoomMutation\(id, auth\.email, "delete"\)/);
  assert.match(api, /deleteReceiptObjectsForRoom\(id, room\.receipt_key, true\)/);
  assert.match(api, /DELETE FROM rooms[\s\S]{0,180}WHERE id = \? AND host_email = \? AND status = 'deleting' AND mutation_token = \?/);

  assert.match(page, /ORDER UPDATE/);
  assert.match(page, /type="datetime-local"/);
  assert.match(page, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(page, /async function prepareReceiptUpload\(file: File\)/);
  assert.match(page, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}\)/);
  assert.match(page, /document\.createElement\("canvas"\)/);
  assert.match(page, /for \(const maxSide of \[2400, 2000, 1600, 1280, 1024\]\)/);
  assert.match(page, /Math\.min\(1, maxSide \/ Math\.max\(sourceWidth, sourceHeight\)\)/);
  assert.match(page, /context\.drawImage\(source, 0, 0, width, height\)/);
  assert.match(page, /new File\(\[blob\], "receipt\.png", \{ type: "image\/png"/);
  assert.match(page, /const preparedReceipt = receiptFile \? await prepareReceiptUpload\(receiptFile\) : null/);
  assert.match(page, /if \(preparedReceipt\) form\.set\("receipt", preparedReceipt\)/);
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

  assert.equal(maskDisplayName("Ugrp"), "Ug***");
  assert.equal(maskDisplayName("Alex"), "Al***");
  assert.equal(maskDisplayName("Jonathan Smith"), "Jo***");
  assert.equal(maskDisplayName("권혁준"), "권*준");
  assert.equal(maskDisplayName("홍길동"), "홍*동");
  assert.equal(maskDisplayName("김준"), "김*");
  assert.equal(maskDisplayName("Ug***"), "Ug***");
  assert.equal(maskDisplayName("권*준"), "권*준");

  assert.match(page, /maskDisplayName\(user\.displayName\)/);
  assert.match(page, /maskDisplayName\(member\.display_name\)/);
  assert.match(page, /maskDisplayName\(item\.sender_name\)/);
  assert.match(api, /displayName: maskDisplayName\(await displayName\(user\)\)/);
  assert.match(api, /crypto\.subtle\.digest\([\s\S]*return `User-\$\{suffix\}`/);
  assert.match(api, /function publicDisplayName\(value: unknown\)/);
  assert.match(api, /name\.includes\("@"\) \? "\uC0AC\uC6A9\uC790" : maskDisplayName\(name\)/);
  assert.match(api, /host: publicDisplayName\(row\.host_name\)/);
  assert.match(api, /display_name: publicDisplayName\(member\.display_name\)/);
  assert.match(api, /sender_name: publicDisplayName\(message\.sender_name\)/);
});

test("the receipt picker lets phones choose an existing screenshot instead of forcing the camera", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const receiptInput = page.slice(
    page.indexOf('className="receipt-upload"'),
    page.indexOf("receipt-privacy"),
  );

  assert.match(receiptInput, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(receiptInput, /capture=/);
});

test("money inputs accept any whole won amount instead of only multiples of 100", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const orderForm = page.slice(
    page.indexOf('className="order-info-form"'),
    page.indexOf('className="receipt-upload"'),
  );

  assert.equal((orderForm.match(/type="number"/g) || []).length, 2);
  assert.doesNotMatch(orderForm, /step="100"/);
  assert.equal((orderForm.match(/step="1"/g) || []).length, 2);
});

test("the chat composer keeps focus while a message is sending and never discards text typed meanwhile", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const composer = page.slice(page.indexOf('className="chat-composer"'), page.indexOf("</section>", page.indexOf('className="chat-composer"')));
  const sendMessage = page.slice(page.indexOf("const sendMessage = async"), page.indexOf("const openOrderEditor"));

  assert.match(composer, /<textarea[\s\S]*?\/>/);
  assert.doesNotMatch(composer, /<textarea[\s\S]*?disabled=\{sending\}[\s\S]*?\/>/);
  assert.match(composer, /disabled=\{sending \|\| !message\.trim\(\)\}/);
  assert.match(sendMessage, /if \(!body \|\| sending\) return/);
  assert.doesNotMatch(sendMessage, /setMessage\(""\)/);
  assert.match(sendMessage, /setMessage\(\(current\) => \(current\.trim\(\) === body \? "" : current\)\)/);
});

test("the client never shows a JSON parser error when the platform answers with an HTML error page", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const occurrences = (fragment) => page.split(fragment).length - 1;
  const readJson = page.slice(page.indexOf("const fallbackErrorByStatus"), page.indexOf("const dialogFocusableSelector"));

  assert.match(page, /async function readJson/);
  assert.match(readJson, /content-type/);
  assert.match(readJson, /catch/);
  assert.match(readJson, /서버 오류가 발생했습니다/);
  assert.equal(occurrences("await response.json()"), 0, "every response body must go through readJson");
  assert.ok(occurrences("await readJson<") >= 6, "post, saveOrderInfo, deleteRoom, postAction, loadRooms, loadRoom");
});

test("browser storage that throws (private mode, blocked site data) never breaks joining or loading", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const insideTry = (literal) => {
    const at = page.indexOf(literal);
    assert.notEqual(at, -1, `missing ${literal}`);
    const tryAt = page.lastIndexOf("try {", at);
    const catchAt = page.lastIndexOf("} catch", at);
    return tryAt !== -1 && tryAt > catchAt;
  };

  for (const literal of [
    "window.sessionStorage.getItem(pendingJoinStorageKey)",
    "window.localStorage.getItem(currentPickupStorageKey)",
    "window.localStorage.setItem(currentPickupStorageKey, currentPickup)",
    "window.sessionStorage.setItem(pendingJoinStorageKey",
  ]) {
    assert.ok(insideTry(literal), `${literal} must be wrapped in try/catch`);
  }
  // The pending join must reach sign-in even when storage is unavailable.
  const toggleJoin = page.slice(page.indexOf("const handleToggleJoin = async"), page.indexOf("const handleCreate = async"));
  assert.match(toggleJoin, /catch \{[\s\S]*?\}\s*signIn\(\);/);
});

test("new chat messages scroll only the message list, and only when the reader is at the bottom", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const scrollEffect = page.slice(page.indexOf("const list = chatListRef.current"), page.indexOf("const post = async"));

  assert.match(css, /\.chat-messages \{[^}]*overflow-y: auto/);
  assert.match(page, /const chatListRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(page, /const stickToBottomRef = useRef\(true\)/);
  assert.match(page, /className="chat-messages"[\s\S]{0,200}ref=\{chatListRef\}/);
  assert.match(page, /className="chat-messages"[\s\S]{0,300}onScroll=/);
  assert.match(scrollEffect, /if \(!stickToBottomRef\.current\) return/);
  assert.match(scrollEffect, /list\.scrollTop = list\.scrollHeight/);
  assert.match(scrollEffect, /messagesEndRef\.current\?\.scrollIntoView/);
  assert.ok(
    scrollEffect.indexOf("list.scrollTop = list.scrollHeight") < scrollEffect.indexOf("scrollIntoView"),
    "the list is scrolled directly; scrollIntoView (which scrolls every ancestor) is only the fallback",
  );
  const sendMessage = page.slice(page.indexOf("const sendMessage = async"), page.indexOf("const openOrderEditor"));
  assert.match(sendMessage, /stickToBottomRef\.current = true/);
});

test("feed refreshes after room actions never reject unhandled, and an expired session in the room hub goes to sign-in", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const occurrences = (fragment) => page.split(fragment).length - 1;
  const roomPost = page.slice(page.indexOf("const post = async"), page.indexOf("const review = async"));
  const globalPost = page.slice(page.indexOf("const postAction = useCallback"), page.indexOf("const loadRooms = useCallback"));

  assert.equal((page.match(/void loadRooms\(\)(?!\.catch)/g) || []).length, 0, "bare loadRooms() calls reject unhandled when bootstrap fails");
  assert.match(page, /const refreshRooms = useCallback\(\(\) => loadRooms\(\)\.catch\(\(\) => undefined\), \[loadRooms\]\)/);
  assert.ok(occurrences("refreshRooms()") >= 3, "onChanged, onDeleted, onLeft");
  assert.match(page, /function redirectToSignIn\(\)/);
  assert.match(roomPost, /response\.status === 401[\s\S]{0,80}redirectToSignIn\(\)/);
  assert.match(globalPost, /response\.status === 401[\s\S]{0,80}signIn\(\)/);
});

test("the pool dialog disables joining a full room and Escape is ignored mid-IME-composition", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const poolModal = page.slice(page.indexOf("function PoolModal"), page.indexOf("function RoomHubModal"));
  const dialogHook = page.slice(page.indexOf("function useDialogLifecycle"), page.indexOf("const appLabels"));
  const locationPicker = page.slice(page.indexOf("function LocationPicker"), page.indexOf("function RestaurantMark"));
  const homeView = page.slice(page.indexOf("function HomeView"), page.indexOf("function RestaurantsView"));

  assert.match(poolModal, /const isFull = !pool\.isHost && pool\.myStatus !== "approved" && pool\.people >= pool\.capacity/);
  assert.match(poolModal, /disabled=\{pool\.myStatus === "requested" \|\| joining \|\| isFull\}/);
  assert.match(poolModal, /isFull[\s\S]{0,40}"정원 마감"/);
  for (const [name, source] of [["dialog hook", dialogHook], ["location picker", locationPicker], ["home filter", homeView]]) {
    assert.match(source, /event\.isComposing \|\| event\.keyCode === 229/, `${name} must ignore Escape during composition`);
  }
});

test("an invite token leaves the address bar before sign-in and a failed resume is not retried forever", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const initialize = page.slice(page.indexOf("const initialize = async"), page.indexOf("void initialize()"));
  const inviteBranch = initialize.slice(initialize.indexOf("if (invite && invitedRoomId)"), initialize.indexOf("const pendingJoinRaw") > 0 ? initialize.indexOf("const pendingJoinRaw") : initialize.indexOf("let pendingJoinRaw"));

  assert.match(page, /const pendingInviteStorageKey = "sikgu-pending-invite"/);
  assert.ok(
    inviteBranch.indexOf("window.history.replaceState") !== -1
      && inviteBranch.indexOf("window.history.replaceState") < inviteBranch.indexOf("if (!data.user)"),
    "the token must be removed from the URL before the sign-in redirect captures it",
  );
  assert.match(inviteBranch, /sessionStorage\.setItem\(pendingInviteStorageKey/);
  assert.match(initialize, /sessionStorage\.getItem\(pendingInviteStorageKey\)/);
  assert.match(initialize, /sessionStorage\.removeItem\(pendingInviteStorageKey\)/);
  const pendingJoin = initialize.slice(initialize.indexOf("if (pendingJoinRoomId && data.user)"), initialize.indexOf("} catch (interactionError)"));
  assert.match(pendingJoin, /catch \(joinError\) \{[\s\S]*?sessionStorage\.removeItem\(pendingJoinStorageKey\)/);
});

test("every choice group in the create dialog has an accessible name and pressed state", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const createModal = page.slice(page.indexOf("function CreateModal"), page.indexOf("export default function Home"));

  assert.match(createModal, /<label id="create-pickup-label">픽업 장소<\/label>/);
  assert.match(createModal, /className="choice-grid" role="group" aria-labelledby="create-pickup-label"/);
  assert.match(createModal, /aria-pressed=\{pickup === point\.id\}/);
  assert.match(createModal, /<label id="create-duration-label">모집 시간<\/label>/);
  assert.match(createModal, /className="segmented" role="group" aria-labelledby="create-duration-label"/);
  assert.match(createModal, /aria-pressed=\{minutes === value\}/);
  for (const name of ["주문 앱 복수 선택", "무료배달 멤버십 선택", "주문방 최대 인원"]) {
    assert.match(createModal, new RegExp(`role="group" aria-label="${name}"`));
  }
});

test("the anonymous placeholder name survives re-masking on the client", () => {
  assert.equal(maskDisplayName("사용자"), "사용자");
  assert.equal(maskDisplayName(maskDisplayName("사용자")), "사용자");
  assert.equal(maskDisplayName(" 사용자 "), "사용자");
  // Ordinary three-syllable names are still masked in the middle.
  assert.equal(maskDisplayName("사용재"), "사*재");
});

test("the create dialog sends the chosen preset, not a deadline computed from the device clock", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const handleCreate = page.slice(page.indexOf("const handleCreate = async"), page.indexOf("const retryBootstrap"));
  assert.match(handleCreate, /minutes: values\.minutes/);
  assert.doesNotMatch(handleCreate, /closesAt/);
});

test("the room hub shows the deadline state and disables host actions that a closed room would refuse", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const roomHub = page.slice(page.indexOf("function RoomHubModal"), page.indexOf("function CreateModal"));

  assert.match(roomHub, /now: number;/);
  assert.match(roomHub, /const isClosed = Boolean\(room\) && room!\.closesAt <= now/);
  assert.match(roomHub, /isClosed \? "마감됨" : timeLeft\(room\.closesAt, now\)/);
  assert.match(roomHub, /disabled=\{creatingInvite \|\| isClosed\}/);
  assert.match(roomHub, /disabled=\{Boolean\(reviewingMember\) \|\| isClosed\}[\s\S]{0,120}"승인"/);
  assert.match(page, /<RoomHubModal[\s\S]{0,120}now=\{now\}/);
});

test("countdowns follow the server clock and a tab returning from sleep refreshes immediately", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const home = page.slice(page.indexOf("export default function Home"));

  assert.match(home, /const clockOffsetRef = useRef\(0\)/);
  assert.match(home, /clockOffsetRef\.current = data\.serverNow - Date\.now\(\)/);
  assert.match(home, /const serverNow = useCallback\(\(\) => Date\.now\(\) \+ clockOffsetRef\.current/);
  assert.match(home, /setNow\(serverNow\(\)\)/);
  assert.match(home, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(home, /document\.removeEventListener\("visibilitychange", handleVisibility\)/);
  assert.doesNotMatch(home, /setNow\(Date\.now\(\)\)/);
});
