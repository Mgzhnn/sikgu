"use client";

import { useState } from "react";
import type { Pool, Restaurant } from "../types";
import { pickupPoints, pendingJoinStorageKey } from "../catalog";
import { apiPost } from "../lib/api";
import type { PendingInvite } from "../continuations";
import type { CreateRoomValues } from "../modals/create-modal";
import type { Session } from "./use-session";
import type { useFeed } from "./use-feed";

type Feed = ReturnType<typeof useFeed>;

/**
 * What a student does to a room from the feed: open the create dialog, ask
 * to join, withdraw a request, create a room, accept an invitation. Each
 * action talks to the API, patches the feed optimistically and then reloads
 * it, reporting through the toast.
 */
export function useRoomActions({
  session,
  feed,
  pendingInvite,
  dismissInvite,
  closePool,
  openRoom,
  showCreate,
  closeCreate,
  goHome,
}: {
  session: Pick<Session, "user" | "bootstrapState" | "notify" | "signIn">;
  feed: Pick<Feed, "loadRooms" | "refreshRooms" | "markRequested" | "setPools" | "setMyRooms">;
  pendingInvite: PendingInvite | null;
  dismissInvite: () => void;
  closePool: () => void;
  openRoom: (roomId: string) => void;
  showCreate: (restaurant?: Restaurant) => void;
  closeCreate: () => void;
  goHome: () => void;
}) {
  const { user, bootstrapState, notify, signIn } = session;
  const { loadRooms, refreshRooms, markRequested, setPools, setMyRooms } = feed;
  const [acceptingInvite, setAcceptingInvite] = useState(false);

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
    showCreate(restaurant);
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
      closePool();
      openRoom(pool.id);
      return;
    }
    if (pool.myStatus === "requested") return;
    try {
      await apiPost({ action: "request_join", roomId: pool.id });
    } catch (joinError) {
      notify(joinError instanceof Error ? joinError.message : "참여 신청을 보내지 못했어요.", "error");
      return;
    }

    closePool();
    markRequested(pool.id);
    try {
      await loadRooms();
      notify("참여 신청을 보냈어요. 방장이 승인하면 채팅방이 열립니다.", "success");
    } catch {
      notify("참여 신청은 접수됐어요. 주문방 상태는 잠시 후 자동으로 갱신됩니다.", "info");
    }
  };

  const handleCancelJoin = async (pool: Pool) => {
    try {
      await apiPost({ action: "leave_room", roomId: pool.id });
    } catch (cancelError) {
      notify(cancelError instanceof Error ? cancelError.message : "신청을 취소하지 못했어요.", "error");
      return;
    }
    closePool();
    const clear = (rooms: Pool[]) => rooms.map((room) => (room.id === pool.id ? { ...room, myStatus: null } : room));
    setPools(clear);
    setMyRooms((rooms) => rooms.filter((room) => room.id !== pool.id));
    try {
      await loadRooms();
      notify("참여 신청을 취소했어요.", "success");
    } catch {
      notify("참여 신청은 취소됐어요. 목록은 잠시 후 자동으로 갱신됩니다.", "info");
    }
  };

  const handleCreate = async (values: CreateRoomValues) => {
    const point = pickupPoints.find((item) => item.id === values.pickup)
      || pickupPoints.find((item) => item.id === "E3")
      || pickupPoints[0];
    let result: { roomId?: string };
    try {
      result = await apiPost({
        action: "create_room",
        restaurantId: values.restaurantId,
        pickup: point.id,
        apps: values.apps,
        minutes: values.minutes,
        capacity: values.capacity,
        membership: values.membership,
        // The server substitutes its default for a blank note.
        note: values.note.trim(),
      });
    } catch (createError) {
      notify(createError instanceof Error ? createError.message : "주문방을 만들지 못했어요.", "error");
      return;
    }

    closeCreate();
    goHome();
    if (result.roomId) openRoom(result.roomId);
    try {
      await loadRooms();
      notify("새 주문방을 열었어요. 참여자를 선택하고 초대할 수 있어요.", "success");
    } catch {
      notify("주문방은 만들어졌어요. 목록은 잠시 후 자동으로 갱신됩니다.", "info");
    }
  };

  const acceptPendingInvite = async () => {
    if (!pendingInvite || acceptingInvite) return;
    setAcceptingInvite(true);
    try {
      await apiPost({action:"accept_invite",roomId:pendingInvite.roomId,token:pendingInvite.token});
      openRoom(pendingInvite.roomId);
      dismissInvite();
      void refreshRooms();
    } catch (error) { notify(error instanceof Error ? error.message : "초대를 수락하지 못했어요.","error"); }
    finally { setAcceptingInvite(false); }
  };

  return { openCreate, handleToggleJoin, handleCancelJoin, handleCreate, acceptPendingInvite, acceptingInvite };
}
