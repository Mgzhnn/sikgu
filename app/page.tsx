"use client";

import { useEffect, useMemo, useState } from "react";

type View = "home" | "restaurants" | "map" | "orders" | "profile";
type DeliveryApp = "baemin" | "coupang";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  badge?: string;
};

type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  mark: string;
  tone: string;
  rating?: number;
  reviews?: number;
  eta: string;
  minimum: Record<DeliveryApp, number>;
  deliveryFee: Record<DeliveryApp, number>;
  address?: string;
  verified?: boolean;
  menu: { title: string; items: MenuItem[] }[];
};

type Pool = {
  id: string;
  restaurantId: string;
  host: string;
  pickup: string;
  pickupFull: string;
  closesAt: number;
  total: number;
  target: number;
  people: number;
  capacity: number;
  apps: DeliveryApp[];
  membership: string;
  joined?: boolean;
  note: string;
};

const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const kakaoMapSearchUrl = (restaurant: Restaurant) =>
  `https://map.kakao.com/?q=${encodeURIComponent(`${restaurant.name} ${restaurant.address || "현풍 테크노폴리스"}`)}`;

const appLabels: Record<DeliveryApp, { name: string; membership: string }> = {
  baemin: { name: "배민", membership: "배민클럽" },
  coupang: { name: "쿠팡이츠", membership: "쿠팡와우" },
};

const sampleMenu = (
  prefix: string,
  items: [name: string, description: string, price: number][],
): Restaurant["menu"] => [
  {
    title: "대표 메뉴 · 앱에서 최종 확인",
    items: items.map(([name, description, price], index) => ({
      id: `${prefix}-${index + 1}`,
      name,
      description,
      price,
      badge: index === 0 ? "인기" : undefined,
    })),
  },
];

