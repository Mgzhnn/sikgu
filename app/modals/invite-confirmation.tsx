"use client";

import { useRef } from "react";
import { useDialogLifecycle } from "../room-ui";

export function InviteConfirmation({name,roomName,onAccept,onClose,busy}: {name:string;roomName:string;onAccept:()=>void;onClose:()=>void;busy:boolean}) {
  const ref=useRef<HTMLElement | null>(null);
  useDialogLifecycle(ref,onClose);
  return <div className="overlay centered"><section className="pool-modal" role="dialog" aria-modal="true" aria-label="주문방 초대 확인" ref={ref}>
    <h2>주문방 초대 확인</h2><p>{roomName}</p><p>{name} 계정으로 참여할까요?</p>
    <p>공용 기기라면 로그인한 계정을 먼저 확인해 주세요.</p>
    <button className="primary-button" disabled={busy} onClick={onAccept}>{busy ? "참여 중…" : "초대 수락"}</button>
    <button className="secondary-button" disabled={busy} onClick={onClose}>취소</button>
  </section></div>;
}
