"use client";

import type { AuthUser, Pool } from "../types";
import { restaurants } from "../catalog";
import { timeLeft } from "../room-ui";
import { maskDisplayName } from "../name-mask.mjs";
import { isClosed as isPoolClosed } from "../lib/pool-status";
import { RestaurantMark } from "../restaurant-mark";
import { Header } from "../components/header";

export function ProfileView({
  onCreate,
  currentPickup,
  user,
  rooms,
  now,
  onRoom,
  onPending,
  onAuth,
}: {
  onCreate: () => void;
  currentPickup: string;
  user: AuthUser | null;
  rooms: Pool[];
  now: number;
  onRoom: (roomId: string) => void;
  onPending: (pool: Pool) => void;
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
              const isClosed = isPoolClosed(room, now);
              return (
                <button type="button" onClick={() => (room.myStatus === "requested" ? onPending(room) : onRoom(room.id))} key={room.id}>
                  <RestaurantMark restaurant={restaurant} />
                  <span>
                    <strong>{restaurant.name}{room.myStatus === "requested" && <i className="pending-badge">승인 대기</i>}</strong>
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

      <section className="privacy-notice" aria-labelledby="privacy-heading">
        <div className="section-heading">
          <div>
            <span>PRIVACY</span>
            <h2 id="privacy-heading">개인정보 안내</h2>
          </div>
        </div>
        <ul>
          <li><strong>저장하는 정보</strong> ChatGPT 로그인 계정의 이메일과 이름, 주문방 참여 상태와 주문 금액, 채팅 메시지, 방장이 올린 영수증 이미지.</li>
          <li><strong>보여지는 범위</strong> 이름은 항상 가려서 표시되고(예: 김*수, Jonathan S.), 이메일은 다른 사용자에게 전달되지 않아요. 채팅과 영수증은 승인된 구성원만 볼 수 있어요.</li>
          <li><strong>보관 기간</strong> 주문방은 모집 마감 후 30일 동안 다시 열 수 있고, 그 뒤에는 접근이 끊기며 데이터가 삭제돼요. 삭제는 순차적으로 진행되어 조금 늦어질 수 있어요.</li>
          <li><strong>직접 삭제</strong> 방장은 주문방에서 ‘방 삭제’로 참여자·채팅·초대 링크·영수증을 즉시 지울 수 있고, 참여자는 ‘방 나가기’로 참여 기록을 지울 수 있어요.</li>
          <li><strong>하지 않는 것</strong> 결제 정보를 받지 않고, 배달앱 주문을 대신 넣지 않으며, 개인정보를 외부에 제공하지 않아요.</li>
        </ul>
      </section>
    </>
  );
}
