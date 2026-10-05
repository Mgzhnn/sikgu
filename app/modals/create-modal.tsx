"use client";

import { useMemo, useRef, useState } from "react";
import type { DeliveryApp, MembershipApp, Restaurant } from "../types";
import { restaurants, appLabels, pickupPoints } from "../catalog";
import { money, kakaoMapSearchUrl, useDialogLifecycle } from "../room-ui";
import { maxRoomNoteCharacters, roomCapacities, roomDurations } from "../sikgu-rules.mjs";
import { RestaurantMark } from "../restaurant-mark";

export type CreateRoomValues = {
  restaurantId: string;
  pickup: string;
  apps: DeliveryApp[];
  minutes: number;
  capacity: number;
  membership: MembershipApp;
  note: string;
};

export function CreateModal({
  preferredRestaurant,
  preferredPickup,
  onClose,
  onCreate,
}: {
  preferredRestaurant?: Restaurant;
  preferredPickup: string;
  onClose: () => void;
  onCreate: (values: CreateRoomValues) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle(dialogRef, onClose);
  const [note, setNote] = useState("");
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
      await onCreate({ restaurantId, pickup, apps, minutes, capacity, membership, note });
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
          <div className="restaurant-picker-categories" role="group" aria-label="가게 카테고리">
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
          <div className="restaurant-picker-list" role="group" aria-label="현풍 테크노폴리스 가게 목록">
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
          <label id="create-pickup-label">픽업 장소</label>
          <div className="choice-grid" role="group" aria-labelledby="create-pickup-label">
            {pickupPoints.map((point) => (
              <button
                className={pickup === point.id ? "active" : ""}
                onClick={() => setPickup(point.id)}
                aria-pressed={pickup === point.id}
                key={point.id}
              >
                <span>{point.code ?? point.id}</span><small>{point.full}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="form-two-col">
          <div className="form-field">
            <label id="create-duration-label">모집 시간</label>
            <div className="segmented" role="group" aria-labelledby="create-duration-label">
              {roomDurations.map((value) => (
                <button
                  className={minutes === value ? "active" : ""}
                  onClick={() => setMinutes(value)}
                  aria-pressed={minutes === value}
                  key={value}
                >
                  {value}분
                </button>
              ))}
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

        <div className="form-field">
          <label htmlFor="create-note">한마디 <small>선택 · 메뉴, 모이는 시간 등</small></label>
          <textarea
            id="create-note"
            className="create-note"
            value={note}
            maxLength={maxRoomNoteCharacters}
            rows={2}
            placeholder="예: 치즈떡볶이 시킬 건데 튀김 추가할 분?"
            onChange={(event) => setNote(event.target.value)}
          />
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
