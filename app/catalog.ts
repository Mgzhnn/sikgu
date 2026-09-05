import type { DeliveryApp, Restaurant, Pool, PoolFilters, View } from "./types";
import { restaurantMinimums } from "./sikgu-rules.mjs";

export const appLabels: Record<DeliveryApp, { name: string; membership: string }> = {
  baemin: { name: "배민", membership: "배민클럽" },
  coupang: { name: "쿠팡이츠", membership: "쿠팡 와우" },
};

export const sampleMenu = (
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

export const restaurants: Restaurant[] = [
  {
    id: "sinjeon",
    name: "신전떡볶이",
    cuisine: "분식",
    mark: "신",
    tone: "coral",
    eta: "25–35분",
    minimum: restaurantMinimums.sinjeon,
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
    eta: "30–40분",
    minimum: restaurantMinimums.mom,
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
    eta: "30–45분",
    minimum: restaurantMinimums.hongkong,
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
    eta: "35–50분",
    minimum: restaurantMinimums.kyochon,
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
    eta: "20–30분",
    minimum: restaurantMinimums.dosirak,
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
    eta: "35–45분",
    minimum: restaurantMinimums.sushi,
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
    minimum: restaurantMinimums.mykatsu,
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
    minimum: restaurantMinimums.subway,
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
    minimum: restaurantMinimums.stella,
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
    minimum: restaurantMinimums.yup,
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
    minimum: restaurantMinimums.domino,
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
    minimum: restaurantMinimums.youngpizza,
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
    minimum: restaurantMinimums.pizzahut,
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
    minimum: restaurantMinimums.bbq,
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
    minimum: restaurantMinimums.hosigi,
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
    minimum: restaurantMinimums.ogburger,
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
    minimum: restaurantMinimums.bonjuk,
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
    minimum: restaurantMinimums.agu,
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
    minimum: restaurantMinimums.dakguksu,
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
    minimum: restaurantMinimums.kimchijjim,
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
    minimum: restaurantMinimums.cozy,
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

export type PickupPoint = {
  id: string;
  code?: string;
  full: string;
  walk: number;
  lat: number;
  lng: number;
};

export const pickupPoints: PickupPoint[] = [
  { id: "E1", full: "E1 연구동 정문", walk: 3, lat: 35.706, lng: 128.456 },
  { id: "E2", full: "E2 택배보관함", walk: 2, lat: 35.7057, lng: 128.4565 },
  { id: "E3", full: "E3 택배보관함", walk: 1, lat: 35.705312, lng: 128.457146 },
  { id: "E4", full: "E4 택배보관함", walk: 4, lat: 35.7049, lng: 128.4576 },
  { id: "E5", full: "E5 택배보관함", walk: 5, lat: 35.7045, lng: 128.458 },
  { id: "E6", full: "E6 택배보관함", walk: 6, lat: 35.7041, lng: 128.4584 },
  {
    id: "201·202",
    code: "201-204",
    full: "201-204 사이 택배 수령장소",
    walk: 7,
    lat: 35.7035625,
    lng: 128.4624375,
  },
  {
    id: "대학원",
    code: "206",
    full: "비슬빌리지 206동 택배 수령장소",
    walk: 8,
    lat: 35.7037343,
    lng: 128.4633301,
  },
];

export const campusMapBounds = pickupPoints.reduce(
  (bounds, point) => ({
    minLat: Math.min(bounds.minLat, point.lat),
    maxLat: Math.max(bounds.maxLat, point.lat),
    minLng: Math.min(bounds.minLng, point.lng),
    maxLng: Math.max(bounds.maxLng, point.lng),
  }),
  {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  },
);

export function campusMapPosition(point: PickupPoint) {
  const latitudeSpan = campusMapBounds.maxLat - campusMapBounds.minLat || 1;
  const longitudeSpan = campusMapBounds.maxLng - campusMapBounds.minLng || 1;
  return {
    left: `${12 + ((point.lng - campusMapBounds.minLng) / longitudeSpan) * 76}%`,
    top: `${12 + ((campusMapBounds.maxLat - point.lat) / latitudeSpan) * 76}%`,
  };
}

export const currentPickupStorageKey = "sikgu-current-pickup";
export const pendingJoinStorageKey = "sikgu-pending-join";
export const initialPools: Pool[] = [];
export const defaultPoolFilters: PoolFilters = {
  availableOnly: false,
  currentPickupOnly: false,
  sortBy: "default",
};

export const navItems: { id: View; label: string; compact: string; icon: string }[] = [
  { id: "home", label: "주문 모아보기", compact: "홈", icon: "⌂" },
  { id: "restaurants", label: "가게 · 메뉴", compact: "가게", icon: "⌕" },
  { id: "profile", label: "내 정보", compact: "MY", icon: "◌" },
];

