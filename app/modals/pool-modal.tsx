"use client";

import { useRef, useState } from "react";
import type { Pool } from "../types";
import { restaurants, appLabels } from "../catalog";
import { money, useDialogLifecycle, timeLeft } from "../room-ui";
import { getAppEstimates } from "../order-estimates.mjs";
import { maskDisplayName } from "../name-mask.mjs";
import { isFull as isPoolFull, isReady, joinStatus, remainingAmount } from "../lib/pool-status";
import { RestaurantMark } from "../restaurant-mark";
import { Progress } from "../components/progress";

export function PoolModal({
  pool,
  now,
  unavailable = false,
  onClose,
  onToggleJoin,
  onCancelJoin,
}: {
  pool: Pool;
  now: number;
  /** The room left the live feed (deadline passed or host deleted it) while the dialog was open. */
  unavailable?: boolean;
  onClose: () => void;
  onToggleJoin: (pool: Pool) => Promise<void>;
  onCancelJoin: (pool: Pool) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogLifecycle(dialogRef, onClose);
  const [joining, setJoining] = useState(false);
  const awaitingApproval = !pool.isHost && pool.myStatus === "requested";
  const restaurant = restaurants.find((item) => item.id === pool.restaurantId)!;
  const gap = remainingAmount(pool);
  const ready = isReady(pool);
  const estimates = getAppEstimates(pool, restaurant);
  const isFull = isPoolFull(pool);
  const status = joinStatus(pool);

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
          {estimates.length > 1 && (
            <div className="thresholds">
              {estimates.map((estimate) => (
                <span
                  key={estimate.app}
                  style={{ left: `${Math.min(90, estimate.minimum / Math.max(...estimates.map((item) => item.minimum)) * 90)}%` }}
                >
                  {appLabels[estimate.app].name} {money(estimate.minimum)}
                </span>
              ))}
            </div>
          )}
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

        {awaitingApproval && (
          <p className="pool-pending-note" id="pool-pending-note" role="status">
            방장 승인을 기다리고 있어요. 승인되면 채팅방이 열립니다.
          </p>
        )}
        <div className="modal-footer">
          <div>
            <span>예상 배달비</span>
            <strong>{estimates.length > 1 ? "앱별 조건 확인" : estimates[0]?.fee === 0 ? "무료" : `${money(estimates[0]?.eachFee || 0)} / 1인`}</strong>
          </div>
          {awaitingApproval ? (
            <button
              className="secondary-button"
              onClick={async () => {
                if (joining) return;
                setJoining(true);
                try {
                  await onCancelJoin(pool);
                } finally {
                  setJoining(false);
                }
              }}
              disabled={joining}
              aria-describedby="pool-pending-note"
            >
              {joining ? "처리 중…" : "신청 취소"}
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={async () => {
                if (joining) return;
                setJoining(true);
                try {
                  await onToggleJoin(pool);
                } finally {
                  setJoining(false);
                }
              }}
              disabled={joining || isFull || unavailable}
            >
              {joining
                ? "처리 중…"
                : status === "host"
                ? `참여자 관리${pool.pendingCount ? ` · ${pool.pendingCount}명 대기` : ""}`
                : status === "approved"
                  ? "채팅방 열기"
                  : status === "full"
                    ? "정원 마감"
                    : status === "rejected"
                      ? "거절됨 · 다시 신청"
                      : status === "ready"
                        ? "참여 신청하기"
                        : "이 주문에 참여 신청"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
