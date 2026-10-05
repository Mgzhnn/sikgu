"use client";

import { useRef, useState } from "react";
import type { Pool } from "../types";
import { restaurants, appLabels, pickupPoints, campusMapPosition } from "../catalog";
import { money, useDialogLifecycle, timeLeft } from "../room-ui";
import { isFull as isPoolFull, joinStatus, poolCounts, remainingAmount } from "../lib/pool-status";
import { RestaurantMark } from "../restaurant-mark";

export function CampusMapModal({
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
  const counts = poolCounts(pools);
  const unmappedCount = pools.filter(
    (pool) => !pickupPoints.some((point) => point.id === pool.pickup),
  ).length;

  useDialogLifecycle(dialogRef, onClose);

  const joinPool = async (pool: Pool) => {
    if (pool.myStatus === "requested") return;
    if (isPoolFull(pool)) return;
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
              const count = counts[point.id] || 0;
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
                  const status = joinStatus(pool);
                  const isPending = pool.myStatus === "requested";
                  const isFull = isPoolFull(pool);
                  const isBusy = busyRoomId === pool.id;
                  const actionLabel = isBusy
                    ? "처리 중"
                    : status === "host"
                      ? "주문방 관리"
                      : status === "approved"
                        ? "채팅방 열기"
                        : status === "requested"
                          ? "방장 승인 대기 중"
                          : status === "full"
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
                        <b>{money(remainingAmount(pool))} 남음</b>
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
