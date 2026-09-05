"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { capturePendingInvite, clearPendingInvite } from "./invite-continuation.mjs";
import { getAppEstimates } from "./order-estimates.mjs";
import { maskDisplayName } from "./name-mask.mjs";
import {
  roomCapacities,
  roomDurations,
} from "./sikgu-rules.mjs";

import type {View, DeliveryApp, MembershipApp, PoolFilters, PoolSort, Pool, AuthUser, Restaurant} from "./types";
import {restaurants, appLabels, pickupPoints, campusMapPosition, currentPickupStorageKey, pendingJoinStorageKey, initialPools, defaultPoolFilters, navItems, type PickupPoint} from "./catalog";
import {money, kakaoMapSearchUrl, redirectToSignIn, readJson, prefersReducedMotion, browserPoll, useDialogLifecycle, timeLeft} from "./room-ui";
import {RestaurantMark} from "./restaurant-mark";
import {RoomHubModal} from "./room-hub";

function Brand() {
  return (
    <div className="brand">
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

function Progress({ current, target }: { current: number; target: number }) {
  const percentage = Math.min(100, Math.round((current / target) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-label="최소 주문금액 달성률">
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

      <div className="category-tabs" role="group" aria-label="음식 카테고리">
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
          <div className="campus-map-canvas" role="group" aria-label="DGIST 픽업 지점 지도">
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
  unavailable = false,
  onClose,
  onToggleJoin,
}: {
  pool: Pool;
  now: number;
  /** The room left the live feed (deadline passed or host deleted it) while the dialog was open. */
  unavailable?: boolean;
  onClose: () => void;
  onToggleJoin: (pool: Pool) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle(dialogRef, onClose);
  const [joining, setJoining] = useState(false);
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = Math.max(0, pool.target - pool.total);
  const ready = gap === 0;
  const estimates = getAppEstimates(pool, restaurant);
  const isFull = !pool.isHost && pool.myStatus !== "approved" && pool.people >= pool.capacity;

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pool-modal" role="dialog" aria-modal="true" aria-label={`${restaurant.name} 공동주문`} ref={dialogRef}>
        <div className="modal-topbar">
          <button onClick={onClose} aria-label="공동주문 닫기">←</button>
          <span>{unavailable ? "마감" : timeLeft(pool.closesAt, now)}</span>
        </div>
        {unavailable && (
          <p className="pool-unavailable" role="status">
            마감되었거나 삭제된 주문방이에요. 다른 주문방을 찾아보세요.
          </p>
        )}
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

        <div className="app-estimates" aria-label="앱별 주문 조건">
          {estimates.map((estimate) => (
            <div key={estimate.app} className="app-estimate">
              <strong>{appLabels[estimate.app].name}</strong>
              <span>{estimate.ready ? "최소 주문금액 달성" : `${money(estimate.remaining)} 더 필요해요`}</span>
              <small>최소 {money(estimate.minimum)} · 예상 배달비 {estimate.fee === 0 ? "무료" : `${money(estimate.eachFee)} / 1인`}
                {estimate.membershipApplied ? ` (${appLabels[estimate.app].membership} 적용 시)` : ""}</small>
            </div>
          ))}
          <p>앱별 조건을 확인한 뒤 주문해 주세요. 실제 금액과 멤버십 혜택은 결제 전 배달앱에서 확인해 주세요.</p>
        </div>

        <div className="host-note">
          <span>“</span><p>{pool.note}</p><small>— 방장 {maskDisplayName(pool.host)}</small>
        </div>

        <div className="modal-footer">
          <div>
            <span>예상 배달비</span>
            <strong>{estimates.length > 1 ? "앱별 조건 확인" : estimates[0]?.fee === 0 ? "무료" : `${money(estimates[0]?.eachFee || 0)} / 1인`}</strong>
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
            disabled={pool.myStatus === "requested" || joining || isFull || unavailable}
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

function InviteConfirmation({name,roomName,onAccept,onClose,busy}: {name:string;roomName:string;onAccept:()=>void;onClose:()=>void;busy:boolean}) {
  const ref=useRef<HTMLElement | null>(null);
  useDialogLifecycle(ref,onClose);
  return <div className="overlay centered"><section className="pool-modal" role="dialog" aria-modal="true" aria-label="주문방 초대 확인" ref={ref}>
    <h2>주문방 초대 확인</h2><p>{roomName}</p><p>{name} 계정으로 참여할까요?</p>
    <p>공용 기기라면 로그인한 계정을 먼저 확인해 주세요.</p>
    <button className="primary-button" disabled={busy} onClick={onAccept}>{busy ? "참여 중…" : "초대 수락"}</button>
    <button className="secondary-button" disabled={busy} onClick={onClose}>취소</button>
  </section></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [pendingInvite, setPendingInvite] = useState<ReturnType<typeof capturePendingInvite>>(null);
  const incomingInviteRef = useRef<ReturnType<typeof capturePendingInvite>>(null);
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [pools, setPools] = useState<Pool[]>(initialPools);
  const [myRooms, setMyRooms] = useState<Pool[]>([]);
  const [nextRoomsCursor,setNextRoomsCursor]=useState<string | null>(null);
  const [nextMyRoomsCursor,setNextMyRoomsCursor]=useState<string | null>(null);
  const [loadingMore,setLoadingMore]=useState<string | null>(null);
  const loadedFeedHistoryRef=useRef(false), loadedMyHistoryRef=useRef(false);
  const lastFeedQueryRef=useRef("");
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
  // Server time minus device time, learned from every feed load, so that a
  // phone whose clock is minutes off still shows the right countdown.
  const clockOffsetRef = useRef(0);
  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);
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

  const feedQuery = useMemo(() => {
    const query=new URLSearchParams({action:"bootstrap",sort:filters.sortBy});
    if(category!=="전체")query.set("categoryIds",restaurants.filter(r=>r.cuisine===category).map(r=>r.id).join(","));
    const term=search.trim().toLowerCase();
    if(term){
      query.set("searchRestaurants",restaurants.filter(r=>r.name.toLowerCase().includes(term)).map(r=>r.id).join(","));
      query.set("searchPickups",pickupPoints.filter(p=>p.full.toLowerCase().includes(term)).map(p=>p.id).join(","));
    }
    if(filters.currentPickupOnly)query.set("pickup",currentPickup);
    if(filters.availableOnly)query.set("available","1");
    return query.toString();
  },[category,search,filters,currentPickup]);

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++loadRoomsRequestRef.current;
    const response = await fetch(`/api/sikgu?${feedQuery}`, { cache: "no-store", signal });
    const data = await readJson<{
      user: AuthUser | null;
      rooms: Pool[];
      myRooms?: Pool[];
      serverNow?: number;
      nextRoomsCursor?: string | null;
      nextMyRoomsCursor?: string | null;
    }>(response);
    if (!response.ok) throw new Error(data.error || "주문방을 불러오지 못했어요.");
    if (!signal?.aborted && requestId === loadRoomsRequestRef.current) {
      if (typeof data.serverNow === "number") {
        clockOffsetRef.current = data.serverNow - Date.now();
        setNow(data.serverNow);
      }
      const isValidRoom = (room: Pool) => (
        restaurants.some((restaurant) => restaurant.id === room.restaurantId)
        && pickupPoints.some((point) => point.id === room.pickup)
        && room.apps.length > 0
      );
      setUser(data.user);
      if (data.user && incomingInviteRef.current) setPendingInvite(incomingInviteRef.current);
      if(lastFeedQueryRef.current!==feedQuery){loadedFeedHistoryRef.current=false;lastFeedQueryRef.current=feedQuery;}
      const fresh=(data.rooms || []).filter(isValidRoom), mine=(data.myRooms || []).filter(isValidRoom);
      setPools(previous=>loadedFeedHistoryRef.current ? [...new Map([...previous.filter(r=>r.closesAt>serverNow()),...fresh].map(r=>[r.id,r])).values()] : fresh);
      setMyRooms(previous=>loadedMyHistoryRef.current ? [...new Map([...previous.filter(r=>r.closesAt>serverNow()-30*86400000),...mine].map(r=>[r.id,r])).values()] : mine);
      if(!loadedFeedHistoryRef.current)setNextRoomsCursor(data.nextRoomsCursor ?? null);
      if(!loadedMyHistoryRef.current)setNextMyRoomsCursor(data.nextMyRoomsCursor ?? null);
      setBootstrapError("");
      setBootstrapState("ready");
    }
    return data;
  }, [feedQuery,serverNow]);

  const loadMoreRooms = async (kind: "feed" | "mine") => {
    const cursor=kind==="feed"?nextRoomsCursor:nextMyRoomsCursor;
    if(!cursor || loadingMore)return;
    const requestId=loadRoomsRequestRef.current;
    setLoadingMore(kind);
    try {
      const query=new URLSearchParams(feedQuery);
      query.set(kind==="feed"?"roomsCursor":"myRoomsCursor",cursor);
      const response=await fetch(`/api/sikgu?${query}`,{cache:"no-store"});
      const data=await readJson<{rooms?:Pool[];myRooms?:Pool[];nextRoomsCursor?:string|null;nextMyRoomsCursor?:string|null}>(response);
      if(!response.ok)throw new Error(data.error || "이전 주문방을 불러오지 못했어요.");
      if(requestId!==loadRoomsRequestRef.current)return;
      if(kind==="feed"){
        loadedFeedHistoryRef.current=true;
        setPools(previous=>[...new Map([...previous,...(data.rooms || [])].map(r=>[r.id,r])).values()]);
        setNextRoomsCursor(data.nextRoomsCursor ?? null);
      }else{
        loadedMyHistoryRef.current=true;
        setMyRooms(previous=>[...new Map([...previous,...(data.myRooms || [])].map(r=>[r.id,r])).values()]);
        setNextMyRoomsCursor(data.nextMyRoomsCursor ?? null);
      }
    }catch(error){notify(error instanceof Error?error.message:"더 불러오지 못했어요.","error");}
    finally{setLoadingMore(null);}
  };

  // Background refreshes after room actions: a failed bootstrap must not
  // surface as an unhandled rejection; the next poll retries anyway.
  const refreshRooms = useCallback(() => loadRooms().catch(() => undefined), [loadRooms]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), 30000);
    return () => window.clearInterval(timer);
  }, [serverNow]);

  useEffect(() => {
    let active = true;
    const controller=new AbortController();
    const requests=loadRoomsRequestRef;
    const initialize = async () => {
      let storage: Storage | null = null;
      try { storage = window.localStorage; } catch { /* Keep the link in memory. */ }
      incomingInviteRef.current ||= capturePendingInvite(window.location, window.history, storage, Date.now());
      let data: Awaited<ReturnType<typeof loadRooms>>;
      try {
        data = await loadRooms(controller.signal);
      } catch (loadError) {
        if (!active) return;
        setBootstrapState("error");
        setBootstrapError(loadError instanceof Error ? loadError.message : "네트워크 연결을 확인해주세요.");
        return;
      }
      if (!active) return;

      try {
        const invitation = incomingInviteRef.current;
        if (invitation) {
          if (!data.user) { signIn(); return; }
          setPendingInvite(invitation);
          return;
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
    const stop = browserPoll(async signal => { setNow(serverNow()); await loadRooms(signal); },30000);
    return () => {
      active = false;
      controller.abort();
      requests.current++;
      stop();
    };
  }, [loadRooms, notify, postAction, signIn, serverNow]);

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
        minutes: values.minutes,
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

  const dismissInvite = () => {
    try { clearPendingInvite(window.localStorage); } catch { /* Storage unavailable. */ }
    incomingInviteRef.current = null;
    setPendingInvite(null);
  };
  const acceptPendingInvite = async () => {
    if (!pendingInvite || acceptingInvite) return;
    setAcceptingInvite(true);
    try {
      await postAction({action:"accept_invite",roomId:pendingInvite.roomId,token:pendingInvite.token});
      setRoomHubId(pendingInvite.roomId);
      dismissInvite();
      void refreshRooms();
    } catch (error) { notify(error instanceof Error ? error.message : "초대를 수락하지 못했어요.","error"); }
    finally { setAcceptingInvite(false); }
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
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
        {view === "home" && nextRoomsCursor && <button className="history-more" disabled={Boolean(loadingMore)} onClick={() => void loadMoreRooms("feed")}>{loadingMore === "feed" ? "불러오는 중…" : "주문방 더 보기"}</button>}
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
        {view === "profile" && nextMyRoomsCursor && <button className="history-more" disabled={Boolean(loadingMore)} onClick={() => void loadMoreRooms("mine")}>{loadingMore === "mine" ? "불러오는 중…" : "이전 주문방 더 보기"}</button>}
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

      {selectedPool && (
        <PoolModal
          pool={latestSelectedPool ?? selectedPool}
          now={now}
          unavailable={!latestSelectedPool}
          onClose={() => setSelectedPool(null)}
          onToggleJoin={handleToggleJoin}
        />
      )}
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
          now={now}
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
      {pendingInvite && user && <InviteConfirmation name={user.displayName} roomName={restaurants.find(r=>r.id===pools.find(p=>p.id===pendingInvite.roomId)?.restaurantId)?.name || "초대받은 주문방"} onAccept={() => void acceptPendingInvite()} onClose={dismissInvite} busy={acceptingInvite} />}
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
