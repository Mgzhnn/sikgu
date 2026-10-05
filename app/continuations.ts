import { capturePendingInvite, clearPendingInvite } from "./invite-continuation.mjs";
import { pendingJoinStorageKey } from "./catalog";
import { apiPost } from "./lib/api";
import type { AuthUser, Pool } from "./types";

export type PendingInvite = NonNullable<ReturnType<typeof capturePendingInvite>>;

/** Captures an invitation from the URL (scrubbing it) or from storage, before any network await. */
export function captureIncomingInvite(): PendingInvite | null {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Keep the link in memory. */ }
  return capturePendingInvite(window.location, window.history, storage, Date.now());
}

export function clearIncomingInvite() {
  try { clearPendingInvite(window.localStorage); } catch { /* Storage unavailable. */ }
}

/**
 * Resumes what the student was doing before sign-in: an invitation is shown
 * for explicit acceptance, and a join remembered in sessionStorage is sent
 * once. Runs after every bootstrap; the storage entries are removed as soon
 * as they have been acted on, so a repeat is a no-op.
 */
export async function resumeContinuations(
  data: { user: AuthUser | null; rooms: Pool[] },
  {
    invite,
    signIn,
    notify,
    showInvite,
    openRoom,
    markRequested,
    loadRooms,
  }: {
    invite: PendingInvite | null;
    signIn: () => void;
    notify: (message: string, tone?: "success" | "error" | "info") => void;
    showInvite: (invite: PendingInvite) => void;
    openRoom: (roomId: string) => void;
    markRequested: (roomId: string) => void;
    loadRooms: () => Promise<unknown>;
  },
) {
  if (invite) {
    if (!data.user) { signIn(); return; }
    showInvite(invite);
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
      openRoom(pendingPool.id);
      return;
    }
    if (pendingPool.myStatus === "requested") {
      window.sessionStorage.removeItem(pendingJoinStorageKey);
      notify("이미 참여 승인을 기다리고 있어요.", "info");
      return;
    }

    try {
      await apiPost({ action: "request_join", roomId: pendingPool.id });
      window.sessionStorage.removeItem(pendingJoinStorageKey);
      markRequested(pendingPool.id);
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
}
