"use client";

import { useRef } from "react";
import { useDialogLifecycle } from "../room-ui";

const feedbackEmail = "gudwns5863@naver.com";

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogLifecycle(dialogRef, onClose);

  return (
    <div className="overlay centered feedback-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        aria-describedby="feedback-description"
        ref={dialogRef}
      >
        <header className="feedback-head">
          <div>
            <span>HELP SIKGU</span>
            <h2 id="feedback-title">도움말 · 제안 보내기</h2>
            <p id="feedback-description">SIKGU를 이용하며 발견한 문제를 알려주세요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="의견 보내기 닫기">×</button>
        </header>

        <div className="feedback-instruction">
          <span aria-hidden="true">!</span>
          <p>수정할 내용이나 버그가 있으면 아래 이메일로 버그 내용을 적어서 보내주세요.</p>
        </div>

        <div className="feedback-recipient">
          <span className="feedback-mail-mark" aria-hidden="true">@</span>
          <div>
            <small>문의 이메일</small>
            <strong>{feedbackEmail}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
