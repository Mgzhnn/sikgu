"use client";

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { maskDisplayName } from "./name-mask.mjs";
import { roomCapacities, roomDurations } from "./sikgu-rules.mjs";

type View = "home" | "restaurants" | "profile";
type DeliveryApp = "baemin" | "coupang";
type MembershipApp = DeliveryApp | "";
type PoolSort = "default" | "deadline" | "remaining";

type PoolFilters = {
  availableOnly: boolean;
  currentPickupOnly: boolean;
  sortBy: PoolSort;
};

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
  note: string;
  myStatus?: "requested" | "approved" | null;
  isHost?: boolean;
  pendingCount?: number;
  estimatedArrival?: string | null;
  orderTotal?: number | null;
  receiptUrl?: string | null;
  receiptUploadedAt?: number | null;
};

type AuthUser = {
  displayName: string;
};

type RoomMember = {
  member_ref?: string;
  display_name: string;
  role: "host" | "member";
  status: "requested" | "approved";
  created_at: number;
};

type ChatMessage = {
  id: string;
  sender_name: string;
  body: string;
  created_at: number;
  mine: number;
};

const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const estimatedArrivalLabel = (value?: string | null) => {
  if (!value) return "미정";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const kakaoMapSearchUrl = (restaurant: Restaurant) =>
  `https://map.kakao.com/?q=${encodeURIComponent(`${restaurant.name} ${restaurant.address || "현풍 테크노폴리스"}`)}`;

const maxReceiptUploadBytes = 8 * 1024 * 1024;

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지를 처리하지 못했어요."))),
      type,
      quality,
    );
  });

async function prepareReceiptUpload(file: File) {
  let source: ImageBitmap | HTMLImageElement;
  let release: () => void = () => undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    release = () => bitmap.close();
  } catch {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("이미지 파일을 열 수 없어요."));
      image.src = objectUrl;
    }).finally(() => URL.revokeObjectURL(objectUrl));
    source = image;
  }

  try {
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    if (!sourceWidth || !sourceHeight) throw new Error("이미지 크기를 확인할 수 없어요.");
    const canvas = document.createElement("canvas");
    let blob: Blob | null = null;
    let previousSize = "";
    for (const maxSide of [2400, 2000, 1600, 1280, 1024]) {
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const size = `${width}x${height}`;
      if (size === previousSize) continue;
      previousSize = size;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("이미지를 처리할 수 없는 브라우저예요.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      blob = await canvasBlob(canvas, "image/png");
      if (blob.size <= maxReceiptUploadBytes) break;
    }
    if (!blob || blob.size > maxReceiptUploadBytes) {
      throw new Error("이미지를 8MB 이하로 줄이지 못했어요. 화면을 잘라서 다시 올려주세요.");
    }
    return new File([blob], "receipt.png", { type: "image/png", lastModified: Date.now() });
  } finally {
    release();
  }
}

/** Sends the browser to the platform sign-in route and back to the current page. */
function redirectToSignIn() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
}

const fallbackErrorByStatus = (status: number) => {
  if (status === 401) return "로그인이 필요합니다.";
  if (status === 403) return "허용되지 않은 요청입니다.";
  if (status === 404) return "주문방을 찾을 수 없습니다.";
  if (status === 413) return "요청 내용이 너무 큽니다.";
  if (status === 429) return "요청이 너무 잦아요. 잠시 후 다시 시도해주세요.";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  return "요청을 처리하지 못했어요.";
};

/**
 * Reads an API response body. Platform error pages (HTML 502/504, edge 413)
 * are not JSON; parsing them blindly threw a SyntaxError whose English
 * message ended up in the UI, so non-JSON bodies map to a Korean message.
 */
async function readJson<T extends object>(response: Response): Promise<T & { error?: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (parsed && typeof parsed === "object") return parsed as T & { error?: string };
    } catch {
      // A truncated or malformed body falls through to the status-based message.
    }
  }
  return (response.ok ? {} : { error: fallbackErrorByStatus(response.status) }) as T & { error?: string };
}

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function useDialogLifecycle(
  dialogRef: { current: HTMLElement | null },
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(dialogFocusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape during Korean/Japanese IME composition cancels the candidate,
      // not the dialog; closing here would discard the chat draft.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector))
        .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [dialogRef]);
}