const restaurants: Restaurant[] = [
  {
    id: "sinjeon",
    name: "신전떡볶이",
    cuisine: "분식",
    mark: "신",
    tone: "coral",
    rating: 4.8,
    reviews: 326,
    eta: "25–35분",
    minimum: { baemin: 15000, coupang: 18000 },
    deliveryFee: { baemin: 3000, coupang: 2500 },
    menu: [
      {
        title: "인기 메뉴",
        items: [
          { id: "sin-tteok", name: "신전 떡볶이", description: "매콤달콤한 시그니처 국물 떡볶이", price: 4500, badge: "BEST" },
          { id: "sin-cheese", name: "치즈 떡볶이", description: "부드러운 모짜렐라 치즈 추가", price: 6500 },
          { id: "sin-set", name: "1인 알찬 세트", description: "떡볶이 · 튀김 3종 · 쿨피스", price: 12000, badge: "추천" },
        ],
      },
      {
        title: "사이드",
        items: [
          { id: "sin-fry", name: "모둠 튀김", description: "오뎅 · 만두 · 김말이 · 잡채말이", price: 5500 },
          { id: "sin-cup", name: "신전 치즈김밥", description: "톡 쏘는 매콤함과 고소한 치즈", price: 4500 },
        ],
      },
    ],
  },
  {
    id: "mom",
    name: "맘스터치 현풍점",
    cuisine: "버거",
    mark: "맘",
    tone: "gold",
    rating: 4.7,
    reviews: 512,
    eta: "30–40분",
    minimum: { baemin: 14000, coupang: 16000 },
    deliveryFee: { baemin: 2500, coupang: 3000 },
    menu: [
      {
        title: "버거 세트",
        items: [
          { id: "mom-thigh", name: "싸이버거 세트", description: "통다리살 패티 · 케이준감자 · 음료", price: 8900, badge: "BEST" },
          { id: "mom-white", name: "화이트갈릭버거 세트", description: "갈릭소스와 부드러운 닭가슴살", price: 9400 },
          { id: "mom-hot", name: "불싸이버거 세트", description: "화끈한 매운맛의 통다리살 버거", price: 9200 },
        ],
      },
      {
        title: "치킨 & 사이드",
        items: [
          { id: "mom-tender", name: "후라이드 텐더 4조각", description: "바삭한 순살 텐더", price: 6500 },
          { id: "mom-fries", name: "케이준 양념감자", description: "맘스터치 대표 사이드", price: 2500 },
        ],
      },
    ],
  },
  {
    id: "hongkong",
    name: "홍콩반점0410",
    cuisine: "중식",
    mark: "홍",
    tone: "indigo",
    rating: 4.6,
    reviews: 218,
    eta: "30–45분",
    minimum: { baemin: 16000, coupang: 14000 },
    deliveryFee: { baemin: 3500, coupang: 3500 },
    menu: [
      {
        title: "면 & 밥",
        items: [
          { id: "hk-jjajang", name: "짜장면", description: "불향을 입힌 진한 춘장 소스", price: 7000, badge: "BEST" },
          { id: "hk-jjam", name: "고기짬뽕", description: "푸짐한 고기와 얼큰한 국물", price: 9500 },
          { id: "hk-rice", name: "짬뽕밥", description: "얼큰한 짬뽕 국물과 공깃밥", price: 9000 },
        ],
      },
      {
        title: "함께 먹기",
        items: [
          { id: "hk-tang", name: "탕수육 소", description: "바삭한 등심과 새콤달콤 소스", price: 17000, badge: "함께" },
          { id: "hk-dumpling", name: "군만두", description: "노릇하게 구운 군만두 8개", price: 6000 },
        ],
      },
    ],
  },
  {
    id: "kyochon",
    name: "교촌치킨",
    cuisine: "치킨",
    mark: "교",
    tone: "mint",
    rating: 4.9,
    reviews: 648,
    eta: "35–50분",
    minimum: { baemin: 18000, coupang: 20000 },
    deliveryFee: { baemin: 3000, coupang: 2500 },
    menu: [
      {
        title: "시그니처",
        items: [
          { id: "kyo-honey", name: "허니콤보", description: "달콤한 허니소스와 바삭한 콤보", price: 23000, badge: "BEST" },
          { id: "kyo-red", name: "레드콤보", description: "국내산 청양 홍고추의 매운맛", price: 23000 },
          { id: "kyo-half", name: "반반콤보", description: "교촌 오리지널과 레드 반반", price: 24000 },
        ],
      },
      {
        title: "사이드",
        items: [
          { id: "kyo-rice", name: "웨지감자", description: "담백하고 바삭한 감자", price: 4500 },
          { id: "kyo-cheese", name: "치즈볼 6개", description: "쫀득한 모짜렐라 치즈볼", price: 6000 },
        ],
      },
    ],
  },
  {
    id: "dosirak",
    name: "한솥 테크노폴리스중리점",
    cuisine: "한식",
    mark: "한",
    tone: "sage",
    rating: 4.7,
    reviews: 184,
    eta: "20–30분",
    minimum: { baemin: 12000, coupang: 13000 },
    deliveryFee: { baemin: 2000, coupang: 2500 },
    address: "현풍읍 테크노상업로 48",
    verified: true,
    menu: [
      {
        title: "도시락",
        items: [
          { id: "han-chicken", name: "치킨마요", description: "치킨과 마요 드레싱의 든든한 조합", price: 4500, badge: "BEST" },
          { id: "han-bulgogi", name: "돈까스도련님", description: "돈까스 · 떡햄버그 · 반찬 4종", price: 5900 },
          { id: "han-premium", name: "진달래", description: "불고기 · 돈까스 · 새우튀김 프리미엄 도시락", price: 8500 },
        ],
      },
      {
        title: "추가 메뉴",
        items: [
          { id: "han-egg", name: "계란후라이", description: "노른자가 촉촉한 계란후라이", price: 1000 },
          { id: "han-soup", name: "미니 우동", description: "따뜻한 가쓰오 국물 우동", price: 2800 },
        ],
      },
    ],
  },
  {
    id: "sushi",
    name: "스시호 현풍",
    cuisine: "초밥",
    mark: "스",
    tone: "plum",
    rating: 4.8,
    reviews: 291,
    eta: "35–45분",
    minimum: { baemin: 18000, coupang: 15000 },
    deliveryFee: { baemin: 4000, coupang: 3500 },
    menu: [
      {
        title: "세트",
        items: [
          { id: "sushi-light", name: "오늘의 초밥 10p", description: "연어 · 광어 · 새우 · 유부 구성", price: 13900, badge: "BEST" },
          { id: "sushi-salmon", name: "연어 러버 12p", description: "생연어와 구운연어를 한 번에", price: 18900 },
          { id: "sushi-party", name: "모둠 초밥 24p", description: "함께 나누기 좋은 인기 초밥 구성", price: 32900, badge: "함께" },
        ],
      },
      {
        title: "사이드",
        items: [
          { id: "sushi-udon", name: "미니 우동", description: "유부와 쑥갓을 올린 따뜻한 우동", price: 4500 },
          { id: "sushi-shrimp", name: "새우튀김 4p", description: "바삭한 왕새우튀김", price: 6900 },
        ],
      },
    ],
  },
  {
    id: "mykatsu",
    name: "마이카츠 현풍테크노폴리스점",
    cuisine: "돈까스",
    mark: "카",
    tone: "coral",
    eta: "25–40분",
    minimum: { baemin: 13000, coupang: 15000 },
    deliveryFee: { baemin: 2800, coupang: 2800 },
    address: "유가읍 테크노상업로 112",
    verified: true,
    menu: sampleMenu("mykatsu", [
      ["마이카츠", "바삭한 등심 돈카츠", 5900],
      ["돈코츠라멘", "진한 돈코츠 육수와 생면", 6900],
      ["가라아게라이스", "바삭한 가라아게와 소스", 10900],
    ]),
  },
  {
    id: "subway",
    name: "써브웨이 대구테크노폴리스점",
    cuisine: "샌드위치",
    mark: "써",
    tone: "sage",
    eta: "20–35분",
    minimum: { baemin: 12000, coupang: 14000 },
    deliveryFee: { baemin: 2500, coupang: 2500 },
    address: "현풍읍 테크노상업로 62",
    verified: true,
    menu: sampleMenu("subway", [
      ["이탈리안 비엠티 15cm", "페퍼로니와 살라미의 클래식 조합", 6900],
      ["로티세리 바비큐 치킨 15cm", "부드러운 닭가슴살 샌드위치", 7900],
      ["에그마요 15cm", "고소하고 부드러운 에그마요", 5900],
    ]),
  },
  {
    id: "stella",
    name: "스텔라떡볶이 대구테크노현풍점",
    cuisine: "분식",
    mark: "별",
    tone: "gold",
    eta: "25–40분",
    minimum: { baemin: 14000, coupang: 15000 },
    deliveryFee: { baemin: 2800, coupang: 3000 },
    address: "유가읍 테크노상업로 84",
    verified: true,
    menu: sampleMenu("stella", [
      ["별튀김 떡볶이", "바삭한 별튀김을 곁들이는 떡볶이", 6500],
      ["로제 떡볶이", "부드럽고 매콤한 로제 소스", 8500],
      ["모둠튀김", "김말이·만두·오징어튀김 구성", 5500],
    ]),
  },
  {
    id: "yup",
    name: "동대문엽기떡볶이 대구테크노폴리스점",
    cuisine: "분식",
    mark: "엽",
    tone: "plum",
    eta: "30–45분",
    minimum: { baemin: 15000, coupang: 17000 },
    deliveryFee: { baemin: 3000, coupang: 3000 },
    address: "유가읍 테크노상업로 100",
    verified: true,
    menu: sampleMenu("yup", [
      ["엽기떡볶이", "취향대로 매운맛을 고르는 대표 메뉴", 14000],
      ["마라떡볶이", "알싸한 마라 풍미의 떡볶이", 16000],
      ["주먹김밥", "매운맛을 달래는 참치마요 주먹김밥", 3500],
    ]),
  },
  {
    id: "domino",
    name: "도미노피자 현풍점",
    cuisine: "피자",
    mark: "도",
    tone: "indigo",
    eta: "30–45분",
    minimum: { baemin: 18000, coupang: 20000 },
    deliveryFee: { baemin: 3000, coupang: 2500 },
    address: "현풍읍 테크노대로 24",
    verified: true,
    menu: sampleMenu("domino", [
      ["포테이토 피자", "담백한 감자와 베이컨 토핑", 27900],
      ["블랙타이거 슈림프", "통통한 새우와 치즈의 조합", 34900],
      ["슈퍼디럭스", "고기와 채소를 풍성하게 올린 클래식", 29900],
    ]),
  },
  {
    id: "youngpizza",
    name: "청년피자 현풍테크노점",
    cuisine: "피자",
    mark: "청",
    tone: "mint",
    eta: "30–50분",
    minimum: { baemin: 17000, coupang: 18000 },
    deliveryFee: { baemin: 2800, coupang: 3000 },
    address: "현풍읍 테크노상업로 26",
    verified: true,
    menu: sampleMenu("youngpizza", [
      ["리얼치즈피자", "치즈 풍미에 집중한 베이직 피자", 18900],
      ["에그콘피자", "달콤한 옥수수와 부드러운 에그소스", 21900],
      ["매드쉬림프", "탱글한 새우를 올린 시그니처 피자", 24900],
    ]),
  },
  {
    id: "pizzahut",
    name: "피자헛 대구현풍점",
    cuisine: "피자",
    mark: "헛",
    tone: "coral",
    eta: "30–50분",
    minimum: { baemin: 18000, coupang: 18000 },
    deliveryFee: { baemin: 3000, coupang: 3000 },
    address: "현풍읍 테크노상업로 46",
    verified: true,
    menu: sampleMenu("pizzahut", [
      ["수퍼슈프림", "고기와 채소 토핑을 가득 올린 피자", 27900],
      ["페페로니 러버", "짭짤한 페페로니가 풍성한 피자", 25900],
      ["치즈킹", "진한 치즈 풍미의 프리미엄 피자", 29900],
    ]),
  },
  {
    id: "bbq",
    name: "BBQ 테크노행복점",
    cuisine: "치킨",
    mark: "비",
    tone: "gold",
    eta: "35–50분",
    minimum: { baemin: 19000, coupang: 20000 },
    deliveryFee: { baemin: 3000, coupang: 2500 },
    address: "현풍읍 테크노공원로 17",
    verified: true,
    menu: sampleMenu("bbq", [
      ["황금올리브치킨", "바삭하고 고소한 시그니처 후라이드", 23000],
      ["자메이카 통다리구이", "매콤달콤한 소스의 통다리구이", 24000],
      ["황금올리브 반반", "후라이드와 양념을 한 번에", 24000],
    ]),
  },
  {
    id: "hosigi",
    name: "호식이두마리치킨 현풍테크노점",
    cuisine: "치킨",
    mark: "호",
    tone: "mint",
    eta: "35–55분",
    minimum: { baemin: 20000, coupang: 21000 },
    deliveryFee: { baemin: 2800, coupang: 3000 },
    address: "현풍읍 테크노중앙대로 325-9",
    verified: true,
    menu: sampleMenu("hosigi", [
      ["후라이드+양념 두마리", "함께 나누기 좋은 반반 두마리 세트", 27000],
      ["간장치킨+후라이드", "달콤짭짤 간장과 바삭한 후라이드", 27000],
      ["매운간장치킨", "알싸한 매운맛의 간장치킨", 17000],
    ]),
  },
  {
    id: "ogburger",
    name: "오지(OG)버거",
    cuisine: "버거",
    mark: "OG",
    tone: "indigo",
    eta: "25–40분",
    minimum: { baemin: 14000, coupang: 15000 },
    deliveryFee: { baemin: 2500, coupang: 2800 },
    address: "유가읍 테크노상업로 96",
    verified: true,
    menu: sampleMenu("ogburger", [
      ["OG 시그니처 버거 세트", "육즙 가득한 패티와 감자튀김", 10900],
      ["베이컨 치즈버거 세트", "베이컨과 치즈를 더한 든든한 세트", 11900],
      ["치킨버거 세트", "바삭한 치킨 패티와 신선한 채소", 9900],
    ]),
  },
  {
    id: "bonjuk",
    name: "본죽&비빔밥 대구테크노폴리스점",
    cuisine: "한식",
    mark: "본",
    tone: "sage",
    eta: "25–40분",
    minimum: { baemin: 13000, coupang: 15000 },
    deliveryFee: { baemin: 2500, coupang: 2800 },
    address: "현풍읍 테크노중앙대로 243",
    verified: true,
    menu: sampleMenu("bonjuk", [
      ["쇠고기야채죽", "쇠고기와 채소를 부드럽게 끓인 죽", 11000],
      ["낙지김치죽", "매콤한 낙지와 김치의 든든한 조합", 12000],
      ["곤드레비빔밥", "향긋한 곤드레와 나물 비빔밥", 10500],
    ]),
  },
  {
    id: "agu",
    name: "인생아구찜 현풍테크노점",
    cuisine: "해물",
    mark: "아",
    tone: "coral",
    eta: "35–55분",
    minimum: { baemin: 22000, coupang: 23000 },
    deliveryFee: { baemin: 3500, coupang: 3500 },
    address: "현풍읍 테크노상업로 50",
    verified: true,
    menu: sampleMenu("agu", [
      ["아구찜 소", "매콤한 양념과 아삭한 콩나물", 29000],
      ["해물찜 소", "다양한 해산물을 푸짐하게 담은 찜", 33000],
      ["볶음밥", "찜 양념에 볶아 먹는 마무리 메뉴", 3000],
    ]),
  },
  {
    id: "dakguksu",
    name: "현풍닭칼국수 대구테크노폴리스점",
    cuisine: "국수",
    mark: "닭",
    tone: "gold",
    eta: "30–45분",
    minimum: { baemin: 15000, coupang: 16000 },
    deliveryFee: { baemin: 2800, coupang: 3000 },
    address: "현풍읍 테크노상업로 68",
    verified: true,
    menu: sampleMenu("dakguksu", [
      ["닭칼국수", "진한 닭육수와 쫄깃한 면", 9000],
      ["얼큰닭칼국수", "칼칼한 국물의 닭칼국수", 9500],
      ["한방수육 소", "부드럽게 삶은 한방 수육", 18000],
    ]),
  },
  {
    id: "kimchijjim",
    name: "성서한옥집김치찜 현풍",
    cuisine: "한식",
    mark: "찜",
    tone: "plum",
    eta: "30–45분",
    minimum: { baemin: 16000, coupang: 17000 },
    deliveryFee: { baemin: 3000, coupang: 3000 },
    address: "현풍읍 테크노상업로2길 15-1",
    verified: true,
    menu: sampleMenu("kimchijjim", [
      ["돼지김치찜", "푹 익은 김치와 부드러운 돼지고기", 11000],
      ["김치찌개", "얼큰하고 진한 국물의 한 끼", 9000],
      ["계란말이", "김치찜과 잘 어울리는 도톰한 계란말이", 7000],
    ]),
  },
  {
    id: "cozy",
    name: "코지하우스 현풍점",
    cuisine: "양식",
    mark: "코",
    tone: "indigo",
    eta: "35–55분",
    minimum: { baemin: 18000, coupang: 20000 },
    deliveryFee: { baemin: 3500, coupang: 3500 },
    address: "현풍읍 테크노상업로2길 상권",
    verified: true,
    menu: sampleMenu("cozy", [
      ["10달러 스테이크", "부드러운 스테이크와 구운 채소", 13900],
      ["새우 로제 파스타", "통통한 새우와 부드러운 로제 소스", 12900],
      ["관자 오일 파스타", "관자와 마늘 풍미의 오일 파스타", 13900],
    ]),
  },
];

