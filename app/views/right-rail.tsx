"use client";

import type { AuthUser, Pool } from "../types";
import { restaurants } from "../catalog";
import { money, timeLeft } from "../room-ui";
import { remainingAmount } from "../lib/pool-status";
import { maskDisplayName } from "../name-mask.mjs";
import { RestaurantMark } from "../restaurant-mark";
import { Progress } from "../components/progress";
import { CampusMapPreview } from "../components/campus-map-preview";

export function RightRail({
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
  const open = pools.filter((pool) => pool.closesAt > now);
  const closest = open.find((pool) => pool.pickup === currentPickup) || open[0];
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
              <span>주문까지</span><strong>{money(remainingAmount(closest))}</strong>
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
