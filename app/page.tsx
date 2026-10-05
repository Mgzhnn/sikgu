"use client";

import { useCallback, useRef, useState } from "react";
import type { View, Pool, Restaurant } from "./types";
import { restaurants, navItems, type PickupPoint } from "./catalog";
import { prefersReducedMotion } from "./room-ui";
import { clearIncomingInvite, type PendingInvite } from "./continuations";
import { useSession } from "./hooks/use-session";
import { useFeed } from "./hooks/use-feed";
import { useCurrentPickup } from "./hooks/use-current-pickup";
import { useRoomActions } from "./hooks/use-room-actions";
import { Brand } from "./components/brand";
import { LocationPicker } from "./components/location-picker";
import { HomeView } from "./views/home-view";
import { RestaurantsView } from "./views/restaurants-view";
import { ProfileView } from "./views/profile-view";
import { RightRail } from "./views/right-rail";
import { PoolModal } from "./modals/pool-modal";
import { CreateModal } from "./modals/create-modal";
import { CampusMapModal } from "./modals/campus-map-modal";
import { FeedbackModal } from "./modals/feedback-modal";
import { InviteConfirmation } from "./modals/invite-confirmation";
import { RoomHubModal } from "./room-hub";

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const incomingInviteRef = useRef<PendingInvite | null>(null);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [roomHubId, setRoomHubId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Restaurant | undefined>();
  const [showCreate, setShowCreate] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showCampusMap, setShowCampusMap] = useState(false);
  const [campusMapPickup, setCampusMapPickup] = useState("E3");
  const [currentPickup, setCurrentPickup] = useCurrentPickup();
  const session = useSession();
  const { user, bootstrapState, bootstrapError, toast, notify } = session;
  const feed = useFeed({ currentPickup, session, incomingInviteRef, showInvite: setPendingInvite, openRoom: setRoomHubId });
  const {
    pools, myRooms, now, search, setSearch, category, setCategory, filters, setFilters,
    nextRoomsCursor, nextMyRoomsCursor, loadingMore, loadMoreRooms, refreshRooms, retryBootstrap,
  } = feed;
  const latestSelectedPool = selectedPool
    ? pools.find((pool) => pool.id === selectedPool.id) || null
    : null;
  const viewCopy = view === "restaurants" ? "가게 · 메뉴" : view === "profile" ? "내 정보" : "주문 모아보기";

  const dismissInvite = () => {
    clearIncomingInvite();
    incomingInviteRef.current = null;
    setPendingInvite(null);
  };
  const { openCreate, handleToggleJoin, handleCancelJoin, handleCreate, acceptPendingInvite, acceptingInvite } = useRoomActions({
    session,
    feed,
    pendingInvite,
    dismissInvite,
    closePool: () => setSelectedPool(null),
    openRoom: setRoomHubId,
    showCreate: (restaurant) => {
      setCreateFor(restaurant);
      setShowCreate(true);
    },
    closeCreate: () => setShowCreate(false),
    goHome: () => setView("home"),
  });

  const selectCurrentPickup = (point: PickupPoint) => {
    setCurrentPickup(point.id);
    notify(`현재 위치를 ${point.full}(으)로 설정했어요.`, "success");
  };

  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const toggleAuth = () => window.location.assign(user ? "/signout-with-chatgpt?return_to=/" : "/signin-with-chatgpt?return_to=/");
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
            onPending={setSelectedPool}
            onCreate={() => openCreate()}
            onAuth={toggleAuth}
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
        onAuth={toggleAuth}
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
          onCancelJoin={handleCancelJoin}
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
          onGone={(message) => {
            setRoomHubId(null);
            void refreshRooms();
            notify(message, "info");
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