const pickupPoints = [
  { id: "E1", full: "E1 연구동 정문", walk: 3, lat: 35.706, lng: 128.456 },
  { id: "E2", full: "E2 연구동 정문", walk: 2, lat: 35.7057, lng: 128.4565 },
  { id: "E3", full: "E3 연구동 1층", walk: 1, lat: 35.7053, lng: 128.4571 },
  { id: "E4", full: "E4 연구동 정문", walk: 4, lat: 35.7049, lng: 128.4576 },
  { id: "E5", full: "E5 연구동 정문", walk: 5, lat: 35.7045, lng: 128.458 },
  { id: "E6", full: "E6 연구동 정문", walk: 6, lat: 35.7041, lng: 128.4584 },
  { id: "201·202", full: "학생생활관 201·202동 사이", walk: 7, lat: 35.7018, lng: 128.456 },
  { id: "대학원", full: "대학원생활관 정문", walk: 8, lat: 35.703, lng: 128.4568 },
];

const initialPools: Pool[] = [];

const navItems: { id: View; label: string; compact: string; icon: string }[] = [
  { id: "home", label: "주문 모아보기", compact: "홈", icon: "⌂" },
  { id: "restaurants", label: "가게 · 메뉴", compact: "가게", icon: "⌕" },
  { id: "map", label: "캠퍼스 지도", compact: "지도", icon: "◎" },
  { id: "orders", label: "내 주문", compact: "주문", icon: "◷" },
  { id: "profile", label: "내 정보", compact: "MY", icon: "◌" },
];

function timeLeft(timestamp: number, now: number) {
  const total = Math.max(0, Math.ceil((timestamp - now) / 60000));
  return total <= 0 ? "마감" : `${total}분 후 마감`;
}

function Brand() {
  return (
    <div className="brand" aria-label="식구 홈">
      <span className="brand-mark">식</span>
      <span>
        <strong>SIKGU</strong>
        <small>같이 먹는 캠퍼스</small>
      </span>
    </div>
  );
}

function RestaurantMark({ restaurant, large = false }: { restaurant: Restaurant; large?: boolean }) {
  return (
    <div className={`restaurant-mark ${restaurant.tone} ${large ? "large" : ""}`}>
      <span>{restaurant.mark}</span>
      <i />
    </div>
  );
}

