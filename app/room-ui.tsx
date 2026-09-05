"use client";

import { useEffect, useRef } from "react";
import type { Restaurant } from "./types";
import { startPolling } from "./polling.mjs";

export const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
export const estimatedArrivalLabel = (value?: string | null) => {
  if (!value) return "미정";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
export const kakaoMapSearchUrl = (restaurant: Restaurant) =>
  `https://map.kakao.com/?q=${encodeURIComponent(`${restaurant.name} ${restaurant.address || "현풍 테크노폴리스"}`)}`;

export const maxReceiptUploadBytes = 8 * 1024 * 1024;

export const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("이미지를 처리하지 못했어요."))),
      type,
      quality,
    );
  });

export async function prepareReceiptUpload(file: File) {
  let source: ImageBitmap | HTMLImageElement;
  let release: () => void = () => undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    release = () => bitmap.close();
  } catch {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("이미지 파일을 열 수 없어요."));
      image.src = objectUrl;
    }).finally(() => URL.revokeObjectURL(objectUrl));
    source = image;
  }

  try {
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    if (!sourceWidth || !sourceHeight) throw new Error("이미지 크기를 확인할 수 없어요.");
    const canvas = document.createElement("canvas");
    let blob: Blob | null = null;
    let previousSize = "";
    for (const maxSide of [2400, 2000, 1600, 1280, 1024]) {
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const size = `${width}x${height}`;
      if (size === previousSize) continue;
      previousSize = size;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("이미지를 처리할 수 없는 브라우저예요.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      blob = await canvasBlob(canvas, "image/png");
      if (blob.size <= maxReceiptUploadBytes) break;
    }
    if (!blob || blob.size > maxReceiptUploadBytes) {
      throw new Error("이미지를 8MB 이하로 줄이지 못했어요. 화면을 잘라서 다시 올려주세요.");
    }
    return new File([blob], "receipt.png", { type: "image/png", lastModified: Date.now() });
  } finally {
    release();
  }
}

/** Sends the browser to the platform sign-in route and back to the current page. */
export function redirectToSignIn() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  // This platform endpoint needs a full document navigation through the proxy.
  window.location.assign(new URL(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, window.location.origin).href);
}

export const fallbackErrorByStatus = (status: number) => {
  if (status === 401) return "로그인이 필요합니다.";
  if (status === 403) return "허용되지 않은 요청입니다.";
  if (status === 404) return "주문방을 찾을 수 없습니다.";
  if (status === 413) return "요청 내용이 너무 큽니다.";
  if (status === 429) return "요청이 너무 잦아요. 잠시 후 다시 시도해주세요.";
  if (status >= 500) return "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  return "요청을 처리하지 못했어요.";
};

/**
 * Reads an API response body. Platform error pages (HTML 502/504, edge 413)
 * are not JSON; parsing them blindly threw a SyntaxError whose English
 * message ended up in the UI, so non-JSON bodies map to a Korean message.
 */
export async function readJson<T extends object>(response: Response): Promise<T & { error?: string }> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (parsed && typeof parsed === "object") {
        const body = parsed as T & { error?: string; reference?: string };
        // A server failure carries a reference that is also in the log line;
        // showing its prefix lets the student quote it when asking for help.
        if (body.error && typeof body.reference === "string" && body.reference) {
          body.error = `${body.error} (오류 코드 ${body.reference.slice(0, 8)})`;
        }
        return body;
      }
    } catch {
      // A truncated or malformed body falls through to the status-based message.
    }
  }
  return (response.ok ? {} : { error: fallbackErrorByStatus(response.status) }) as T & { error?: string };
}

/** The CSS rule for reduced motion cannot reach JavaScript-initiated scrolls. */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Poll spacing: the base delay, doubled per consecutive failure, capped at five minutes. */
export function browserPoll(run: (signal: AbortSignal) => Promise<unknown>, base: number) {
  return startPolling({run,base,hidden:()=>document.hidden,
    subscribe:(wake)=>{document.addEventListener("visibilitychange",wake);return()=>document.removeEventListener("visibilitychange",wake);},
    setTimer:(task,delay)=>window.setTimeout(task,delay),clearTimer:(id)=>window.clearTimeout(id)});
}

export const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useDialogLifecycle(
  dialogRef: { current: HTMLElement | null },
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const { overflow: previousOverflow, position: previousPosition, top: previousTop, width: previousWidth } = document.body.style;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    // iOS Safari ignores overflow: hidden for touch scrolling; pinning the body
    // at the current scroll offset is what actually stops the feed behind the
    // sheet from moving.
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(dialogFocusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape during Korean/Japanese IME composition cancels the candidate,
      // not the dialog; closing here would discard the chat draft.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector))
        .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
      previouslyFocused?.focus();
    };
  }, [dialogRef]);
}

export function timeLeft(timestamp: number, now: number) {
  const total = Math.max(0, Math.ceil((timestamp - now) / 60000));
  return total <= 0 ? "마감" : `${total}분 후 마감`;
}