const appLabels: Record<DeliveryApp, { name: string; membership: string }> = {
  baemin: { name: "배민", membership: "배민클럽" },
  coupang: { name: "쿠팡이츠", membership: "쿠팡 와우" },
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

type PickupPoint = {
  id: string;
  code?: string;
  full: string;
  walk: number;
  lat: number;
  lng: number;
};

const pickupPoints: PickupPoint[] = [
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

const campusMapBounds = pickupPoints.reduce(
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

function campusMapPosition(point: PickupPoint) {
  const latitudeSpan = campusMapBounds.maxLat - campusMapBounds.minLat || 1;
  const longitudeSpan = campusMapBounds.maxLng - campusMapBounds.minLng || 1;
  return {
    left: `${12 + ((point.lng - campusMapBounds.minLng) / longitudeSpan) * 76}%`,
    top: `${12 + ((campusMapBounds.maxLat - point.lat) / latitudeSpan) * 76}%`,
  };
}

const currentPickupStorageKey = "sikgu-current-pickup";
const pendingJoinStorageKey = "sikgu-pending-join";
const pendingInviteStorageKey = "sikgu-pending-invite";
const initialPools: Pool[] = [];
const defaultPoolFilters: PoolFilters = {
  availableOnly: false,
  currentPickupOnly: false,
  sortBy: "default",
};

const navItems: { id: View; label: string; compact: string; icon: string }[] = [
  { id: "home", label: "주문 모아보기", compact: "홈", icon: "⌂" },
  { id: "restaurants", label: "가게 · 메뉴", compact: "가게", icon: "⌕" },
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

function LocationPicker({
  currentPickup,
  onSelect,
  compact = false,
}: {
  currentPickup: string;
  onSelect: (point: PickupPoint) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const point = pickupPoints.find((item) => item.id === currentPickup) || pickupPoints[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`location-card ${compact ? "compact" : ""}`} ref={rootRef}>
      {!compact && <span>현재 위치</span>}
      <button
        type="button"
        className="location-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={compact ? "mobile-location-options" : "desktop-location-options"}
        ref={triggerRef}
      >
        <i aria-hidden="true" />
        <span>{compact ? point.code ?? point.id : `DGIST ${point.code ?? point.id}`}</span>
        <b aria-hidden="true">{open ? "⌃" : "⌄"}</b>
      </button>
      {open && (
        <div
          className="location-menu"
          id={compact ? "mobile-location-options" : "desktop-location-options"}
          aria-label="현재 위치 선택"
        >
          {pickupPoints.map((item) => (
            <button
              type="button"
              className={`location-option ${currentPickup === item.id ? "active" : ""}`}
              onClick={() => {
                onSelect(item);
                setOpen(false);
              }}
              aria-pressed={currentPickup === item.id}
              key={item.id}
            >
              <span className="location-code">{item.code ?? item.id}</span>
              <span><strong>{item.full}</strong><small>도보 기준 {item.walk}분</small></span>
              <b aria-hidden="true">{currentPickup === item.id ? "✓" : ""}</b>
            </button>
          ))}
        </div>
      )}
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
  const statusLabel = pool.isHost && pool.pendingCount
    ? `${pool.pendingCount}명 승인 대기`
    : pool.myStatus === "requested"
      ? "승인 대기"
      : pool.myStatus === "approved"
        ? "참여 중"
        : ready
          ? "주문 가능"
          : "모집중";

  return (
    <article className="pool-card">
      <button className="pool-card-hit" onClick={() => onOpen(pool)} aria-label={`${restaurant.name} 공동주문 자세히 보기`}>
        <div className="pool-card-top">
          <RestaurantMark restaurant={restaurant} />
          <div className="pool-identity">
            <div className="pool-title-line">
              <h3>{restaurant.name}</h3>
              <span className={`status-pill ${pool.myStatus === "approved" || ready ? "ready" : ""}`}>{statusLabel}</span>
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
          <span className="people-stack" aria-label={`${pool.people}명 참여 중`}>
            {Array.from({ length: Math.min(pool.people, 3) }).map((_, index) => (
              <i key={index} aria-hidden="true" />
            ))}
            {pool.people > 3 && <em>+{pool.people - 3}</em>}
          </span>
        </div>
      </button>
    </article>
  );
}

function CampusMapPreview({
  pools,
  currentPickup,
  onOpen,
}: {
  pools: Pool[];
  currentPickup: string;
  onOpen: (pickupId: string) => void;
}) {
  const poolCounts = pools.reduce<Record<string, number>>((counts, pool) => {
    counts[pool.pickup] = (counts[pool.pickup] || 0) + 1;
    return counts;
  }, {});

  return (
    <section className="campus-glance">
      <div className="rail-section-head">
        <span>캠퍼스 한눈에</span>
        <button type="button" onClick={() => onOpen(currentPickup)}>지도 크게 보기</button>
      </div>
      <div className="campus-map-preview">
        <button
          type="button"
          className="campus-map-expand"
          onClick={() => onOpen(currentPickup)}
          aria-label="캠퍼스 주문 지도 크게 보기"
          aria-haspopup="dialog"
        />
        <span className="campus-map-road road-main" aria-hidden="true" />
        <span className="campus-map-road road-branch" aria-hidden="true" />
        {pickupPoints.map((point) => {
          return (
            <span
              className={`campus-map-point-label ${point.id === currentPickup ? "current" : ""}`}
              style={campusMapPosition(point)}
              aria-hidden="true"
              key={point.id}
            >
              {point.code ?? point.id}
            </span>
          );
        })}
        {pickupPoints.map((point) => {
          const count = poolCounts[point.id] || 0;
          if (!count) return null;
          return (
            <button
              type="button"
              className="campus-map-preview-marker"
              style={campusMapPosition(point)}
              onClick={() => onOpen(point.id)}
              aria-label={`${point.full} 주문방 ${count}개 크게 보기`}
              key={point.id}
            >
              {count}
            </button>
          );
        })}
        <span className="campus-map-live-summary" aria-hidden="true">활성 주문 {pools.length}개</span>
      </div>
    </section>
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
  currentPickup,
  filters,
  setFilters,
  loading,
  loadError,
  onRetry,
  onOpenPool,
  onMap,
  onCreate,
  onRestaurants,
}: {
  pools: Pool[];
  now: number;
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  currentPickup: string;
  filters: PoolFilters;
  setFilters: Dispatch<SetStateAction<PoolFilters>>;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  onOpenPool: (pool: Pool) => void;
  onMap: (pickupId: string) => void;
  onCreate: () => void;
  onRestaurants: () => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterAnchorRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const categories = ["전체", "분식", "버거", "중식", "치킨", "한식", "초밥"];
  const activeFilterCount = Number(filters.availableOnly)
    + Number(filters.currentPickupOnly)
    + Number(filters.sortBy !== "default");
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = pools.filter((pool) => {
    const restaurant = restaurants.find((item) => item.id === pool.restaurantId);
    if (!restaurant || pool.closesAt <= now) return false;
    const isRelated = Boolean(
      pool.isHost || pool.myStatus === "approved" || pool.myStatus === "requested",
    );
    const matchesCategory = category === "전체" || restaurant.cuisine === category;
    const matchesSearch = `${restaurant.name} ${pool.pickupFull}`
      .toLowerCase()
      .includes(normalizedSearch);
    const matchesAvailable = !filters.availableOnly
      || pool.people < pool.capacity
      || isRelated;
    const matchesPickup = !filters.currentPickupOnly || pool.pickup === currentPickup;
    return matchesCategory && matchesSearch && matchesAvailable && matchesPickup;
  });
  if (filters.sortBy === "deadline") {
    filtered.sort((a, b) => a.closesAt - b.closesAt);
  } else if (filters.sortBy === "remaining") {
    filtered.sort(
      (a, b) => Math.max(0, a.target - a.total) - Math.max(0, b.target - b.total),
    );
  }

  const joinablePools = pools.filter((pool) => (
    pool.closesAt > now
    && pool.people < pool.capacity
  ));
  const almostReady = [...joinablePools].sort(
    (a, b) => (a.target - a.total) - (b.target - b.total),
  )[0];
  const hasAnyCriteria = Boolean(
    normalizedSearch || category !== "전체" || activeFilterCount,
  );

  const resetDetailFilters = () => setFilters(defaultPoolFilters);
  const resetAllFilters = () => {
    setSearch("");
    setCategory("전체");
    setFilters(defaultPoolFilters);
  };

  useEffect(() => {
    if (!filterOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      filterPanelRef.current?.querySelector<HTMLElement>("input, select")?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !filterAnchorRef.current?.contains(target)) setFilterOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFilterOpen(false);
      window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterOpen]);

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
          <strong>{joinablePools.length}</strong>
          <p>개의 주문방이<br />식구를 기다리고 있어요</p>
          <div className="hero-saving">
            <span>현재 참여 가능</span>
            <b>{joinablePools.length}개</b>
          </div>
        </div>
        <div className="hero-orbit one" />
        <div className="hero-orbit two" />
      </section>

      <div className="mobile-campus-glance">
        <CampusMapPreview pools={pools} currentPickup={currentPickup} onOpen={onMap} />
      </div>

      <div className="search-row">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="가게, 메뉴, 픽업 장소 검색"
            aria-label="주문방 검색"
          />
          {search && <button onClick={() => setSearch("")} aria-label="검색어 지우기">×</button>}
        </label>
        <div className="filter-anchor" ref={filterAnchorRef}>
          <button
            type="button"
            className={`filter-button ${activeFilterCount ? "active" : ""}`}
            onClick={() => setFilterOpen((open) => !open)}
            aria-label={activeFilterCount ? `필터, ${activeFilterCount}개 적용됨` : "필터 열기"}
            aria-expanded={filterOpen}
            aria-controls="pool-filter-popover"
            aria-haspopup="dialog"
            ref={filterTriggerRef}
          >
            <span className="filter-icon">≡</span>
            <span className="filter-label">필터</span>
            {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
          </button>

          {filterOpen && (
            <div
              className="filter-popover"
              id="pool-filter-popover"
              role="dialog"
              aria-modal="false"
              aria-labelledby="pool-filter-title"
              ref={filterPanelRef}
            >
              <div className="filter-popover-head">
                <div>
                  <span>QUICK FILTER</span>
                  <h3 id="pool-filter-title">주문방 필터</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFilterOpen(false);
                    window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
                  }}
                  aria-label="필터 닫기"
                >
                  ×
                </button>
              </div>

              <div className="filter-options">
                <label className="filter-option">
                  <span>
                    <strong>자리 있는 방</strong>
                    <small>정원이 찬 내 주문은 계속 보여요</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={filters.availableOnly}
                    onChange={(event) => setFilters((current) => ({
                      ...current,
                      availableOnly: event.target.checked,
                    }))}
                  />
                </label>

                <label className="filter-option">
                  <span>
                    <strong>현재 위치만</strong>
                    <small>{currentPickup} 픽업 주문만 모아보기</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={filters.currentPickupOnly}
                    onChange={(event) => setFilters((current) => ({
                      ...current,
                      currentPickupOnly: event.target.checked,
                    }))}
                  />
                </label>
              </div>

              <label className="filter-sort" htmlFor="pool-filter-sort">
                <span>정렬</span>
                <select
                  id="pool-filter-sort"
                  value={filters.sortBy}
                  onChange={(event) => setFilters((current) => ({
                    ...current,
                    sortBy: event.target.value as PoolSort,
                  }))}
                >
                  <option value="default">기본순</option>
                  <option value="deadline">마감 임박순</option>
                  <option value="remaining">주문까지 적은 금액순</option>
                </select>
              </label>

              <div className="filter-popover-foot">
                <span role="status" aria-live="polite">{filtered.length}개 주문방 표시 중</span>
                <button type="button" className="filter-reset" onClick={resetDetailFilters}>상세 필터 초기화</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="category-tabs" aria-label="음식 카테고리">
        {categories.map((item) => (
          <button
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
            aria-pressed={category === item}
            key={item}
          >
            {item}
          </button>
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
        {loading ? (
          <div className="rooms-loading" role="status">
            <span aria-hidden="true" />
            <strong>주문방을 확인하고 있어요</strong>
            <p>로그인 상태와 최신 모집 정보를 불러오는 중입니다.</p>
          </div>
        ) : loadError ? (
          <div className="empty-state load-error" role="alert">
            <span>!</span>
            <h3>주문방을 불러오지 못했어요</h3>
            <p>{loadError}</p>
            <button className="primary-button" type="button" onClick={onRetry}>다시 시도</button>
          </div>
        ) : filtered.length ? (
          <div className="pool-grid">
            {filtered.map((pool) => <PoolCard key={pool.id} pool={pool} now={now} onOpen={onOpenPool} />)}
          </div>
        ) : (
          <div className="empty-state">
            <span>⌕</span>
            <h3>조건에 맞는 주문방이 없어요</h3>
            <p>{hasAnyCriteria ? "검색어나 필터 조건을 바꿔 다시 확인해 보세요." : "새 주문방을 열면 기다리던 식구에게 알려드릴게요."}</p>
            <button className="primary-button" onClick={hasAnyCriteria ? resetAllFilters : onCreate}>
              {hasAnyCriteria ? "모든 조건 초기화" : "주문방 만들기"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function RestaurantsView({
  onCreate,
}: {
  onCreate: (restaurant?: Restaurant) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("전체");
  const filters = ["전체", "위치 확인 매장", "최소금액 낮은 순"];
  const visible = restaurants
    .filter((restaurant) =>
      `${restaurant.name} ${restaurant.cuisine} ${restaurant.address || ""} ${restaurant.menu.flatMap((group) => group.items).map((item) => item.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()))
    .filter((restaurant) => filter !== "위치 확인 매장" || restaurant.verified)
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
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="가게·메뉴·카테고리 검색"
            aria-label="가게와 메뉴 검색"
          />
        </label>
        <div className="category-tabs compact-tabs">
          {filters.map((item) => (
            <button
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <section className="restaurant-list">
        {visible.map((restaurant) => {
          const bestApp: DeliveryApp = restaurant.minimum.baemin <= restaurant.minimum.coupang ? "baemin" : "coupang";
          return (
            <article className="restaurant-card" key={restaurant.id}>
              <div className="restaurant-summary">
                <RestaurantMark restaurant={restaurant} large />
                <div className="restaurant-info">
                  <span className="cuisine-label">{restaurant.cuisine}{restaurant.verified && <em>위치 확인</em>}</span>
                  <h2>{restaurant.name}</h2>
                  <p>테크노폴리스 상권 · {restaurant.eta}</p>
                </div>
              </div>
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

function ProfileView({
  onCreate,
  currentPickup,
  user,
  rooms,
  now,
  onRoom,
  onAuth,
}: {
  onCreate: () => void;
  currentPickup: string;
  user: AuthUser | null;
  rooms: Pool[];
  now: number;
  onRoom: (roomId: string) => void;
  onAuth: () => void;
}) {
  const profileName = user ? maskDisplayName(user.displayName) : "게스트";

  return (
    <>
      <Header title={user ? `반가워요, ${profileName}님` : "로그인하고 식구를 만나보세요"} subtitle="PROFILE · 나의 식구 생활" onCreate={onCreate} />
      <section className="profile-hero">
        <div className="profile-avatar">{profileName.slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{profileName}</h2>
          <p>{user ? "안전하게 로그인됨" : "주문방 참여와 채팅에는 로그인이 필요해요"} · {currentPickup}</p>
          <span>이 기기의 현재 위치 <b>{currentPickup}</b></span>
        </div>
        <button className="profile-auth-button" type="button" onClick={onAuth}>
          {user ? "로그아웃" : "로그인"}
        </button>
      </section>

      <section className="my-room-section">
        <div className="section-heading">
          <div>
            <span>MY ORDER ROOMS</span>
            <h2>내 주문방</h2>
          </div>
          <small>마감 후 30일 동안 다시 열 수 있어요.</small>
        </div>
        {user && rooms.length ? (
          <div className="my-room-list">
            {rooms.map((room) => {
              const restaurant = restaurants.find((item) => item.id === room.restaurantId);
              if (!restaurant) return null;
              const isClosed = room.closesAt <= now;
              return (
                <button type="button" onClick={() => onRoom(room.id)} key={room.id}>
                  <RestaurantMark restaurant={restaurant} />
                  <span>
                    <strong>{restaurant.name}</strong>
                    <small>{room.pickupFull} · {room.people}/{room.capacity}명</small>
                  </span>
                  <em className={isClosed ? "closed" : ""}>{isClosed ? "마감됨" : timeLeft(room.closesAt, now)}</em>
                  <b aria-hidden="true">›</b>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="my-room-empty">
            <strong>{user ? "아직 참여한 주문방이 없어요." : "로그인하면 내 주문방을 다시 열 수 있어요."}</strong>
            <p>{user ? "주문방을 만들거나 참여하면 이곳에 안전하게 모아드려요." : "승인된 주문방의 채팅과 영수증은 구성원만 볼 수 있어요."}</p>
            <button type="button" onClick={user ? onCreate : onAuth}>{user ? "주문방 만들기" : "로그인"}</button>
          </div>
        )}
      </section>
    </>
  );
}

function RightRail({
  pools,
  now,
  onPool,
  currentPickup,
  user,
  onAuth,
  onMap,
}: {
  pools: Pool[];
  now: number;
  onPool: (pool: Pool) => void;
  currentPickup: string;
  user: AuthUser | null;
  onAuth: () => void;
  onMap: (pickupId: string) => void;
}) {
  const closest = pools.find((pool) => pool.pickup === currentPickup) || pools[0];
  const maskedUserName = user ? maskDisplayName(user.displayName) : "";
  const restaurant = closest
    ? restaurants.find((item) => item.id === closest.restaurantId)
    : undefined;
  return (
    <aside className="right-rail">
      <section className="rail-profile">
        <div className="avatar">{(maskedUserName || "?").slice(0, 1).toUpperCase()}</div>
        <div><strong>{maskedUserName || "로그인이 필요해요"}</strong><small>{user ? `${currentPickup} · 인증됨` : "주문방·채팅 이용하기"}</small></div>
        <button onClick={onAuth} aria-label={user ? "로그아웃" : "로그인"}>{user ? "↗" : "로그인"}</button>
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

      <CampusMapPreview pools={pools} currentPickup={currentPickup} onOpen={onMap} />
    </aside>
  );
}

function CampusMapModal({
  pools,
  now,
  initialPickup,
  onClose,
  onJoin,
}: {
  pools: Pool[];
  now: number;
  initialPickup: string;
  onClose: () => void;
  onJoin: (pool: Pool) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [selectedPickup, setSelectedPickup] = useState(
    pickupPoints.some((point) => point.id === initialPickup) ? initialPickup : pickupPoints[0].id,
  );
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const selectedPoint = pickupPoints.find((point) => point.id === selectedPickup) || pickupPoints[0];
  const selectedPools = pools.filter((pool) => pool.pickup === selectedPoint.id);
  const poolCounts = pools.reduce<Record<string, number>>((counts, pool) => {
    counts[pool.pickup] = (counts[pool.pickup] || 0) + 1;
    return counts;
  }, {});
  const unmappedCount = pools.filter(
    (pool) => !pickupPoints.some((point) => point.id === pool.pickup),
  ).length;

  useDialogLifecycle(dialogRef, onClose);

  const joinPool = async (pool: Pool) => {
    if (pool.myStatus === "requested") return;
    if (!pool.isHost && pool.myStatus !== "approved" && pool.people >= pool.capacity) return;
    setBusyRoomId(pool.id);
    try {
      await onJoin(pool);
    } finally {
      setBusyRoomId(null);
    }
  };

  return (
    <div
      className="overlay centered campus-map-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="campus-map-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="campus-map-title"
        aria-describedby="campus-map-description"
        ref={dialogRef}
      >
        <header className="campus-map-modal-head">
          <div>
            <span>LIVE CAMPUS · DGIST</span>
            <h2 id="campus-map-title">캠퍼스 주문 지도</h2>
            <p id="campus-map-description">픽업 지점을 선택하고 열려 있는 주문방에 바로 참여해 보세요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="캠퍼스 지도 닫기">×</button>
        </header>

        <div className="campus-map-modal-body">
          <div className="campus-map-canvas" aria-label="DGIST 픽업 지점 지도">
            <span className="campus-map-road road-main" aria-hidden="true" />
            <span className="campus-map-road road-branch" aria-hidden="true" />
            <span className="campus-map-zone zone-research" aria-hidden="true" />
            <span className="campus-map-zone zone-dorm" aria-hidden="true" />
            {pickupPoints.map((point) => {
              const count = poolCounts[point.id] || 0;
              return (
                <button
                  type="button"
                  className={`campus-map-marker ${selectedPoint.id === point.id ? "selected" : ""} ${count ? "active" : ""}`}
                  style={campusMapPosition(point)}
                  onClick={() => setSelectedPickup(point.id)}
                  aria-pressed={selectedPoint.id === point.id}
                  aria-label={`${point.full}, 활성 주문방 ${count}개`}
                  key={point.id}
                >
                  <span>{point.code ?? point.id}</span>
                  {count > 0 && <b>{count}</b>}
                </button>
              );
            })}
            <div className="campus-map-selected-label" aria-live="polite">
              <span>{selectedPoint.code ?? selectedPoint.id}</span>
              <div>
                <small>선택한 픽업 지점</small>
                <strong>{selectedPoint.full}</strong>
              </div>
            </div>
          </div>

          <aside className="campus-map-orders">
            <div className="campus-map-orders-head">
              <span>ORDER ROOMS</span>
              <h3>{selectedPoint.full}</h3>
              <p>열린 주문방 {selectedPools.length}개 · 도보 기준 {selectedPoint.walk}분</p>
            </div>

            {selectedPools.length ? (
              <div className="campus-map-order-list">
                {selectedPools.map((pool) => {
                  const restaurant = restaurants.find((item) => item.id === pool.restaurantId);
                  const isRoomMember = Boolean(pool.isHost || pool.myStatus === "approved");
                  const isPending = pool.myStatus === "requested";
                  const isFull = !isRoomMember && pool.people >= pool.capacity;
                  const isBusy = busyRoomId === pool.id;
                  const actionLabel = isBusy
                    ? "처리 중"
                    : pool.isHost
                      ? "주문방 관리"
                      : pool.myStatus === "approved"
                        ? "채팅방 열기"
                        : isPending
                          ? "방장 승인 대기 중"
                          : isFull
                            ? "정원 마감"
                            : "참여 신청";
                  const restaurantName = restaurant?.name || "공동주문";

                  return (
                    <article className="campus-map-order-card" key={pool.id}>
                      <div className="campus-map-order-summary">
                        {restaurant ? <RestaurantMark restaurant={restaurant} /> : <span className="map-order-fallback">식</span>}
                        <div>
                          <strong>{restaurantName}</strong>
                          <small>{timeLeft(pool.closesAt, now)} · {pool.people}/{pool.capacity}명</small>
                        </div>
                      </div>
                      <div className="campus-map-order-meta">
                        <span>{pool.apps.map((app) => appLabels[app].name).join(" · ")}</span>
                        <b>{money(Math.max(0, pool.target - pool.total))} 남음</b>
                      </div>
                      <button
                        type="button"
                        onClick={() => void joinPool(pool)}
                        disabled={busyRoomId !== null || isPending || isFull}
                        aria-label={`${restaurantName} ${actionLabel}`}
                      >
                        {actionLabel}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="campus-map-empty">
                <span>0</span>
                <strong>이 지점에 열린 주문방이 없어요</strong>
                <p>숫자가 표시된 다른 픽업 지점을 눌러보세요.</p>
              </div>
            )}

            {unmappedCount > 0 && (
              <p className="campus-map-unmapped">위치 확인이 필요한 주문방 {unmappedCount}개는 주문 목록에서 볼 수 있어요.</p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

const feedbackEmail = "gudwns5863@naver.com";

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogLifecycle(dialogRef, onClose);

  return (
    <div className="overlay centered feedback-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        aria-describedby="feedback-description"
        ref={dialogRef}
      >
        <header className="feedback-head">
          <div>
            <span>HELP SIKGU</span>
            <h2 id="feedback-title">도움말 · 제안 보내기</h2>
            <p id="feedback-description">SIKGU를 이용하며 발견한 문제를 알려주세요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="의견 보내기 닫기">×</button>
        </header>

        <div className="feedback-instruction">
          <span aria-hidden="true">!</span>
          <p>수정할 내용이나 버그가 있으면 아래 이메일로 버그 내용을 적어서 보내주세요.</p>
        </div>

        <div className="feedback-recipient">
          <span className="feedback-mail-mark" aria-hidden="true">@</span>
          <div>
            <small>문의 이메일</small>
            <strong>{feedbackEmail}</strong>
          </div>
        </div>
      </section>
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
  onToggleJoin: (pool: Pool) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle(dialogRef, onClose);
  const [joining, setJoining] = useState(false);
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = Math.max(0, pool.target - pool.total);
  const ready = gap === 0;
  const fee = Math.min(...pool.apps.map((app) => restaurant.deliveryFee[app]));
  const membershipApp = pool.membership === "baemin" || pool.membership === "coupang"
    ? pool.membership
    : null;
  const membershipApplied = membershipApp !== null && pool.apps.includes(membershipApp);
  const hasFreeDelivery = fee === 0 || membershipApplied;
  const eachFee = hasFreeDelivery ? 0 : Math.ceil(fee / Math.max(pool.people, 1));
  const appNames = pool.apps.map((app) => appLabels[app].name).join(" · ");
  const membershipName = membershipApp ? appLabels[membershipApp].membership : "";
  const isFull = !pool.isHost && pool.myStatus !== "approved" && pool.people >= pool.capacity;

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pool-modal" role="dialog" aria-modal="true" aria-label={`${restaurant.name} 공동주문`} ref={dialogRef}>
        <div className="modal-topbar">
          <button onClick={onClose} aria-label="공동주문 닫기">←</button>
          <span>{timeLeft(pool.closesAt, now)}</span>
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
            <strong>{appNames}{membershipApplied && ` · ${membershipName}`}</strong>
            <p>
              {membershipApplied
                ? `${membershipName} 적용 시 예상 배달비는 무료예요. 결제 전 배달앱에서 확인해 주세요.`
                : fee === 0
                  ? "선택한 앱의 예상 배달비는 무료예요."
                  : `배달비를 나누면 1인당 약 ${money(eachFee)}이에요.`}
            </p>
          </div>
        </div>

        <div className="host-note">
          <span>“</span><p>{pool.note}</p><small>— 방장 {maskDisplayName(pool.host)}</small>
        </div>

        <div className="modal-footer">
          <div>
            <span>예상 배달비</span>
            <strong>{hasFreeDelivery ? "무료" : money(eachFee)}{!hasFreeDelivery && <small> / 1인</small>}</strong>
          </div>
          <button
            className={pool.myStatus === "requested" ? "secondary-button" : "primary-button"}
            onClick={async () => {
              if (joining) return;
              setJoining(true);
              try {
                await onToggleJoin(pool);
              } finally {
                setJoining(false);
              }
            }}
            disabled={pool.myStatus === "requested" || joining || isFull}
          >
            {joining
              ? "처리 중…"
              : pool.isHost
              ? `참여자 관리${pool.pendingCount ? ` · ${pool.pendingCount}명 대기` : ""}`
              : pool.myStatus === "approved"
                ? "채팅방 열기"
                : pool.myStatus === "requested"
                  ? "방장 승인 대기 중"
                  : isFull
                    ? "정원 마감"
                    : ready
                      ? "참여 신청하기"
                      : "이 주문에 참여 신청"}
          </button>
        </div>
      </section>
    </div>
  );
}

function RoomHubModal({
  roomId,
  onClose,
  onChanged,
  onDeleted,
  onLeft,
}: {
  roomId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onLeft: () => void;
}) {
  const [room, setRoom] = useState<Pool | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editingOrderInfo, setEditingOrderInfo] = useState(false);
  const [estimatedArrival, setEstimatedArrival] = useState("");
  const [orderTotal, setOrderTotal] = useState("");
  const [collectedTotal, setCollectedTotal] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingOrderInfo, setSavingOrderInfo] = useState(false);
  const [orderInfoStatus, setOrderInfoStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reviewingMember, setReviewingMember] = useState("");
  const roomDialogRef = useRef<HTMLElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const loadRoomRequestRef = useRef(0);
  const restaurant = room
    ? restaurants.find((item) => item.id === room.restaurantId)
    : undefined;

  useDialogLifecycle(roomDialogRef, onClose);

  const loadRoom = useCallback(async (quiet = false) => {
    const requestId = ++loadRoomRequestRef.current;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/sikgu?action=room&roomId=${encodeURIComponent(roomId)}`, {
        cache: "no-store",
      });
      const data = await readJson<{
        room?: Pool;
        members?: RoomMember[];
        messages?: ChatMessage[];
      }>(response);
      if (requestId !== loadRoomRequestRef.current) return false;
      if (!response.ok || !data.room) {
        if (response.status === 401 || response.status === 403) {
          setRoom(null);
          setMembers([]);
          setMessages([]);
          setReceiptFile(null);
        }
        setError(data.error || "주문방을 불러오지 못했어요.");
        setLoading(false);
        return false;
      }
      setRoom(data.room);
      setMembers(data.members || []);
      setMessages(data.messages || []);
      setError("");
      setLoading(false);
      return true;
    } catch {
      if (requestId !== loadRoomRequestRef.current) return false;
      setError("네트워크 연결을 확인한 뒤 다시 시도해주세요.");
      setLoading(false);
      return false;
    }
  }, [roomId]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadRoom(), 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRoom(true);
    }, 10000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadRoom]);

  useEffect(() => {
    // Scroll the message list itself: scrollIntoView walks every scrolling
    // ancestor, which on phones dragged the whole room sheet (member list and
    // order form included) to the bottom on open and on each polled message.
    const list = chatListRef.current;
    if (!stickToBottomRef.current) return;
    if (list) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/sikgu", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sikgu-request": "1" },
      body: JSON.stringify({ ...payload, roomId }),
    });
    const data = await readJson<{ token?: string }>(response);
    if (response.status === 401) {
      redirectToSignIn();
      throw new Error("로그인이 필요합니다.");
    }
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어요.");
    return data;
  };

  const review = async (memberRef: string, decision: "approve" | "reject") => {
    if (reviewingMember) return;
    setReviewingMember(memberRef);
    setError("");
    try {
      await post({ action: "review_member", memberRef, decision });
      await loadRoom(true);
      onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "참여자 상태를 변경하지 못했어요.");
    } finally {
      setReviewingMember("");
    }
  };

  const removeMember = async (memberRef: string) => {
    if (reviewingMember) return;
    setReviewingMember(memberRef);
    setError("");
    try {
      await post({ action: "remove_member", memberRef });
      await loadRoom(true);
      onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "참여자를 내보내지 못했어요.");
    } finally {
      setReviewingMember("");
    }
  };

  const createInvite = async () => {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setError("");
    try {
      const data = await post({ action: "create_invite" });
      const link = `${window.location.origin}/?room=${encodeURIComponent(roomId)}&invite=${encodeURIComponent(data.token || "")}`;
      setInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setInviteStatus("초대 링크를 복사했어요.");
      } catch {
        setInviteStatus("초대 링크를 만들었어요. 아래 주소를 직접 복사해주세요.");
      }
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "초대 링크를 만들지 못했어요.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteStatus("초대 링크를 복사했어요.");
    } catch {
      setError("자동 복사가 차단됐어요. 링크를 길게 눌러 직접 복사해주세요.");
    }
  };

  const sendMessage = async () => {
    const body = message.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    setChatStatus("");
    stickToBottomRef.current = true;
    try {
      await post({ action: "send_message", body });
      setMessage((current) => (current.trim() === body ? "" : current));
      const refreshed = await loadRoom(true);
      if (!refreshed) setChatStatus("메시지는 전송됐어요. 새 메시지는 잠시 후 다시 확인해주세요.");
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "메시지를 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  };

  const openOrderEditor = () => {
    setEstimatedArrival(room?.estimatedArrival || "");
    setOrderTotal(room?.orderTotal == null ? "" : String(room.orderTotal));
    setCollectedTotal(room ? String(room.total) : "");
    setReceiptFile(null);
    setOrderInfoStatus("");
    setError("");
    setEditingOrderInfo(true);
  };

  const saveOrderInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingOrderInfo) return;
    if (receiptFile) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(receiptFile.type)) {
        setError("영수증은 JPG, PNG, WebP 이미지로 올려주세요.");
        return;
      }
      if (receiptFile.size > maxReceiptUploadBytes) {
        setError("영수증 이미지는 8MB 이하만 올릴 수 있어요.");
        return;
      }
    }

    setSavingOrderInfo(true);
    setError("");
    try {
      const preparedReceipt = receiptFile ? await prepareReceiptUpload(receiptFile) : null;
      const form = new FormData();
      form.set("action", "update_order_info");
      form.set("roomId", roomId);
      form.set("estimatedArrival", estimatedArrival);
      form.set("orderTotal", orderTotal);
      form.set("collectedTotal", collectedTotal);
      if (preparedReceipt) form.set("receipt", preparedReceipt);
      const response = await fetch(
        `/api/sikgu?action=update_order_info&roomId=${encodeURIComponent(roomId)}`,
        { method: "PUT", headers: { "x-sikgu-request": "1" }, body: form },
      );
      const data = await readJson<object>(response);
      if (!response.ok) throw new Error(data.error || "주문 정보를 저장하지 못했어요.");
      setEditingOrderInfo(false);
      setReceiptFile(null);
      setOrderInfoStatus("방장이 주문 정보를 업데이트했어요.");
      const refreshed = await loadRoom(true);
      if (!refreshed) setOrderInfoStatus("주문 정보는 저장됐어요. 화면은 잠시 후 새로고침됩니다.");
      onChanged();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "주문 정보를 저장하지 못했어요.");
    } finally {
      setSavingOrderInfo(false);
    }
  };

  const deleteRoom = async () => {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/sikgu?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
        headers: { "x-sikgu-request": "1" },
      });
      const data = await readJson<object>(response);
      if (response.status === 404) {
        onDeleted();
        return;
      }
      if (!response.ok) throw new Error(data.error || "주문방을 삭제하지 못했어요.");
      onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "주문방을 삭제하지 못했어요.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const leaveRoom = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await post({ action: "leave_room" });
      onLeft();
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "주문방에서 나가지 못했어요.");
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="room-hub" role="dialog" aria-modal="true" aria-label="비공개 주문방 채팅" ref={roomDialogRef}>
        <div className="room-hub-head">
          <div>
            <span>PRIVATE ORDER ROOM</span>
            <h2>{restaurant?.name || "주문방"}</h2>
            <p>{room ? `${room.pickupFull} · ${room.people}/${room.capacity}명` : "주문방 정보를 불러오는 중"}</p>
          </div>
          <div className="room-hub-head-actions">
            {room?.isHost && (
              <button className="delete-room-trigger" onClick={() => setConfirmDelete(true)}>방 삭제</button>
            )}
            {room && !room.isHost && (
              <button className="leave-room-trigger" onClick={() => setConfirmLeave(true)}>방 나가기</button>
            )}
            <button className="room-hub-close" onClick={onClose} aria-label="주문방 채팅 닫기">×</button>
          </div>
        </div>
        {room?.isHost && confirmDelete && (
          <div className="room-delete-confirm" role="alert">
            <div>
              <strong>이 주문방을 영구 삭제할까요?</strong>
              <p>참여자, 채팅, 초대 링크, 영수증 이미지가 모두 삭제되며 되돌릴 수 없어요.</p>
            </div>
            <span>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}>취소</button>
              <button onClick={deleteRoom} disabled={deleting}>{deleting ? "삭제 중…" : "영구 삭제"}</button>
            </span>
          </div>
        )}
        {room && !room.isHost && confirmLeave && (
          <div className="room-delete-confirm leave" role="alert">
            <div>
              <strong>이 주문방에서 나갈까요?</strong>
              <p>나가면 채팅과 영수증을 더 이상 볼 수 없어요.</p>
            </div>
            <span>
              <button onClick={() => setConfirmLeave(false)} disabled={leaving}>취소</button>
              <button onClick={leaveRoom} disabled={leaving}>{leaving ? "나가는 중…" : "방 나가기"}</button>
            </span>
          </div>
        )}

        {loading ? (
          <div className="room-hub-loading">주문방을 불러오고 있어요…</div>
        ) : error && !room ? (
          <div className="room-hub-error">
            <strong>주문방을 열 수 없어요</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void loadRoom()}>다시 시도</button>
          </div>
        ) : room ? (
          <div className="room-hub-body">
            <aside className="member-panel">
              <div className="member-panel-head">
                <div><strong>함께할 식구</strong><small>승인된 사람만 채팅 가능</small></div>
                {room.isHost && (
                  <button onClick={createInvite} disabled={creatingInvite}>
                    {creatingInvite ? "만드는 중…" : "초대 링크"}
                  </button>
                )}
              </div>
              {inviteLink && (
                <div className="invite-success">
                  <span>✓</span>
                  <div>
                    <strong>{inviteStatus || "초대 링크를 만들었어요."}</strong>
                    <small>24시간 동안 사용할 수 있어요.</small>
                    <label>
                      <span className="sr-only">초대 링크</span>
                      <input value={inviteLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <button type="button" onClick={copyInvite}>링크 복사</button>
                  </div>
                </div>
              )}
              <div className="member-list">
                {members.map((member) => {
                  const maskedMemberName = maskDisplayName(member.display_name);
                  return (
                    <div className={member.status === "requested" ? "pending" : ""} key={`${member.member_ref || member.display_name}-${member.created_at}`}>
                      <span className="avatar">{maskedMemberName.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{maskedMemberName}</strong><small>{member.role === "host" ? "방장" : member.status === "approved" ? "참여 확정" : "참여 신청"}</small></span>
                      {room.isHost && member.status === "requested" && member.member_ref ? (
                        <span className="member-actions">
                          <button
                            onClick={() => review(member.member_ref!, "approve")}
                            disabled={Boolean(reviewingMember)}
                          >
                            {reviewingMember === member.member_ref ? "처리 중" : "승인"}
                          </button>
                          <button
                            onClick={() => review(member.member_ref!, "reject")}
                            disabled={Boolean(reviewingMember)}
                          >
                            거절
                          </button>
                        </span>
                      ) : room.isHost && member.role === "member" && member.member_ref ? (
                        <span className="member-actions">
                          <button
                            className="remove"
                            onClick={() => void removeMember(member.member_ref!)}
                            disabled={Boolean(reviewingMember)}
                          >
                            {reviewingMember === member.member_ref ? "처리 중" : "내보내기"}
                          </button>
                        </span>
                      ) : (
                        <b>{member.status === "approved" ? "✓" : ""}</b>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>

            <section className="chat-panel">
              <section className="order-info-card" aria-label="배달 주문 정보">
                <div className="order-info-head">
                  <div>
                    <span>ORDER UPDATE</span>
                    <strong>배달 주문 정보</strong>
                    <small>승인된 식구만 볼 수 있어요.</small>
                  </div>
                  {room.isHost && (
                    <button onClick={editingOrderInfo ? () => setEditingOrderInfo(false) : openOrderEditor}>
                      {editingOrderInfo ? "닫기" : room.estimatedArrival || room.orderTotal || room.receiptUrl ? "수정" : "정보 등록"}
                    </button>
                  )}
                </div>

                <div className="order-info-summary">
                  <div>
                    <span className="order-info-icon" aria-hidden="true">Σ</span>
                    <p><small>현재 모인 주문금액</small><strong>{money(room.total)}</strong></p>
                  </div>
                  <div>
                    <span className="order-info-icon" aria-hidden="true">◷</span>
                    <p><small>도착 예상</small><strong>{estimatedArrivalLabel(room.estimatedArrival)}</strong></p>
                  </div>
                  <div>
                    <span className="order-info-icon" aria-hidden="true">₩</span>
                    <p><small>최종 결제 금액</small><strong>{room.orderTotal == null ? "미정" : money(room.orderTotal)}</strong></p>
                  </div>
                  {room.receiptUrl ? (
                    <a
                      className="receipt-thumb"
                      href={room.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="영수증 원본 이미지 열기"
                    >
                      {/* Protected room images must load directly so the member's auth cookie reaches the API. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={room.receiptUrl} alt="방장이 올린 영수증 또는 주문 화면 캡처" />
                      <span>원본 보기 ↗</span>
                    </a>
                  ) : (
                    <div className="receipt-empty">
                      <span aria-hidden="true">▧</span>
                      <p><strong>영수증 없음</strong><small>방장이 올리면 여기에 표시돼요.</small></p>
                    </div>
                  )}
                </div>

                {orderInfoStatus && <p className="order-info-status" role="status">✓ {orderInfoStatus}</p>}

                {room.isHost && editingOrderInfo && (
                  <form className="order-info-form" onSubmit={saveOrderInfo}>
                    <div className="order-info-fields">
                      <label>
                        <span>현재 모인 주문금액</span>
                        <span className="price-input">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="10000000"
                            step="1"
                            value={collectedTotal}
                            onChange={(event) => setCollectedTotal(event.target.value)}
                            placeholder="예: 15000"
                          />
                          <b>원</b>
                        </span>
                      </label>
                      <label>
                        <span>도착 예상 시각</span>
                        <input
                          type="datetime-local"
                          value={estimatedArrival}
                          onChange={(event) => setEstimatedArrival(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>최종 결제 금액</span>
                        <span className="price-input">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="10000000"
                            step="1"
                            value={orderTotal}
                            onChange={(event) => setOrderTotal(event.target.value)}
                            placeholder="예: 28500"
                          />
                          <b>원</b>
                        </span>
                      </label>
                    </div>
                    <label className="receipt-upload">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                      />
                      <span aria-hidden="true">＋</span>
                      <p>
                        <strong>{receiptFile ? receiptFile.name : room.receiptUrl ? "새 이미지로 교체" : "영수증·주문 화면 올리기"}</strong>
                        <small>JPG, PNG, WebP · 최대 8MB · 자동 최적화</small>
                      </p>
                    </label>
                    <p className="receipt-privacy">주소·전화번호·주문번호 등 개인정보는 가린 뒤 올려주세요.</p>
                    <button className="primary-button order-info-save" type="submit" disabled={savingOrderInfo}>
                      {savingOrderInfo ? "저장 중…" : "주문 정보 저장"}
                    </button>
                  </form>
                )}
              </section>

              <div className="chat-head">
                <div><span className="lock-mark">⌁</span><strong>주문방 채팅</strong></div>
                <small>초대·승인된 구성원 전용</small>
              </div>
              <div
                className="chat-messages"
                aria-live="polite"
                ref={chatListRef}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
                }}
              >
                {!messages.length && (
                  <div className="chat-empty">
                    <span>식</span>
                    <strong>첫 메시지를 남겨보세요</strong>
                    <p>메뉴와 픽업 시간을 안전하게 조율할 수 있어요.</p>
                  </div>
                )}
                {messages.map((item) => (
                  <article className={item.mine ? "mine" : ""} key={item.id}>
                    {!item.mine && <small>{maskDisplayName(item.sender_name)}</small>}
                    <div><p>{item.body}</p><time>{new Date(item.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time></div>
                  </article>
                ))}
                <div className="chat-scroll-anchor" ref={messagesEndRef} />
              </div>
              {chatStatus && <p className="chat-status" role="status">{chatStatus}</p>}
              <div className="chat-composer">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter"
                      && !event.shiftKey
                      && !event.nativeEvent.isComposing
                      && event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  aria-label="채팅 메시지"
                  placeholder="메시지를 입력하세요"
                  maxLength={1000}
                  rows={1}
                />
                <button onClick={sendMessage} disabled={sending || !message.trim()} aria-label="메시지 보내기">↑</button>
              </div>
            </section>
          </div>
        ) : null}
        {error && room && <div className="room-hub-inline-error" role="status">{error}</div>}
      </section>
    </div>
  );
}

function CreateModal({
  preferredRestaurant,
  preferredPickup,
  onClose,
  onCreate,
}: {
  preferredRestaurant?: Restaurant;
  preferredPickup: string;
  onClose: () => void;
  onCreate: (values: {
    restaurantId: string;
    pickup: string;
    apps: DeliveryApp[];
    minutes: number;
    capacity: number;
    membership: MembershipApp;
  }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle(dialogRef, onClose);
  const [restaurantId, setRestaurantId] = useState(preferredRestaurant?.id || restaurants[0].id);
  const [pickup, setPickup] = useState(
    pickupPoints.some((point) => point.id === preferredPickup) ? preferredPickup : "E3",
  );
  const [apps, setApps] = useState<DeliveryApp[]>([]);
  const [minutes, setMinutes] = useState(30);
  const [capacity, setCapacity] = useState(4);
  const [membership, setMembership] = useState<MembershipApp>("");
  const [creating, setCreating] = useState(false);
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
    const removing = apps.includes(app);
    setApps((current) => removing
      ? current.filter((item) => item !== app)
      : [...current, app]);
    if (removing && membership === app) setMembership("");
  };
  const submit = async () => {
    if (!apps.length || creating) return;
    setCreating(true);
    try {
      await onCreate({ restaurantId, pickup, apps, minutes, capacity, membership });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="create-modal" role="dialog" aria-modal="true" aria-label="새 주문방 만들기" ref={dialogRef}>
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
          <div className="restaurant-picker-list" aria-label="현풍 테크노폴리스 가게 목록">
            {visibleRestaurants.map((item) => (
              <button
                className={restaurantId === item.id ? "active" : ""}
                onClick={() => setRestaurantId(item.id)}
                aria-pressed={restaurantId === item.id}
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
                <span>{point.code ?? point.id}</span><small>{point.full}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-two-col">
          <div className="form-field">
            <label>모집 시간</label>
            <div className="segmented">
              {roomDurations.map((value) => <button className={minutes === value ? "active" : ""} onClick={() => setMinutes(value)} key={value}>{value}분</button>)}
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

        <div className="form-field">
          <label>무료배달 멤버십 <small>선택 사항</small></label>
          <div className="membership-picker" role="group" aria-label="무료배달 멤버십 선택">
            {apps.map((app) => (
              <button
                type="button"
                className={`membership-toggle ${membership === app ? "active" : ""}`}
                onClick={() => setMembership((current) => current === app ? "" : app)}
                aria-pressed={membership === app}
                key={app}
              >
                <span className="membership-toggle-check" aria-hidden="true">
                  {membership === app ? "✓" : ""}
                </span>
                <span className="membership-toggle-copy">
                  <strong>{appLabels[app].membership}</strong>
                  <small>{appLabels[app].name} 무료배달 혜택 적용</small>
                </span>
                <em>{membership === app ? "무료 적용" : "선택"}</em>
              </button>
            ))}
          </div>
          <small className="multi-select-help">보유한 멤버십을 선택하면 예상 배달비를 무료로 표시해요.</small>
        </div>

        <div className="form-field">
          <label>모집 인원 <small>방장 포함 최대 인원</small></label>
          <div className="segmented capacity-selector" role="group" aria-label="주문방 최대 인원">
            {roomCapacities.map((value) => (
              <button
                className={capacity === value ? "active" : ""}
                onClick={() => setCapacity(value)}
                aria-pressed={capacity === value}
                key={value}
              >
                {value}명
              </button>
            ))}
          </div>
        </div>

        <button
          className="primary-button create-submit"
          disabled={!apps.length || creating}
          onClick={() => void submit()}
        >
          {creating ? "주문방 만드는 중…" : apps.length ? "식구 찾기 시작" : "주문 앱을 선택해 주세요"}
        </button>
      </section>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [pools, setPools] = useState<Pool[]>(initialPools);
  const [myRooms, setMyRooms] = useState<Pool[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapState, setBootstrapState] = useState<"loading" | "ready" | "error">("loading");
  const [bootstrapError, setBootstrapError] = useState("");
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [roomHubId, setRoomHubId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Restaurant | undefined>();
  const [showCreate, setShowCreate] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showCampusMap, setShowCampusMap] = useState(false);
  const [campusMapPickup, setCampusMapPickup] = useState("E3");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("전체");
  const [filters, setFilters] = useState<PoolFilters>(defaultPoolFilters);
  const [currentPickup, setCurrentPickup] = useState("E3");
  const [locationReady, setLocationReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadRoomsRequestRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const latestSelectedPool = selectedPool
    ? pools.find((pool) => pool.id === selectedPool.id) || null
    : null;

  const notify = useCallback((
    message: string,
    tone: "success" | "error" | "info" = "info",
  ) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const signIn = useCallback(() => {
    redirectToSignIn();
  }, []);

  const postAction = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/sikgu", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sikgu-request": "1" },
      body: JSON.stringify(payload),
    });
    const data = await readJson<{ signInPath?: string; roomId?: string }>(response);
    if (response.status === 401) {
      signIn();
      throw new Error("로그인이 필요합니다.");
    }
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어요.");
    return data;
  }, [signIn]);

  const loadRooms = useCallback(async () => {
    const requestId = ++loadRoomsRequestRef.current;
    const response = await fetch("/api/sikgu?action=bootstrap", { cache: "no-store" });
    const data = await readJson<{
      user: AuthUser | null;
      rooms: Pool[];
      myRooms?: Pool[];
    }>(response);
    if (!response.ok) throw new Error(data.error || "주문방을 불러오지 못했어요.");
    if (requestId === loadRoomsRequestRef.current) {
      const isValidRoom = (room: Pool) => (
        restaurants.some((restaurant) => restaurant.id === room.restaurantId)
        && pickupPoints.some((point) => point.id === room.pickup)
        && room.apps.length > 0
      );
      setUser(data.user);
      setPools((data.rooms || []).filter(isValidRoom));
      setMyRooms((data.myRooms || []).filter(isValidRoom));
      setBootstrapError("");
      setBootstrapState("ready");
    }
    return data;
  }, []);

  // Background refreshes after room actions: a failed bootstrap must not
  // surface as an unhandled rejection; the next poll retries anyway.
  const refreshRooms = useCallback(() => loadRooms().catch(() => undefined), [loadRooms]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      let data: Awaited<ReturnType<typeof loadRooms>>;
      try {
        data = await loadRooms();
      } catch (loadError) {
        if (!active) return;
        setBootstrapState("error");
        setBootstrapError(loadError instanceof Error ? loadError.message : "네트워크 연결을 확인해주세요.");
        return;
      }
      if (!active) return;

      try {
        const acceptInvite = async (roomId: string, token: string) => {
          await postAction({ action: "accept_invite", roomId, token });
          setRoomHubId(roomId);
          notify("주문방 초대를 수락했어요.", "success");
          await loadRooms().catch(() => undefined);
        };
        const params = new URLSearchParams(window.location.search);
        const invite = params.get("invite");
        const invitedRoomId = params.get("room");
        if (invite && invitedRoomId) {
          // The invite token is a bearer credential: take it out of the
          // address bar (history, screenshots, the sign-in return_to) first.
          window.history.replaceState({}, "", window.location.pathname);
          if (!data.user) {
            try {
              window.sessionStorage.setItem(pendingInviteStorageKey, JSON.stringify({
                roomId: invitedRoomId,
                token: invite,
                createdAt: Date.now(),
              }));
            } catch {
              // Without storage the user signs in and can open the link again.
            }
            signIn();
            return;
          }
          await acceptInvite(invitedRoomId, invite);
          return;
        }

        let pendingInviteRaw: string | null = null;
        try {
          pendingInviteRaw = window.sessionStorage.getItem(pendingInviteStorageKey);
          if (pendingInviteRaw) window.sessionStorage.removeItem(pendingInviteStorageKey);
        } catch {
          // Storage unavailable: nothing to resume.
        }
        if (pendingInviteRaw && data.user) {
          const pendingInvite = JSON.parse(pendingInviteRaw) as { roomId?: string; token?: string; createdAt?: number };
          const isFresh = typeof pendingInvite.createdAt === "number"
            && Date.now() - pendingInvite.createdAt < 10 * 60 * 1000;
          if (isFresh && typeof pendingInvite.roomId === "string" && typeof pendingInvite.token === "string") {
            await acceptInvite(pendingInvite.roomId, pendingInvite.token);
            return;
          }
        }

        let pendingJoinRaw: string | null = null;
        try {
          pendingJoinRaw = window.sessionStorage.getItem(pendingJoinStorageKey);
        } catch {
          // Storage can be unavailable (private mode, blocked site data); a join
          // that could not be remembered is simply not resumed.
        }
        let pendingJoinRoomId = "";
        if (pendingJoinRaw && data.user) {
          try {
            const pendingJoin = JSON.parse(pendingJoinRaw) as { roomId?: string; createdAt?: number };
            const isFresh = typeof pendingJoin.createdAt === "number"
              && Date.now() - pendingJoin.createdAt < 10 * 60 * 1000;
            if (isFresh && typeof pendingJoin.roomId === "string") pendingJoinRoomId = pendingJoin.roomId;
            else window.sessionStorage.removeItem(pendingJoinStorageKey);
          } catch {
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            pendingJoinRoomId = "";
          }
        }
        if (pendingJoinRoomId && data.user) {
          const pendingPool = data.rooms.find((pool) => pool.id === pendingJoinRoomId);
          if (!pendingPool) {
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            notify("참여하려던 주문방이 마감되었거나 삭제됐어요.", "error");
            return;
          }
          if (pendingPool.isHost || pendingPool.myStatus === "approved") {
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            setRoomHubId(pendingPool.id);
            return;
          }
          if (pendingPool.myStatus === "requested") {
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            notify("이미 참여 승인을 기다리고 있어요.", "info");
            return;
          }

          try {
            await postAction({ action: "request_join", roomId: pendingPool.id });
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            setPools((currentPools) => currentPools.map((pool) => (
              pool.id === pendingPool.id ? { ...pool, myStatus: "requested" } : pool
            )));
            try {
              await loadRooms();
              notify("로그인 후 참여 신청을 이어서 보냈어요. 방장이 승인하면 채팅방이 열립니다.", "success");
            } catch {
              notify("참여 신청은 접수됐어요. 주문방 상태는 잠시 후 자동으로 갱신됩니다.", "info");
            }
          } catch (joinError) {
            // A definitive answer (room full, closed, gone) must not be retried on every load.
            window.sessionStorage.removeItem(pendingJoinStorageKey);
            notify(joinError instanceof Error ? joinError.message : "참여 신청을 보내지 못했어요.", "error");
          }
        }
      } catch (interactionError) {
        if (active) {
          notify(
            interactionError instanceof Error ? interactionError.message : "요청을 처리하지 못했어요.",
            "error",
          );
        }
      }
    };
    void initialize();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRooms().catch(() => undefined);
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadRooms, notify, postAction, signIn]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let savedPickup: string | null = null;
      try {
        savedPickup = window.localStorage.getItem(currentPickupStorageKey);
      } catch {
        // Fall back to the default pickup point when storage is unavailable.
      }
      if (savedPickup && pickupPoints.some((point) => point.id === savedPickup)) {
        setCurrentPickup(savedPickup);
      }
      setLocationReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (locationReady) {
      try {
        window.localStorage.setItem(currentPickupStorageKey, currentPickup);
      } catch {
        // A quota or security error must not unmount the app.
      }
    }
  }, [currentPickup, locationReady]);

  const viewCopy = useMemo(() => {
    if (view === "restaurants") return "가게 · 메뉴";
    if (view === "profile") return "내 정보";
    return "주문 모아보기";
  }, [view]);

  const openCreate = (restaurant?: Restaurant) => {
    if (bootstrapState === "loading") {
      notify("로그인 상태를 확인하고 있어요. 잠시만 기다려주세요.", "info");
      return;
    }
    if (bootstrapState === "error") {
      notify("먼저 주문방 정보를 다시 불러와주세요.", "error");
      return;
    }
    if (!user) {
      signIn();
      return;
    }
    setCreateFor(restaurant);
    setShowCreate(true);
  };

  const handleToggleJoin = async (pool: Pool) => {
    if (!user) {
      try {
        window.sessionStorage.setItem(pendingJoinStorageKey, JSON.stringify({
          roomId: pool.id,
          createdAt: Date.now(),
        }));
      } catch {
        // Sign-in must still proceed; the join is just not resumed afterwards.
      }
      signIn();
      return;
    }
    if (pool.isHost || pool.myStatus === "approved") {
      setSelectedPool(null);
      setRoomHubId(pool.id);
      return;
    }
    if (pool.myStatus === "requested") return;
    try {
      await postAction({ action: "request_join", roomId: pool.id });
    } catch (joinError) {
      notify(joinError instanceof Error ? joinError.message : "참여 신청을 보내지 못했어요.", "error");
      return;
    }

    setSelectedPool(null);
    setPools((currentPools) => currentPools.map((currentPool) => (
      currentPool.id === pool.id ? { ...currentPool, myStatus: "requested" } : currentPool
    )));
    try {
      await loadRooms();
      notify("참여 신청을 보냈어요. 방장이 승인하면 채팅방이 열립니다.", "success");
    } catch {
      notify("참여 신청은 접수됐어요. 주문방 상태는 잠시 후 자동으로 갱신됩니다.", "info");
    }
  };

  const handleCreate = async (values: {
    restaurantId: string;
    pickup: string;
    apps: DeliveryApp[];
    minutes: number;
    capacity: number;
    membership: MembershipApp;
  }) => {
    const point = pickupPoints.find((item) => item.id === values.pickup)
      || pickupPoints.find((item) => item.id === "E3")
      || pickupPoints[0];
    let result: { roomId?: string };
    try {
      result = await postAction({
        action: "create_room",
        restaurantId: values.restaurantId,
        pickup: point.id,
        apps: values.apps,
        closesAt: Date.now() + values.minutes * 60 * 1000,
        capacity: values.capacity,
        membership: values.membership,
        note: "같이 맛있게 먹어요!",
      });
    } catch (createError) {
      notify(createError instanceof Error ? createError.message : "주문방을 만들지 못했어요.", "error");
      return;
    }

    setShowCreate(false);
    setView("home");
    if (result.roomId) setRoomHubId(result.roomId);
    try {
      await loadRooms();
      notify("새 주문방을 열었어요. 참여자를 선택하고 초대할 수 있어요.", "success");
    } catch {
      notify("주문방은 만들어졌어요. 목록은 잠시 후 자동으로 갱신됩니다.", "info");
    }
  };

  const retryBootstrap = () => {
    setBootstrapState("loading");
    setBootstrapError("");
    void loadRooms().catch((error) => {
      setBootstrapState("error");
      setBootstrapError(error instanceof Error ? error.message : "네트워크 연결을 확인해주세요.");
    });
  };

  const selectCurrentPickup = (point: PickupPoint) => {
    setCurrentPickup(point.id);
    notify(`현재 위치를 ${point.full}(으)로 설정했어요.`, "success");
  };

  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeFeedback = useCallback(() => setShowFeedback(false), []);
  const closeCampusMap = useCallback(() => setShowCampusMap(false), []);
  const openCampusMap = useCallback((pickupId: string) => {
    setCampusMapPickup(pickupId);
    setShowCampusMap(true);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <LocationPicker currentPickup={currentPickup} onSelect={selectCurrentPickup} />
        <nav className="side-nav" aria-label="주 메뉴">
          <span className="nav-label">MENU</span>
          {navItems.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              key={item.id}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <button className="help-link" onClick={() => setShowFeedback(true)}><span>?</span> 도움말 · 제안 보내기</button>
      </aside>

      <main className="main-content">
        <div className="mobile-top">
          <Brand />
          <div className="mobile-top-actions">
            <LocationPicker currentPickup={currentPickup} onSelect={selectCurrentPickup} compact />
            <button className="mobile-help-button" onClick={() => setShowFeedback(true)} aria-label="도움말 및 제안 보내기">?</button>
            <button className="mobile-create-button" onClick={() => openCreate()} aria-label="주문방 만들기">＋</button>
          </div>
        </div>
        {view === "home" && (
          <HomeView
            pools={pools}
            now={now}
            search={search}
            setSearch={setSearch}
            category={category}
            setCategory={setCategory}
            currentPickup={currentPickup}
            filters={filters}
            setFilters={setFilters}
            loading={bootstrapState === "loading"}
            loadError={bootstrapState === "error" ? bootstrapError : ""}
            onRetry={retryBootstrap}
            onOpenPool={setSelectedPool}
            onMap={openCampusMap}
            onCreate={() => openCreate()}
            onRestaurants={() => navigate("restaurants")}
          />
        )}
        {view === "restaurants" && <RestaurantsView onCreate={openCreate} />}
        {view === "profile" && (
          <ProfileView
            currentPickup={currentPickup}
            user={user}
            rooms={myRooms}
            now={now}
            onRoom={setRoomHubId}
            onCreate={() => openCreate()}
            onAuth={() => window.location.assign(user ? "/signout-with-chatgpt?return_to=/" : "/signin-with-chatgpt?return_to=/")}
          />
        )}
      </main>

      <RightRail
        pools={pools}
        now={now}
        currentPickup={currentPickup}
        user={user}
        onPool={setSelectedPool}
        onAuth={() => window.location.assign(user ? "/signout-with-chatgpt?return_to=/" : "/signin-with-chatgpt?return_to=/")}
        onMap={openCampusMap}
      />

      <nav className="mobile-nav" aria-label="모바일 주 메뉴">
        {navItems.map((item) => (
          <button
            className={view === item.id ? "active" : ""}
            onClick={() => navigate(item.id)}
            aria-current={view === item.id ? "page" : undefined}
            key={item.id}
          >
            <span>{item.icon}</span><small>{item.compact}</small>
          </button>
        ))}
      </nav>

      {latestSelectedPool && <PoolModal pool={latestSelectedPool} now={now} onClose={() => setSelectedPool(null)} onToggleJoin={handleToggleJoin} />}
      {showCampusMap && (
        <CampusMapModal
          pools={pools}
          now={now}
          initialPickup={campusMapPickup}
          onClose={closeCampusMap}
          onJoin={async (pool) => {
            if (pool.isHost || pool.myStatus === "approved") closeCampusMap();
            await handleToggleJoin(pool);
          }}
        />
      )}
      {showCreate && (
        <CreateModal
          preferredRestaurant={createFor}
          preferredPickup={currentPickup}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
      {roomHubId && (
        <RoomHubModal
          roomId={roomHubId}
          onClose={() => setRoomHubId(null)}
          onChanged={() => void refreshRooms()}
          onDeleted={() => {
            setRoomHubId(null);
            void refreshRooms();
            notify("주문방과 관련 기록을 모두 삭제했어요.", "success");
          }}
          onLeft={() => {
            setRoomHubId(null);
            void refreshRooms();
            notify("주문방에서 나왔어요.", "success");
          }}
        />
      )}
      {showFeedback && <FeedbackModal onClose={closeFeedback} />}

      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          <span>{toast.tone === "success" ? "✓" : toast.tone === "error" ? "!" : "i"}</span>
          {toast.message}
        </div>
      )}
      <div className="sr-only" aria-live="polite">현재 화면: {viewCopy}</div>
    </div>
  );
}