function Progress({ current, target }: { current: number; target: number }) {
  const percentage = Math.min(100, Math.round((current / target) * 100));
  return (
    <div className="progress" aria-label={`${percentage}% 달성`}>
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}

function PoolCard({
  pool,
  now,
  onOpen,
}: {
  pool: Pool;
  now: number;
  onOpen: (pool: Pool) => void;
}) {
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = Math.max(0, pool.target - pool.total);
  const ready = gap === 0;

  return (
    <article className="pool-card">
      <button className="pool-card-hit" onClick={() => onOpen(pool)} aria-label={`${restaurant.name} 공동주문 자세히 보기`}>
        <div className="pool-card-top">
          <RestaurantMark restaurant={restaurant} />
          <div className="pool-identity">
            <div className="pool-title-line">
              <h3>{restaurant.name}</h3>
              <span className={`status-pill ${ready ? "ready" : ""}`}>{ready ? "주문 가능" : "모집중"}</span>
            </div>
            <p>{restaurant.cuisine} · {restaurant.eta}</p>
          </div>
          <span className="chevron" aria-hidden="true">›</span>
        </div>

        <div className="pool-route">
          <span className="route-pin">{pool.pickup}</span>
          <div>
            <strong>{pool.pickupFull}</strong>
            <small>{timeLeft(pool.closesAt, now)} · {pool.people}/{pool.capacity}명</small>
          </div>
        </div>

        <div className="pool-progress-copy">
          <span>{ready ? "최소금액 달성" : `${money(gap)}만 더 모으면 돼요`}</span>
          <strong>{money(pool.total)} <small>/ {money(pool.target)}</small></strong>
        </div>
        <Progress current={pool.total} target={pool.target} />

        <div className="pool-card-bottom">
          <span className="membership-line"><b>✓</b>{pool.membership}</span>
          <span className="people-stack" aria-label={`${pool.people}명 참여 중`}>
            {Array.from({ length: Math.min(pool.people, 3) }).map((_, index) => (
              <i key={index}>{["민", "서", "훈"][index]}</i>
            ))}
            {pool.people > 3 && <em>+{pool.people - 3}</em>}
          </span>
        </div>
      </button>
    </article>
  );
}

function Header({
  title,
  subtitle,
  onCreate,
}: {
  title: string;
  subtitle: string;
  onCreate: () => void;
}) {
  return (
    <header className="content-header">
      <div>
        <span className="eyebrow">{subtitle}</span>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <button className="primary-button compact" onClick={onCreate}><span>＋</span> 주문방 만들기</button>
      </div>
    </header>
  );
}

function HomeView({
  pools,
  now,
  search,
  setSearch,
  category,
  setCategory,
  onOpenPool,
  onCreate,
  onRestaurants,
}: {
  pools: Pool[];
  now: number;
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  onOpenPool: (pool: Pool) => void;
  onCreate: () => void;
  onRestaurants: () => void;
}) {
  const categories = ["전체", "분식", "버거", "중식", "치킨", "한식", "초밥"];
  const filtered = pools.filter((pool) => {
    const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
    const matchesCategory = category === "전체" || restaurant.cuisine === category;
    const matchesSearch = `${restaurant.name} ${pool.pickupFull}`.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  const almostReady = [...pools].sort(
    (a, b) => (a.target - a.total) - (b.target - b.total),
  )[0];

  return (
    <>
      <Header title="오늘, 누구랑 같이 먹을까요?" subtitle="DGIST · 점심부터 야식까지" onCreate={onCreate} />

      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-kicker">SMART POOLING</span>
          <h2>혼자 넘기 어려운<br />최소 주문금액, <em>같이.</em></h2>
          <p>가까운 식구와 메뉴를 모으면 배달비는 줄고,<br className="desktop-break" /> 구독 멤버가 결제하면 0원이 될 수 있어요.</p>
          <div className="hero-actions">
            <button
              className="light-button"
              onClick={() => almostReady ? onOpenPool(almostReady) : onCreate()}
            >
              {almostReady ? "바로 참여하기" : "첫 주문방 만들기"} <span>→</span>
            </button>
            <button className="ghost-light-button" onClick={onRestaurants}>메뉴 둘러보기</button>
          </div>
        </div>
        <div className="hero-insight">
          <span className="live-label"><i /> 지금 캠퍼스</span>
          <strong>{pools.length}</strong>
          <p>개의 주문방이<br />식구를 기다리고 있어요</p>
          <div className="hero-saving">
            <span>현재 참여 가능</span>
            <b>{pools.length}개</b>
          </div>
        </div>
        <div className="hero-orbit one" />
        <div className="hero-orbit two" />
      </section>

      <div className="search-row">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="가게, 메뉴, 픽업 장소 검색"
          />
          {search && <button onClick={() => setSearch("")} aria-label="검색어 지우기">×</button>}
        </label>
        <button className="filter-button" aria-label="필터"><span>≡</span> 필터</button>
      </div>

      <div className="category-tabs" aria-label="음식 카테고리">
        {categories.map((item) => (
          <button className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>
        ))}
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span>NEAR YOU</span>
            <h2>지금 참여할 수 있는 주문</h2>
          </div>
          <button onClick={onRestaurants}>가게 전체보기 <span>→</span></button>
        </div>
        {filtered.length ? (
          <div className="pool-grid">
            {filtered.map((pool) => <PoolCard key={pool.id} pool={pool} now={now} onOpen={onOpenPool} />)}
          </div>
        ) : (
          <div className="empty-state">
            <span>⌕</span>
            <h3>조건에 맞는 주문방이 없어요</h3>
            <p>새 주문방을 열면 기다리던 식구에게 알려드릴게요.</p>
            <button className="primary-button" onClick={onCreate}>주문방 만들기</button>
          </div>
        )}
      </section>
    </>
  );
}

function RestaurantsView({
  onMenu,
  onCreate,
}: {
  onMenu: (restaurant: Restaurant) => void;
  onCreate: (restaurant?: Restaurant) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("전체");
  const filters = ["전체", "위치 확인 매장", "최소금액 낮은 순", "평점 4.8+"];
  const visible = restaurants
    .filter((restaurant) =>
      `${restaurant.name} ${restaurant.cuisine} ${restaurant.address || ""} ${restaurant.menu.flatMap((group) => group.items).map((item) => item.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()))
    .filter((restaurant) => filter !== "위치 확인 매장" || restaurant.verified)
    .filter((restaurant) => filter !== "평점 4.8+" || (restaurant.rating || 0) >= 4.8)
    .sort((a, b) => filter === "최소금액 낮은 순"
      ? Math.min(...Object.values(a.minimum)) - Math.min(...Object.values(b.minimum))
      : 0);

  return (
    <>
      <Header title="현풍에서 오늘 뭐 먹을까요?" subtitle={`테크노폴리스 상권 · ${restaurants.length}개 가게`} onCreate={() => onCreate()} />
      <div className="restaurant-directory-note">
        <div>
          <span>LOCAL DIRECTORY</span>
          <strong>현풍·유가 테크노폴리스 상권을 기준으로 정리했어요.</strong>
        </div>
        <p>배달 가능 여부와 최소주문·배달비는 시간과 주소에 따라 달라져요. 결제 전 배민·쿠팡이츠에서 한 번 더 확인해 주세요.</p>
      </div>
      <div className="restaurant-toolbar">
        <label className="search-box">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가게·메뉴·카테고리 검색" />
        </label>
        <div className="category-tabs compact-tabs">
          {filters.map((item) => (
            <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}</button>
          ))}
        </div>
      </div>

      <section className="restaurant-list">
        {visible.map((restaurant) => {
          const bestApp: DeliveryApp = restaurant.minimum.baemin <= restaurant.minimum.coupang ? "baemin" : "coupang";
          return (
            <article className="restaurant-card" key={restaurant.id}>
              <button className="restaurant-summary" onClick={() => onMenu(restaurant)}>
                <RestaurantMark restaurant={restaurant} large />
                <div className="restaurant-info">
                  <span className="cuisine-label">{restaurant.cuisine}{restaurant.verified && <em>위치 확인</em>}</span>
                  <h2>{restaurant.name}</h2>
                  <p>
                    {restaurant.rating
                      ? <><b>★ {restaurant.rating}</b> ({restaurant.reviews}) · </>
                      : <>테크노폴리스 상권 · </>}
                    {restaurant.eta}
                  </p>
                </div>
                <span className="chevron">›</span>
              </button>
              <a className="restaurant-location-link" href={kakaoMapSearchUrl(restaurant)} target="_blank" rel="noreferrer">
                <span>◎</span>{restaurant.address || "현풍 테크노폴리스"}<b>카카오맵 ↗</b>
              </a>
              <div className="app-price-compare">
                {(["baemin", "coupang"] as DeliveryApp[]).map((app) => (
                  <div className={bestApp === app ? "best" : ""} key={app}>
                    <span>{appLabels[app].name}{bestApp === app && <em>LOW</em>}</span>
                    <strong>예상 {money(restaurant.minimum[app])}부터</strong>
                    <small>예상 배달 {money(restaurant.deliveryFee[app])}</small>
                  </div>
                ))}
              </div>
              <div className="restaurant-card-actions">
                <button className="secondary-button" onClick={() => onMenu(restaurant)}>전체 메뉴</button>
                <button className="primary-button" onClick={() => onCreate(restaurant)}>이 가게로 방 만들기</button>
              </div>
            </article>
          );
        })}
      </section>
      {!visible.length && (
        <div className="empty-state restaurant-empty">
          <span>⌕</span>
          <h3>검색 결과가 없어요</h3>
          <p>다른 가게 이름이나 메뉴로 다시 찾아보세요.</p>
        </div>
      )}
    </>
  );
}

function MapView({
  onPool,
  pools,
  onCreate,
}: {
  onPool: (pool: Pool) => void;
  pools: Pool[];
  onCreate: () => void;
}) {
  const [selected, setSelected] = useState(pickupPoints.find((point) => point.id === "E3") || pickupPoints[0]);
  const nearbyPools = pools.filter((pool) => pool.pickup === selected.id);
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`;
  const kakaoUrl = `https://map.kakao.com/link/to/${encodeURIComponent(selected.full)},${selected.lat},${selected.lng}`;

  return (
    <>
      <Header title="가까운 픽업 장소를 찾아요" subtitle="LIVE CAMPUS MAP · DGIST" onCreate={onCreate} />
      <section className="map-layout">
        <div className="map-panel">
          <iframe
            title="DGIST 공동주문 픽업 지도"
            src={`https://www.google.com/maps?q=${selected.lat},${selected.lng}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <div className="map-floating-card">
            <span className="map-pin-large">{selected.id}</span>
            <div>
              <small>선택한 픽업 장소</small>
              <strong>{selected.full}</strong>
              <p>내 위치에서 도보 약 {selected.walk}분</p>
            </div>
          </div>
          <div className="map-provider">Google Maps</div>
        </div>

        <div className="pickup-panel">
          <div className="pickup-panel-head">
            <div>
              <span>픽업 장소</span>
              <h2>어디에서 만날까요?</h2>
            </div>
            <span className="live-count">{pools.length} live</span>
          </div>
          <div className="pickup-list">
            {pickupPoints.map((point) => (
              <button
                className={selected.id === point.id ? "active" : ""}
                onClick={() => setSelected(point)}
                key={point.id}
              >
                <span className="pickup-code">{point.id}</span>
                <span>
                  <strong>{point.full}</strong>
                  <small>도보 {point.walk}분 · 주문방 {pools.filter((pool) => pool.pickup === point.id).length}개</small>
                </span>
                <i>›</i>
              </button>
            ))}
          </div>
          <div className="map-link-row">
            <a href={directionsUrl} target="_blank" rel="noreferrer">Google 길찾기 <span>↗</span></a>
            <a href={kakaoUrl} target="_blank" rel="noreferrer">KakaoMap <span>↗</span></a>
          </div>
        </div>
      </section>

      <section className="section-block map-orders">
        <div className="section-heading">
          <div>
            <span>AT {selected.id}</span>
            <h2>{nearbyPools.length ? "이곳에서 받을 수 있는 주문" : "가까운 활성 주문"}</h2>
          </div>
        </div>
        {pools.length ? (
          <div className="pool-grid">
            {(nearbyPools.length ? nearbyPools : pools.slice(0, 2)).map((pool) => (
              <PoolCard pool={pool} now={Date.now()} onOpen={onPool} key={pool.id} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span>＋</span>
            <h3>아직 활성 주문방이 없어요</h3>
            <p>이 픽업 장소의 첫 주문방을 만들어 보세요.</p>
            <button className="primary-button" onClick={onCreate}>주문방 만들기</button>
          </div>
        )}
      </section>
    </>
  );
}

function OrdersView({
  pools,
  now,
  onPool,
  onCreate,
}: {
  pools: Pool[];
  now: number;
  onPool: (pool: Pool) => void;
  onCreate: () => void;
}) {
  const myPools = pools.filter((pool) => pool.joined);

  return (
    <>
      <Header title="내 주문을 한눈에 확인해요" subtitle="ORDERS · 정산까지 깔끔하게" onCreate={onCreate} />
      <section className="section-block">
        <div className="section-heading">
          <div><span>MY POOLS</span><h2>참여 중인 주문</h2></div>
        </div>
        {myPools.length ? (
          <div className="pool-grid">
            {myPools.map((pool) => <PoolCard key={pool.id} pool={pool} now={now} onOpen={onPool} />)}
          </div>
        ) : (
          <div className="empty-state orders-empty">
            <span>◷</span>
            <h3>아직 참여 중인 주문이 없어요</h3>
            <p>공개된 주문방에 참여하거나 새 주문방을 만들어 보세요.</p>
            <button className="primary-button" onClick={onCreate}>주문방 만들기</button>
          </div>
        )}
      </section>
    </>
  );
}

function ProfileView({
  membership,
  setMembership,
  onCreate,
}: {
  membership: string;
  setMembership: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <Header title="반가워요, 민수님" subtitle="PROFILE · 나의 식구 생활" onCreate={onCreate} />
      <section className="profile-hero">
        <div className="profile-avatar">민</div>
        <div>
          <h2>김민수</h2>
          <p>DGIST 대학원생 · E3</p>
          <span>이번 달 식구 레벨 <b>단골식구</b></span>
        </div>
        <div className="profile-stats">
          <span><strong>18</strong><small>함께한 주문</small></span>
          <span><strong>34,800원</strong><small>누적 절약</small></span>
          <span><strong>4.9</strong><small>식구 매너</small></span>
        </div>
      </section>

      <div className="profile-grid">
        <section className="settings-card">
          <div className="settings-head">
            <span className="setting-icon">₩</span>
            <div><h2>배달 멤버십</h2><p>보유한 구독을 알려주면 최적 결제자로 추천해요.</p></div>
          </div>
          <div className="membership-options">
            {[
              ["none", "없음", "일반 배달비 분할"],
              ["baemin", "배민클럽", "배민 배달비 0원"],
              ["coupang", "쿠팡와우", "쿠팡이츠 배달비 0원"],
            ].map(([value, label, detail]) => (
              <button className={membership === value ? "active" : ""} onClick={() => setMembership(value)} key={value}>
                <i>{membership === value ? "✓" : ""}</i>
                <span><strong>{label}</strong><small>{detail}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-head">
            <span className="setting-icon">↗</span>
            <div><h2>연결된 서비스</h2><p>더 빠른 로그인과 정산을 위한 연결이에요.</p></div>
          </div>
          <div className="connected-list">
            {[
              ["DGIST OneID", "학교 계정 인증됨", "연결됨"],
              ["시간표", "학사 일정으로 식사시간 추천", "연결됨"],
              ["Toss · KakaoPay", "간편 정산 연결", "연결하기"],
            ].map(([name, detail, action], index) => (
              <div key={name}>
                <i className={index < 2 ? "on" : ""} />
                <span><strong>{name}</strong><small>{detail}</small></span>
                <button>{action}</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="impact-card">
        <div>
          <span>YOUR JULY IMPACT</span>
          <h2>혼자 주문했을 때보다<br /><em>일회용품 12개</em>를 줄였어요.</h2>
          <p>식구와 주문을 합치면 배달 이동과 포장도 자연스럽게 줄어들어요.</p>
        </div>
        <div className="impact-visual"><span>12</span><small>less packages</small></div>
      </section>
    </>
  );
}

function RightRail({ pools, now, onPool, onMap }: { pools: Pool[]; now: number; onPool: (pool: Pool) => void; onMap: () => void }) {
  const closest = pools[0];
  const restaurant = closest
    ? restaurants.find((item) => item.id === closest.restaurantId)
    : undefined;
  const e1Count = pools.filter((pool) => pool.pickup === "E1").length;
  const e3Count = pools.filter((pool) => pool.pickup === "E3").length;
  const dormCount = pools.filter((pool) => pool.pickup === "201·202" || pool.pickup === "대학원").length;

  return (
    <aside className="right-rail">
      <section className="rail-profile">
        <div className="avatar">민</div>
        <div><strong>김민수</strong><small>E3 · 배민클럽</small></div>
        <button aria-label="프로필 메뉴">•••</button>
      </section>

      <section className="smart-match">
        <div className="smart-match-head">
          <span className="spark">✦</span>
          <div><small>SIKGU PICK</small><h2>지금 딱 맞는 주문</h2></div>
        </div>
        <p>내 위치와 메뉴, 마감시간을 기준으로 찾았어요.</p>
        {closest && restaurant ? (
          <button className="smart-pool" onClick={() => onPool(closest)}>
            <div className="smart-pool-head">
              <RestaurantMark restaurant={restaurant} />
              <div><strong>{restaurant.name}</strong><small>{closest.pickupFull}</small></div>
              <span>{timeLeft(closest.closesAt, now)}</span>
            </div>
            <div className="smart-gap">
              <span>주문까지</span><strong>{money(Math.max(0, closest.target - closest.total))}</strong>
            </div>
            <Progress current={closest.total} target={closest.target} />
            <div className="smart-saving"><span>참여 인원</span><b>{closest.people}명</b><i>→</i></div>
          </button>
        ) : (
          <div className="smart-pool-empty">
            <span>＋</span>
            <strong>추천할 주문이 아직 없어요</strong>
            <small>첫 주문방이 열리면 여기에 바로 보여드릴게요.</small>
          </div>
        )}
      </section>

      <section className="campus-glance">
        <div className="rail-section-head"><span>캠퍼스 한눈에</span><button onClick={onMap}>지도 보기</button></div>
        <button className="mini-map" onClick={onMap} aria-label="캠퍼스 지도 열기">
          <span className="road road-one" />
          <span className="road road-two" />
          <span className="mini-building e1">E1</span>
          <span className="mini-building e3">E3</span>
          <span className="mini-building dorm">생활관</span>
          {e1Count > 0 && <span className="map-dot dot-one"><i />{e1Count}</span>}
          {e3Count > 0 && <span className="map-dot dot-two"><i />{e3Count}</span>}
          {dormCount > 0 && <span className="map-dot dot-three"><i />{dormCount}</span>}
          <small>활성 주문 {pools.length}개</small>
        </button>
      </section>

      <section className="rail-tip">
        <span>식구 TIP</span>
        <p>멤버십 보유자가 결제하면 모두의 배달비가 사라져요.</p>
      </section>
    </aside>
  );
}

function MenuDrawer({
  restaurant,
  cart,
  setCart,
  onClose,
  onCreate,
}: {
  restaurant: Restaurant;
  cart: Record<string, number>;
  setCart: (cart: Record<string, number>) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const allItems = restaurant.menu.flatMap((group) => group.items);
  const total = allItems.reduce((sum, item) => sum + item.price * (cart[item.id] || 0), 0);
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const update = (id: string, delta: number) => {
    const quantity = Math.max(0, (cart[id] || 0) + delta);
    const next = { ...cart };
    if (quantity === 0) delete next[id];
    else next[id] = quantity;
    setCart(next);
  };

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="menu-drawer" role="dialog" aria-modal="true" aria-label={`${restaurant.name} 메뉴`}>
        <div className="drawer-head">
          <div className="drawer-title">
            <RestaurantMark restaurant={restaurant} large />
            <div>
              <span>{restaurant.cuisine}</span>
              <h2>{restaurant.name}</h2>
              <p>{restaurant.rating ? `★ ${restaurant.rating}` : restaurant.address || "현풍 테크노폴리스"} · {restaurant.eta}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="메뉴 닫기">×</button>
        </div>

        <div className="drawer-app-note">
          <div><span>배민 예상 최소주문</span><strong>{money(restaurant.minimum.baemin)}</strong></div>
          <div><span>쿠팡이츠 예상 최소주문</span><strong>{money(restaurant.minimum.coupang)}</strong></div>
          <p><b>TIP</b> 금액과 배달 가능 여부는 앱에서 최종 확인해 주세요.</p>
        </div>

        <div className="menu-groups">
          {restaurant.menu.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              {group.items.map((item) => {
                const quantity = cart[item.id] || 0;
                return (
                  <div className="menu-item" key={item.id}>
                    <div className="menu-item-copy">
                      <div>{item.badge && <span>{item.badge}</span>}<strong>{item.name}</strong></div>
                      <p>{item.description}</p>
                      <b>{money(item.price)}</b>
                    </div>
                    {quantity ? (
                      <div className="stepper">
                        <button onClick={() => update(item.id, -1)} aria-label={`${item.name} 수량 줄이기`}>−</button>
                        <span>{quantity}</span>
                        <button onClick={() => update(item.id, 1)} aria-label={`${item.name} 수량 늘리기`}>＋</button>
                      </div>
                    ) : (
                      <button className="add-menu" onClick={() => update(item.id, 1)} aria-label={`${item.name} 담기`}>＋</button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className="drawer-footer">
          {count > 0 && <div><span>{count}개 담음</span><strong>{money(total)}</strong></div>}
          <button className="primary-button" disabled={!count} onClick={onCreate}>
            {count ? "이 메뉴로 주문방 만들기" : "메뉴를 담아주세요"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function PoolModal({
  pool,
  now,
  onClose,
  onToggleJoin,
}: {
  pool: Pool;
  now: number;
  onClose: () => void;
  onToggleJoin: (pool: Pool) => void;
}) {
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = Math.max(0, pool.target - pool.total);
  const ready = gap === 0;
  const fee = Math.min(...pool.apps.map((app) => restaurant.deliveryFee[app]));
  const eachFee = pool.membership.includes("0원") || pool.membership.includes("클럽") ? 0 : Math.ceil(fee / pool.people);
  const appNames = pool.apps.map((app) => appLabels[app].name).join(" · ");

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pool-modal" role="dialog" aria-modal="true" aria-label={`${restaurant.name} 공동주문`}>
        <div className="modal-topbar">
          <button onClick={onClose} aria-label="공동주문 닫기">←</button>
          <span>{timeLeft(pool.closesAt, now)}</span>
          <button aria-label="공유하기">↗</button>
        </div>
        <div className="pool-modal-hero">
          <RestaurantMark restaurant={restaurant} large />
          <div><span>{restaurant.cuisine}</span><h2>{restaurant.name}</h2><p>{pool.pickupFull} · {pool.people}/{pool.capacity}명</p></div>
          <span className={`status-pill ${ready ? "ready" : ""}`}>{ready ? "주문 가능" : "모집중"}</span>
        </div>

        <div className="modal-progress">
          <div><span>{ready ? "최소 주문금액을 달성했어요" : `${money(gap)}만 더 모으면 주문 가능`}</span><strong>{money(pool.total)} <small>/ {money(pool.target)}</small></strong></div>
          <Progress current={pool.total} target={pool.target} />
          <div className="thresholds">
            <span style={{ left: `${Math.min(95, restaurant.minimum.coupang / Math.max(restaurant.minimum.baemin, restaurant.minimum.coupang) * 90)}%` }}>
              쿠팡 {money(restaurant.minimum.coupang)}
            </span>
            <span style={{ left: `${Math.min(78, restaurant.minimum.baemin / Math.max(restaurant.minimum.baemin, restaurant.minimum.coupang) * 74)}%` }}>
              배민 {money(restaurant.minimum.baemin)}
            </span>
          </div>
        </div>

        <div className="route-recommendation">
          <span className="spark">✦</span>
          <div>
            <small>선택 가능 주문 앱</small>
            <strong>{appNames} · {pool.membership}</strong>
            <p>{eachFee === 0 ? "멤버십 보유자가 결제해 모두의 배달비가 0원이에요." : `배달비를 나누면 1인당 약 ${money(eachFee)}이에요.`}</p>
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-title"><h3>참여 중인 식구</h3><span>{pool.people}명</span></div>
          <div className="participant-list">
            {Array.from({ length: pool.people }).map((_, index) => (
              <div key={index}>
                <span className="avatar">{["민", "서", "훈", "진"][index]}</span>
                <span><strong>{index === 0 ? pool.host : index === 1 ? "이*연" : "나"}</strong><small>{index === 0 ? "방장 · 결제 예정" : index === 1 ? "신전 떡볶이" : "메뉴 선택 전"}</small></span>
                <b>{index === 0 ? "6,000원" : index === 1 ? "4,500원" : "—"}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="host-note">
          <span>“</span><p>{pool.note}</p><small>— 방장 {pool.host}</small>
        </div>

        <div className="modal-footer">
          <div><span>예상 배달비</span><strong>{eachFee === 0 ? "0원" : money(eachFee)}<small> / 1인</small></strong></div>
          <button className={pool.joined ? "secondary-button" : "primary-button"} onClick={() => onToggleJoin(pool)}>
            {pool.joined ? "참여 취소" : ready ? "메뉴 담고 참여하기" : "이 주문에 참여하기"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CreateModal({
  preferredRestaurant,
  onClose,
  onCreate,
}: {
  preferredRestaurant?: Restaurant;
  onClose: () => void;
  onCreate: (values: { restaurantId: string; pickup: string; apps: DeliveryApp[]; minutes: number }) => void;
}) {
  const [restaurantId, setRestaurantId] = useState(preferredRestaurant?.id || restaurants[0].id);
  const [pickup, setPickup] = useState("E3");
  const [apps, setApps] = useState<DeliveryApp[]>(["baemin"]);
  const [minutes, setMinutes] = useState(30);
  const [restaurantQuery, setRestaurantQuery] = useState("");
  const [restaurantCategory, setRestaurantCategory] = useState("전체");
  const restaurant = restaurants.find((item) => item.id === restaurantId)!;
  const restaurantCategories = useMemo(
    () => ["전체", ...Array.from(new Set(restaurants.map((item) => item.cuisine)))],
    [],
  );
  const visibleRestaurants = useMemo(
    () => restaurants.filter((item) => {
      const matchesCategory = restaurantCategory === "전체" || item.cuisine === restaurantCategory;
      const haystack = `${item.name} ${item.cuisine} ${item.address || ""}`.toLowerCase();
      return matchesCategory && haystack.includes(restaurantQuery.trim().toLowerCase());
    }),
    [restaurantCategory, restaurantQuery],
  );
  const selectedAppNames = apps.map((app) => appLabels[app].name).join(" · ");
  const selectedMinimum = apps.length
    ? Math.min(...apps.map((app) => restaurant.minimum[app]))
    : null;
  const toggleApp = (app: DeliveryApp) => {
    setApps((current) => current.includes(app)
      ? current.filter((item) => item !== app)
      : [...current, app]);
  };

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-modal" role="dialog" aria-modal="true" aria-label="새 주문방 만들기">
        <div className="create-head">
          <div><span>NEW POOL</span><h2>새 주문방 만들기</h2><p>가게와 약속 장소만 정하면 바로 식구를 찾아드려요.</p></div>
          <button onClick={onClose} aria-label="주문방 만들기 닫기">×</button>
        </div>

        <div className="form-field">
          <div className="restaurant-picker-label">
            <label htmlFor="restaurant-search">어디에서 주문할까요?</label>
            <span>{restaurants.length}개 가게</span>
          </div>
          <label className="restaurant-picker-search">
            <span>⌕</span>
            <input
              id="restaurant-search"
              value={restaurantQuery}
              onChange={(event) => setRestaurantQuery(event.target.value)}
              placeholder="가게 이름이나 음식 검색"
              autoComplete="off"
            />
            {restaurantQuery && <button onClick={() => setRestaurantQuery("")} aria-label="가게 검색어 지우기">×</button>}
          </label>
          <div className="restaurant-picker-categories" aria-label="가게 카테고리">
            {restaurantCategories.map((item) => (
              <button
                className={restaurantCategory === item ? "active" : ""}
                onClick={() => setRestaurantCategory(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="restaurant-picker-list" role="listbox" aria-label="현풍 테크노폴리스 가게 목록">
            {visibleRestaurants.map((item) => (
              <button
                className={restaurantId === item.id ? "active" : ""}
                onClick={() => setRestaurantId(item.id)}
                role="option"
                aria-selected={restaurantId === item.id}
                key={item.id}
              >
                <RestaurantMark restaurant={item} />
                <span className="restaurant-picker-copy">
                  <strong>{item.name}</strong>
                  <small>{item.cuisine} · {item.address || "현풍 테크노폴리스"}</small>
                </span>
                <span className="restaurant-picker-price">
                  <small>{selectedAppNames || "주문 앱 선택"} 예상</small>
                  <strong>{apps.length ? `${money(Math.min(...apps.map((app) => item.minimum[app])))}~` : "—"}</strong>
                </span>
                <i aria-hidden="true">{restaurantId === item.id ? "✓" : "›"}</i>
              </button>
            ))}
            {!visibleRestaurants.length && (
              <div className="restaurant-picker-empty">
                <span>⌕</span>
                <strong>찾는 가게가 없어요</strong>
                <small>다른 이름이나 카테고리를 선택해 보세요.</small>
              </div>
            )}
          </div>
          <div className="selected-restaurant-row">
            <div>
              <span>선택한 가게</span>
              <strong>{restaurant.name}</strong>
            </div>
            <a href={kakaoMapSearchUrl(restaurant)} target="_blank" rel="noreferrer">카카오맵 확인 ↗</a>
          </div>
          <div className="form-hint">
            <span>{selectedAppNames || "주문 앱을 선택해 주세요"} 예상 최소주문</span>
            <strong>{selectedMinimum === null ? "—" : money(selectedMinimum)}</strong>
          </div>
          <p className="delivery-data-note">배달앱의 실시간 영업·배달 가능 여부와 금액은 주문 전 최종 확인해 주세요.</p>
        </div>

        <div className="form-field">
          <label>픽업 장소</label>
          <div className="choice-grid">
            {pickupPoints.map((point) => (
              <button className={pickup === point.id ? "active" : ""} onClick={() => setPickup(point.id)} key={point.id}>
                <span>{point.id}</span><small>{point.full}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-two-col">
          <div className="form-field">
            <label>모집 시간</label>
            <div className="segmented">
              {[20, 30, 45].map((value) => <button className={minutes === value ? "active" : ""} onClick={() => setMinutes(value)} key={value}>{value}분</button>)}
            </div>
          </div>
          <div className="form-field">
            <label>주문 앱</label>
            <div className="segmented multi-select" role="group" aria-label="주문 앱 복수 선택">
              {(["baemin", "coupang"] as DeliveryApp[]).map((value) => (
                <button
                  className={apps.includes(value) ? "active" : ""}
                  onClick={() => toggleApp(value)}
                  aria-pressed={apps.includes(value)}
                  key={value}
                >
                  <span aria-hidden="true">{apps.includes(value) ? "✓" : "＋"}</span>
                  {appLabels[value].name}
                </button>
              ))}
            </div>
            <small className="multi-select-help">하나 또는 두 앱을 모두 선택할 수 있어요.</small>
          </div>
        </div>

        <div className="membership-callout">
          <span>{apps.length === 2 ? "✓" : apps[0] === "baemin" ? "✓" : "✦"}</span>
          <div>
            <strong>{apps.length === 2 ? "두 앱 중 유리한 조건을 선택해요" : apps[0] === "baemin" ? "배민클럽이 적용돼요" : "쿠팡와우 보유자를 찾아드려요"}</strong>
            <p>{apps.length === 2 ? "모집이 끝나면 최소주문금액과 배달비를 비교해 결제 앱을 정할 수 있어요." : apps[0] === "baemin" ? "배민클럽 보유자가 결제하면 배달비를 아낄 수 있어요." : "와우 멤버가 결제하면 모두의 배달비가 0원이 될 수 있어요."}</p>
          </div>
        </div>

        <button
          className="primary-button create-submit"
          disabled={!apps.length}
          onClick={() => onCreate({ restaurantId, pickup, apps, minutes })}
        >
          {apps.length ? "식구 찾기 시작" : "주문 앱을 선택해 주세요"}
        </button>
      </section>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [pools, setPools] = useState<Pool[]>(initialPools);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [createFor, setCreateFor] = useState<Restaurant | undefined>();
  const [showCreate, setShowCreate] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("전체");
  const [membership, setMembership] = useState("baemin");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const viewCopy = useMemo(() => {
    if (view === "restaurants") return "가게 · 메뉴";
    if (view === "map") return "캠퍼스 지도";
    if (view === "orders") return "내 주문";
    if (view === "profile") return "내 정보";
    return "주문 모아보기";
  }, [view]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const openCreate = (restaurant?: Restaurant) => {
    setCreateFor(restaurant);
    setShowCreate(true);
  };

  const handleToggleJoin = (pool: Pool) => {
    const joining = !pool.joined;
    setPools((current) => current.map((item) => item.id === pool.id
      ? { ...item, joined: joining, people: item.people + (joining ? 1 : -1), total: item.total + (joining ? 4500 : -4500) }
      : item));
    setSelectedPool(null);
    notify(joining ? "주문방에 참여했어요. 이제 내 메뉴를 골라주세요." : "주문방 참여를 취소했어요.");
  };

  const handleCreate = (values: { restaurantId: string; pickup: string; apps: DeliveryApp[]; minutes: number }) => {
    const restaurant = restaurants.find((item) => item.id === values.restaurantId)!;
    const point = pickupPoints.find((item) => item.id === values.pickup)
      || pickupPoints.find((item) => item.id === "E3")
      || pickupPoints[0];
    const newPool: Pool = {
      id: `pool-${Date.now()}`,
      restaurantId: values.restaurantId,
      host: "나",
      pickup: point.id,
      pickupFull: point.full,
      closesAt: Date.now() + values.minutes * 60 * 1000,
      total: Object.entries(cart).reduce((sum, [id, quantity]) => {
        const menuItem = restaurant.menu.flatMap((group) => group.items).find((item) => item.id === id);
        return sum + (menuItem?.price || 0) * quantity;
      }, 0),
      target: Math.min(...values.apps.map((app) => restaurant.minimum[app])),
      people: 1,
      capacity: 4,
      apps: values.apps,
      membership: values.apps.length === 2
        ? "결제 앱은 주문 확정 전에 선택"
        : values.apps[0] === "baemin"
          ? "배민클럽 보유자 결제"
          : "쿠팡와우 보유자 찾는 중",
      joined: true,
      note: "같이 맛있게 먹어요!",
    };
    setPools((current) => [newPool, ...current]);
    setShowCreate(false);
    setSelectedRestaurant(null);
    setCart({});
    setView("home");
    notify("새 주문방을 열었어요. 주변 식구에게 알려드렸습니다.");
  };

  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="location-card">
          <span>현재 위치</span>
          <button><i /> DGIST E3 <b>⌄</b></button>
        </div>
        <nav className="side-nav" aria-label="주 메뉴">
          <span className="nav-label">MENU</span>
          {navItems.map((item) => (
            <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "orders" && pools.some((pool) => pool.joined) && <i>{pools.filter((pool) => pool.joined).length}</i>}
            </button>
          ))}
        </nav>
        <button className="help-link"><span>?</span> 도움말 · 제안 보내기</button>
      </aside>

      <main className="main-content">
        <div className="mobile-top">
          <Brand />
          <button onClick={() => openCreate()} aria-label="주문방 만들기">＋</button>
        </div>
        {view === "home" && (
          <HomeView
            pools={pools}
            now={now}
            search={search}
            setSearch={setSearch}
            category={category}
            setCategory={setCategory}
            onOpenPool={setSelectedPool}
            onCreate={() => openCreate()}
            onRestaurants={() => navigate("restaurants")}
          />
        )}
        {view === "restaurants" && <RestaurantsView onMenu={(restaurant) => { setSelectedRestaurant(restaurant); setCart({}); }} onCreate={openCreate} />}
        {view === "map" && <MapView pools={pools} onPool={setSelectedPool} onCreate={() => openCreate()} />}
        {view === "orders" && <OrdersView pools={pools} now={now} onPool={setSelectedPool} onCreate={() => openCreate()} />}
        {view === "profile" && <ProfileView membership={membership} onCreate={() => openCreate()} setMembership={(value) => { setMembership(value); notify("배달 멤버십 정보를 저장했어요."); }} />}
      </main>

      <RightRail pools={pools} now={now} onPool={setSelectedPool} onMap={() => navigate("map")} />

      <nav className="mobile-nav" aria-label="모바일 주 메뉴">
        {navItems.map((item) => (
          <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}>
            <span>{item.icon}</span><small>{item.compact}</small>
            {item.id === "orders" && pools.some((pool) => pool.joined) && <i />}
          </button>
        ))}
      </nav>

      {selectedRestaurant && (
        <MenuDrawer
          restaurant={selectedRestaurant}
          cart={cart}
          setCart={setCart}
          onClose={() => setSelectedRestaurant(null)}
          onCreate={() => {
            setCreateFor(selectedRestaurant);
            setSelectedRestaurant(null);
            setShowCreate(true);
          }}
        />
      )}
      {selectedPool && <PoolModal pool={selectedPool} now={now} onClose={() => setSelectedPool(null)} onToggleJoin={handleToggleJoin} />}
      {showCreate && <CreateModal preferredRestaurant={createFor} onClose={() => setShowCreate(false)} onCreate={handleCreate} />}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      <div className="sr-only" aria-live="polite">현재 화면: {viewCopy}</div>
    </div>
  );
}
