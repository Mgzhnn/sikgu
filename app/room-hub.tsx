"use client";

import {useCallback,useEffect,useRef,useState, type FormEvent} from "react";
import type {Pool, RoomMember, ChatMessage} from "./types";
import {restaurants} from "./catalog";
import {money, estimatedArrivalLabel, maxReceiptUploadBytes, prepareReceiptUpload, redirectToSignIn, readJson, browserPoll, useDialogLifecycle, timeLeft} from "./room-ui";
import {maskDisplayName} from "./name-mask.mjs";
import {maxChatMessageCharacters} from "./sikgu-rules.mjs";
import {mergeMessages, newMessageCount} from "./message-history.mjs";

export function RoomHubModal({
  roomId,
  now,
  onClose,
  onChanged,
  onDeleted,
  onLeft,
  onGone,
}: {
  roomId: string;
  now: number;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onLeft: () => void;
  /** The room is gone or the viewer was removed: close with this message. */
  onGone: (message: string) => void;
}) {
  const [room, setRoom] = useState<Pool | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState<number | null>(null);
  const [inviteStatus, setInviteStatus] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [newMessageNotice, setNewMessageNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editingOrderInfo, setEditingOrderInfo] = useState(false);
  const [estimatedArrival, setEstimatedArrival] = useState("");
  const [orderTotal, setOrderTotal] = useState("");
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [savingAmount, setSavingAmount] = useState("");
  const [busyDeadline, setBusyDeadline] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [savingOrderInfo, setSavingOrderInfo] = useState(false);
  const [orderInfoStatus, setOrderInfoStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reviewingMember, setReviewingMember] = useState("");
  const roomDialogRef = useRef<HTMLElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const knownMessageIdsRef = useRef<Set<string> | null>(null);
  const [noticeVersion,setNoticeVersion] = useState(0);
  const [olderMessagesCursor,setOlderMessagesCursor] = useState<string | null>(null);
  const [loadingOlder,setLoadingOlder] = useState(false);
  const historyLoadedRef = useRef(false);
  const loadRoomRequestRef = useRef(0);
  const restaurant = room
    ? restaurants.find((item) => item.id === room.restaurantId)
    : undefined;
  // Once the deadline passes the server refuses invites and approvals; the
  // room stays readable (chat, receipt) for 30 days.
  const isClosed = Boolean(room) && room!.closesAt <= now;

  useDialogLifecycle(roomDialogRef, onClose);

  const loadRoom = useCallback(async (quiet = false, signal?: AbortSignal) => {
    const requestId = ++loadRoomRequestRef.current;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/sikgu?action=room&roomId=${encodeURIComponent(roomId)}`, {
        cache: "no-store", signal,
      });
      const data = await readJson<{
        room?: Pool;
        members?: RoomMember[];
        messages?: ChatMessage[];
        nextMessagesCursor?: string | null;
        code?: string;
      }>(response);
      if (signal?.aborted || requestId !== loadRoomRequestRef.current) return null;
      if (!response.ok || !data.room) {
        if (response.status === 401 || response.status === 403) {
          setRoom(null);
          setMembers([]);
          setMessages([]);
          setReceiptFile(null);
        }
        // The server tells a deleted room apart from a removed member; both
        // end the session in this sheet, with the matching message.
        if (data.code === "room_gone") {
          onGone("방장이 주문방을 삭제했어요.");
          return false;
        }
        if (data.code === "removed") {
          onGone("주문방에서 내보내졌어요.");
          return false;
        }
        if (response.status === 401) {
          // The mutation path already redirects on 401; a poll that finds the
          // session gone must do the same instead of showing a retry that
          // fails identically.
          redirectToSignIn();
          return false;
        }
        setError(data.error || "주문방을 불러오지 못했어요.");
        setLoading(false);
        return false;
      }
      setRoom(data.room);
      setMembers(data.members || []);
      const incoming = data.messages || [];
      const arrived = newMessageCount(knownMessageIdsRef.current,incoming);
      if(arrived) { setNewMessageNotice(`새 메시지 ${arrived}개`); setNoticeVersion(v=>v+1); }
      knownMessageIdsRef.current ||= new Set();
      incoming.forEach(message=>knownMessageIdsRef.current!.add(message.id));
      setMessages(previous=>mergeMessages(previous,incoming));
      if(!historyLoadedRef.current) setOlderMessagesCursor(data.nextMessagesCursor ?? null);
      setError("");
      setLoading(false);
      return true;
    } catch {
      if (signal?.aborted || requestId !== loadRoomRequestRef.current) return null;
      setError("네트워크 연결을 확인한 뒤 다시 시도해주세요.");
      setLoading(false);
      return false;
    }
  }, [roomId, onGone]);

  useEffect(() => {
    const controller = new AbortController();
    const requests=loadRoomRequestRef;
    const initialTimer=window.setTimeout(()=>void loadRoom(false, controller.signal),0);
    const stop = browserPoll(signal => loadRoom(true,signal),10000);
    return () => { window.clearTimeout(initialTimer); controller.abort(); requests.current++; stop(); };
  }, [loadRoom]);

  const newestMessageId = messages.at(-1)?.id;
  useEffect(() => {
    const list = chatListRef.current;
    if (!stickToBottomRef.current) return;
    if (list) { list.scrollTop = list.scrollHeight; return; }
    messagesEndRef.current?.scrollIntoView({block:"nearest"});
  }, [newestMessageId]);

  const loadOlderMessages = async () => {
    if(!olderMessagesCursor || loadingOlder)return;
    setLoadingOlder(true);
    const list=chatListRef.current, previousHeight=list?.scrollHeight || 0;
    try {
      const response=await fetch(`/api/sikgu?action=room&roomId=${encodeURIComponent(roomId)}&messagesCursor=${encodeURIComponent(olderMessagesCursor)}`,{cache:"no-store"});
      const data=await readJson<{messages?:ChatMessage[];nextMessagesCursor?:string|null}>(response);
      if(!response.ok){if([401,403,410].includes(response.status)){setRoom(null);setMessages([]);}throw new Error(data.error || "이전 메시지를 불러오지 못했어요.");}
      const incoming=data.messages || [];
      incoming.forEach(message=>knownMessageIdsRef.current?.add(message.id));
      historyLoadedRef.current=true;
      setMessages(previous=>mergeMessages(previous,incoming));
      setOlderMessagesCursor(data.nextMessagesCursor ?? null);
      window.requestAnimationFrame(()=>{if(list)list.scrollTop+=list.scrollHeight-previousHeight;});
    } catch(error){setError(error instanceof Error?error.message:"이전 메시지를 불러오지 못했어요.");}
    finally{setLoadingOlder(false);}
  };

  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/sikgu", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sikgu-request": "1" },
      body: JSON.stringify({ ...payload, roomId }),
    });
    const data = await readJson<{ token?: string; expiresAt?: number }>(response);
    if (response.status === 401) {
      redirectToSignIn();
      throw new Error("로그인이 필요합니다.");
    }
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어요.");
    return data;
  };

  const review = async (memberRef: string, decision: "approve" | "reject") => {
    if (reviewingMember) return;
    setReviewingMember(memberRef);
    setError("");
    try {
      await post({ action: "review_member", memberRef, decision });
      await loadRoom(true);
      onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "참여자 상태를 변경하지 못했어요.");
    } finally {
      setReviewingMember("");
    }
  };

  const removeMember = async (memberRef: string) => {
    if (reviewingMember) return;
    setReviewingMember(memberRef);
    setError("");
    try {
      await post({ action: "remove_member", memberRef });
      await loadRoom(true);
      onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "참여자를 내보내지 못했어요.");
    } finally {
      setReviewingMember("");
    }
  };

  const saveAmount = async (key: string, memberRef?: string) => {
    if (savingAmount) return;
    const draft = (amountDrafts[key] ?? "").trim();
    const amount = draft === "" ? null : Number(draft);
    if (amount !== null && (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000)) {
      setError("주문 금액은 0원부터 10,000,000원까지 입력할 수 있어요.");
      return;
    }
    setSavingAmount(key);
    setError("");
    try {
      await post({ action: "set_amount", amount, ...(memberRef ? { memberRef } : {}) });
      setAmountDrafts((drafts) => { const next = { ...drafts }; delete next[key]; return next; });
      await loadRoom(true);
      onChanged();
    } catch (amountError) {
      setError(amountError instanceof Error ? amountError.message : "주문 금액을 저장하지 못했어요.");
    } finally {
      setSavingAmount("");
    }
  };

  const extendRoom = async () => {
    if (busyDeadline) return;
    setBusyDeadline(true);
    setError("");
    try {
      await post({ action: "extend_room" });
      setChatStatus("모집 시간을 15분 연장했어요.");
      await loadRoom(true);
      onChanged();
    } catch (extendError) {
      setError(extendError instanceof Error ? extendError.message : "모집 시간을 연장하지 못했어요.");
    } finally {
      setBusyDeadline(false);
    }
  };

  const closeRecruitment = async () => {
    if (busyDeadline) return;
    setBusyDeadline(true);
    setError("");
    try {
      await post({ action: "close_recruitment" });
      setChatStatus("모집을 마감했어요. 채팅과 영수증은 그대로 쓸 수 있어요.");
      await loadRoom(true);
      onChanged();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "모집을 마감하지 못했어요.");
    } finally {
      setBusyDeadline(false);
    }
  };

  const createInvite = async () => {
    if (creatingInvite) return;
    setCreatingInvite(true);
    setError("");
    try {
      const data = await post({ action: "create_invite" });
      const link = `${window.location.origin}/?room=${encodeURIComponent(roomId)}&invite=${encodeURIComponent(data.token || "")}`;
      setInviteLink(link);
      setInviteExpiresAt(data.expiresAt ?? room?.closesAt ?? null);
      try {
        await navigator.clipboard.writeText(link);
        setInviteStatus("초대 링크를 복사했어요.");
      } catch {
        setInviteStatus("초대 링크를 만들었어요. 아래 주소를 직접 복사해주세요.");
      }
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "초대 링크를 만들지 못했어요.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteStatus("초대 링크를 복사했어요.");
    } catch {
      setError("자동 복사가 차단됐어요. 링크를 길게 눌러 직접 복사해주세요.");
    }
  };

  const sendMessage = async () => {
    const draft = message;
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    setChatStatus("");
    stickToBottomRef.current = true;
    // Clear now, synchronously with the send gesture: a delayed clear after
    // the round trip would race with new typing and could interrupt a Korean
    // syllable being composed. If the send fails, the draft comes back in
    // front of anything typed meanwhile.
    setMessage("");
    try {
      await post({ action: "send_message", body });
      const refreshed = await loadRoom(true);
      if (refreshed === false) setChatStatus("메시지는 전송됐어요. 새 메시지는 잠시 후 다시 확인해주세요.");
    } catch (messageError) {
      setMessage((current) => (current ? `${draft} ${current}` : draft));
      setError(messageError instanceof Error ? messageError.message : "메시지를 보내지 못했어요.");
    } finally {
      setSending(false);
    }
  };

  const openOrderEditor = () => {
    setEstimatedArrival(room?.estimatedArrival || "");
    setOrderTotal(room?.orderTotal == null ? "" : String(room.orderTotal));
    setReceiptFile(null);
    setOrderInfoStatus("");
    setError("");
    setEditingOrderInfo(true);
  };

  const saveOrderInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingOrderInfo) return;
    if (receiptFile) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(receiptFile.type)) {
        setError("영수증은 JPG, PNG, WebP 이미지로 올려주세요.");
        return;
      }
      if (receiptFile.size > maxReceiptUploadBytes) {
        setError("영수증 이미지는 8MB 이하만 올릴 수 있어요.");
        return;
      }
    }

    setSavingOrderInfo(true);
    setError("");
    try {
      const preparedReceipt = receiptFile ? await prepareReceiptUpload(receiptFile) : null;
      const form = new FormData();
      form.set("action", "update_order_info");
      form.set("roomId", roomId);
      form.set("estimatedArrival", estimatedArrival);
      form.set("orderTotal", orderTotal);
      if (preparedReceipt) form.set("receipt", preparedReceipt);
      const response = await fetch(
        `/api/sikgu?action=update_order_info&roomId=${encodeURIComponent(roomId)}`,
        { method: "PUT", headers: { "x-sikgu-request": "1" }, body: form },
      );
      const data = await readJson<object>(response);
      if (!response.ok) throw new Error(data.error || "주문 정보를 저장하지 못했어요.");
      setEditingOrderInfo(false);
      setReceiptFile(null);
      setOrderInfoStatus("방장이 주문 정보를 업데이트했어요.");
      const refreshed = await loadRoom(true);
      if (refreshed === false) setOrderInfoStatus("주문 정보는 저장됐어요. 화면은 잠시 후 새로고침됩니다.");
      onChanged();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "주문 정보를 저장하지 못했어요.");
    } finally {
      setSavingOrderInfo(false);
    }
  };

  const deleteRoom = async () => {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/sikgu?roomId=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
        headers: { "x-sikgu-request": "1" },
      });
      const data = await readJson<object>(response);
      if (response.status === 404) {
        onDeleted();
        return;
      }
      if (!response.ok) throw new Error(data.error || "주문방을 삭제하지 못했어요.");
      onDeleted();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "주문방을 삭제하지 못했어요.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const leaveRoom = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await post({ action: "leave_room" });
      onLeft();
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "주문방에서 나가지 못했어요.");
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  return (
    <div className="overlay centered" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="room-hub" role="dialog" aria-modal="true" aria-label="비공개 주문방 채팅" ref={roomDialogRef}>
        <div className="room-hub-head">
          <div>
            <span>PRIVATE ORDER ROOM</span>
            <h2>{restaurant?.name || "주문방"}</h2>
            <p>
              {room
                ? `${room.pickupFull} · ${room.people}/${room.capacity}명 · ${isClosed ? "마감됨" : timeLeft(room.closesAt, now)}`
                : "주문방 정보를 불러오는 중"}
            </p>
          </div>
          <div className="room-hub-head-actions">
            {room?.isHost && (
              <button className="delete-room-trigger" onClick={() => setConfirmDelete(true)}>방 삭제</button>
            )}
            {room && !room.isHost && (
              <button className="leave-room-trigger" onClick={() => setConfirmLeave(true)}>방 나가기</button>
            )}
            <button className="room-hub-close" onClick={onClose} aria-label="주문방 채팅 닫기">×</button>
          </div>
        </div>
        {room?.isHost && (
          <div className="room-deadline-actions">
            {!isClosed && (
              <button type="button" onClick={() => void closeRecruitment()} disabled={busyDeadline}>
                모집 마감
              </button>
            )}
            {(room.extensions ?? 0) < 2 && room.closesAt > now - 10 * 60 * 1000 && (
              <button type="button" onClick={() => void extendRoom()} disabled={busyDeadline}>
                15분 연장{(room.extensions ?? 0) ? ` · ${2 - (room.extensions ?? 0)}회 남음` : ""}
              </button>
            )}
            <small>
              {isClosed
                ? "모집이 마감됐어요. 채팅·금액·영수증은 30일 동안 쓸 수 있어요."
                : "마감 전에 모집을 끝내거나, 마감 후 10분 안에 연장할 수 있어요."}
            </small>
          </div>
        )}
        {room?.isHost && confirmDelete && (
          <div className="room-delete-confirm" role="alert">
            <div>
              <strong>이 주문방을 영구 삭제할까요?</strong>
              <p>참여자, 채팅, 초대 링크, 영수증 이미지가 모두 삭제되며 되돌릴 수 없어요.</p>
            </div>
            <span>
              <button onClick={() => setConfirmDelete(false)} disabled={deleting}>취소</button>
              <button onClick={deleteRoom} disabled={deleting}>{deleting ? "삭제 중…" : "영구 삭제"}</button>
            </span>
          </div>
        )}
        {room && !room.isHost && confirmLeave && (
          <div className="room-delete-confirm leave" role="alert">
            <div>
              <strong>이 주문방에서 나갈까요?</strong>
              <p>나가면 채팅과 영수증을 더 이상 볼 수 없어요.</p>
            </div>
            <span>
              <button onClick={() => setConfirmLeave(false)} disabled={leaving}>취소</button>
              <button onClick={leaveRoom} disabled={leaving}>{leaving ? "나가는 중…" : "방 나가기"}</button>
            </span>
          </div>
        )}

        {loading ? (
          <div className="room-hub-loading">주문방을 불러오고 있어요…</div>
        ) : error && !room ? (
          <div className="room-hub-error">
            <strong>주문방을 열 수 없어요</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void loadRoom()}>다시 시도</button>
          </div>
        ) : room ? (
          <div className="room-hub-body">
            <aside className="member-panel">
              <div className="member-panel-head">
                <div><strong>함께할 식구</strong><small>승인된 사람만 채팅 가능</small></div>
                {room.isHost && (
                  <button onClick={createInvite} disabled={creatingInvite || isClosed}>
                    {creatingInvite ? "만드는 중…" : "초대 링크"}
                  </button>
                )}
              </div>
              {inviteLink && (
                <div className="invite-success">
                  <span>✓</span>
                  <div>
                    <strong>{inviteStatus || "초대 링크를 만들었어요."}</strong>
                    <small>{inviteExpiresAt && inviteExpiresAt > now ? `${timeLeft(inviteExpiresAt, now)} · 모집 마감까지 사용할 수 있어요.` : "모집이 마감됐어요."} 정원이 차면 더 일찍 마감돼요.</small>
                    <label>
                      <span className="sr-only">초대 링크</span>
                      <input value={inviteLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <button type="button" onClick={copyInvite}>링크 복사</button>
                  </div>
                </div>
              )}
              <div className="member-list">
                {members.map((member) => {
                  const maskedMemberName = maskDisplayName(member.display_name);
                  const canEditAmount = member.status === "approved" && Boolean(member.mine || (room.isHost && member.member_ref));
                  const amountKey = member.mine ? "me" : member.member_ref || "";
                  const amountDraft = amountDrafts[amountKey] ?? (member.amount == null ? "" : String(member.amount));
                  return (
                    <div className={member.status === "requested" ? "pending" : ""} key={`${member.member_ref || member.display_name}-${member.created_at}`}>
                      <span className="avatar">{maskedMemberName.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{maskedMemberName}{member.mine ? " (나)" : ""}</strong>
                        <small>
                          {member.role === "host" ? "방장" : member.status === "approved" ? "참여 확정" : "참여 신청"}
                          {member.status === "approved" && (member.amount == null ? " · 금액 미입력" : ` · ${money(member.amount)}`)}
                        </small>
                      </span>
                      {room.isHost && member.status === "requested" && member.member_ref ? (
                        <span className="member-actions">
                          <button
                            onClick={() => review(member.member_ref!, "approve")}
                            disabled={Boolean(reviewingMember) || isClosed}
                          >
                            {reviewingMember === member.member_ref ? "처리 중" : "승인"}
                          </button>
                          <button
                            onClick={() => review(member.member_ref!, "reject")}
                            disabled={Boolean(reviewingMember)}
                          >
                            거절
                          </button>
                        </span>
                      ) : room.isHost && member.role === "member" && member.member_ref ? (
                        <span className="member-actions">
                          <button
                            className="remove"
                            onClick={() => void removeMember(member.member_ref!)}
                            disabled={Boolean(reviewingMember)}
                          >
                            {reviewingMember === member.member_ref ? "처리 중" : "내보내기"}
                          </button>
                        </span>
                      ) : (
                        <b>{member.status === "approved" ? "✓" : ""}</b>
                      )}
                      {canEditAmount && (
                        <form
                          className="amount-editor"
                          onSubmit={(event) => { event.preventDefault(); void saveAmount(amountKey, member.mine ? undefined : member.member_ref); }}
                        >
                          <label>
                            <span className="sr-only">{member.mine ? "내 주문 금액" : `${maskedMemberName} 주문 금액`}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              max="10000000"
                              step="1"
                              placeholder={member.mine ? "내 주문 금액" : "주문 금액"}
                              value={amountDraft}
                              onChange={(event) => setAmountDrafts((drafts) => ({ ...drafts, [amountKey]: event.target.value }))}
                            />
                          </label>
                          <button type="submit" disabled={Boolean(savingAmount)}>{savingAmount === amountKey ? "저장 중" : "저장"}</button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>

            <section className="chat-panel">
              <section className="order-info-card" aria-label="배달 주문 정보">
                <div className="order-info-head">
                  <div>
                    <span>ORDER UPDATE</span>
                    <strong>배달 주문 정보</strong>
                    <small>승인된 식구만 볼 수 있어요.</small>
                  </div>
                  {room.isHost && (
                    <button onClick={editingOrderInfo ? () => setEditingOrderInfo(false) : openOrderEditor}>
                      {editingOrderInfo ? "닫기" : room.estimatedArrival || room.orderTotal || room.receiptUrl ? "수정" : "정보 등록"}
                    </button>
                  )}
                </div>

                <div className="order-info-summary">
                  <div>
                    <span className="order-info-icon" aria-hidden="true">Σ</span>
                    <p><small>모인 주문 금액 · 참여자 합계</small><strong>{money(room.total)}</strong></p>
                  </div>
                  <div>
                    <span className="order-info-icon" aria-hidden="true">◷</span>
                    <p><small>도착 예상</small><strong>{estimatedArrivalLabel(room.estimatedArrival)}</strong></p>
                  </div>
                  <div>
                    <span className="order-info-icon" aria-hidden="true">₩</span>
                    <p><small>최종 결제 금액</small><strong>{room.orderTotal == null ? "미정" : money(room.orderTotal)}</strong></p>
                  </div>
                  {room.receiptUrl ? (
                    <a
                      className="receipt-thumb"
                      href={room.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="영수증 원본 이미지 열기"
                    >
                      {/* Protected room images must load directly so the member's auth cookie reaches the API. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={room.receiptUrl} alt="방장이 올린 영수증 또는 주문 화면 캡처" />
                      <span>원본 보기 ↗</span>
                    </a>
                  ) : (
                    <div className="receipt-empty">
                      <span aria-hidden="true">▧</span>
                      <p><strong>영수증 없음</strong><small>방장이 올리면 여기에 표시돼요.</small></p>
                    </div>
                  )}
                </div>

                {orderInfoStatus && <p className="order-info-status" role="status">✓ {orderInfoStatus}</p>}

                {room.isHost && editingOrderInfo && (
                  <form className="order-info-form" onSubmit={saveOrderInfo}>
                    <div className="order-info-fields">
                      <label>
                        <span>도착 예상 시각</span>
                        <input
                          type="datetime-local"
                          value={estimatedArrival}
                          onChange={(event) => setEstimatedArrival(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>최종 결제 금액</span>
                        <span className="price-input">
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            max="10000000"
                            step="1"
                            value={orderTotal}
                            onChange={(event) => setOrderTotal(event.target.value)}
                            placeholder="예: 28500"
                          />
                          <b>원</b>
                        </span>
                      </label>
                    </div>
                    <label className="receipt-upload">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                      />
                      <span aria-hidden="true">＋</span>
                      <p>
                        <strong>{receiptFile ? receiptFile.name : room.receiptUrl ? "새 이미지로 교체" : "영수증·주문 화면 올리기"}</strong>
                        <small>JPG, PNG, WebP · 최대 8MB · 자동 최적화</small>
                      </p>
                    </label>
                    <p className="receipt-privacy">주소·전화번호·주문번호 등 개인정보는 가린 뒤 올려주세요.</p>
                    <button className="primary-button order-info-save" type="submit" disabled={savingOrderInfo}>
                      {savingOrderInfo ? "저장 중…" : "주문 정보 저장"}
                    </button>
                  </form>
                )}
              </section>

              <div className="chat-head">
                <div><span className="lock-mark">⌁</span><strong>주문방 채팅</strong></div>
                <small>초대·승인된 구성원 전용</small>
              </div>
              <div className="sr-only" role="status" aria-live="polite"><span key={noticeVersion}>{newMessageNotice}</span></div>
              <div
                className="chat-messages"
                ref={chatListRef}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
                }}
              >
                {olderMessagesCursor && <button className="history-more" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? "불러오는 중…" : "이전 메시지 더 보기"}</button>}
                {!messages.length && (
                  <div className="chat-empty">
                    <span>식</span>
                    <strong>첫 메시지를 남겨보세요</strong>
                    <p>메뉴와 픽업 시간을 안전하게 조율할 수 있어요.</p>
                  </div>
                )}
                {messages.map((item) => (
                  <article className={item.mine ? "mine" : ""} key={item.id}>
                    {!item.mine && <small>{maskDisplayName(item.sender_name)}</small>}
                    <div><p>{item.body}</p><time>{new Date(item.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time></div>
                  </article>
                ))}
                <div className="chat-scroll-anchor" ref={messagesEndRef} />
              </div>
              {chatStatus && <p className="chat-status" role="status">{chatStatus}</p>}
              <div className="chat-composer">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter"
                      && !event.shiftKey
                      && !event.nativeEvent.isComposing
                      && event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  aria-label="채팅 메시지"
                  placeholder="메시지를 입력하세요"
                  maxLength={maxChatMessageCharacters}
                  rows={1}
                />
                <button onClick={sendMessage} disabled={sending || !message.trim()} aria-label="메시지 보내기">↑</button>
              </div>
            </section>
          </div>
        ) : null}
        {error && room && <div className="room-hub-inline-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
