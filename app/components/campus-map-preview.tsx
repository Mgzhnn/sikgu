"use client";

import type { Pool } from "../types";
import { pickupPoints, campusMapPosition } from "../catalog";
import { poolCounts } from "../lib/pool-status";

export function CampusMapPreview({
  pools,
  currentPickup,
  onOpen,
}: {
  pools: Pool[];
  currentPickup: string;
  onOpen: (pickupId: string) => void;
}) {
  const counts = poolCounts(pools);

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
          const count = counts[point.id] || 0;
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
