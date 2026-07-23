import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SIKGU product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SIKGU 식구 · DGIST 공동주문<\/title>/);
  assert.match(html, /오늘, 누구랑 같이 먹을까요\?/);
  assert.match(html, /주문방 만들기/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
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
    "E2 연구동 정문",
    "E3 연구동 1층",
    "E4 연구동 정문",
    "E5 연구동 정문",
    "E6 연구동 정문",
    "학생생활관 201·202동 사이",
    "대학원생활관 정문",
  ]) {
    assert.match(page, new RegExp(pickup.replace("·", "\\·")));
  }

  assert.match(page, /pickupPoints\.map\(\(point\)/);
  assert.doesNotMatch(page, /pickupPoints\.slice\(0,\s*4\)/);
  assert.match(css, /\.choice-grid \{[\s\S]*grid-template-columns: repeat\(3, 1fr\)/);
});

test("ships with no fabricated live orders", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const initialPools: Pool\[\] = \[\];/);
  assert.doesNotMatch(page, /id: "p[1-4]"/);
  assert.doesNotMatch(page, /활성 주문 9개/);
  assert.doesNotMatch(page, /이번 주 절약[\s\S]*18,300원/);
  assert.match(page, /아직 활성 주문방이 없어요/);
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
