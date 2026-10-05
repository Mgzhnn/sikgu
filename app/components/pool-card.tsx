"use client";

import type { Pool } from "../types";
import { restaurants } from "../catalog";
import { money, timeLeft } from "../room-ui";
import { isReady, remainingAmount } from "../lib/pool-status";
import { RestaurantMark } from "../restaurant-mark";
import { Progress } from "./progress";

export function PoolCard({
  pool,
  now,
  onOpen,
}: {
  pool: Pool;
  now: number;
  onOpen: (pool: Pool) => void;
}) {
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = remainingAmount(pool);
  const ready = isReady(pool);
  // The card shows the viewer's relation to the room, not a join action, so
  // its ladder differs from the dialog's: a rejection stays visible even on
  // a full room, and the host's own pill counts waiting requests.
  const statusLabel = pool.isHost && pool.pendingCount
    ? `${pool.pendingCount}명 승인 대기`
    : pool.myStatus === "requested"
      ? "승인 대기"
      : pool.myStatus === "approved"
        ? "참여 중"
        : pool.myStatus === "rejected"
          ? "거절됨"
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
