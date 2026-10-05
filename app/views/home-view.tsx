"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import type { Pool, PoolFilters, PoolSort } from "../types";
import { restaurants, defaultPoolFilters } from "../catalog";
import { Header } from "../components/header";
import { CampusMapPreview } from "../components/campus-map-preview";
import { PoolCard } from "../components/pool-card";

export function HomeView({
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
  // Derived from the catalog so a cuisine cannot exist without a tab.
  const categories = useMemo(
    () => ["전체", ...Array.from(new Set(restaurants.map((item) => item.cuisine)))],
    [],
  );
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
