"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser } from "../types";
import { redirectToSignIn } from "../room-ui";

export type ToastTone = "success" | "error" | "info";

/** Who is signed in, whether the first feed load has settled, and the toast. */
export function useSession() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapState, setBootstrapState] = useState<"loading" | "ready" | "error">("loading");
  const [bootstrapError, setBootstrapError] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((
    message: string,
    tone: ToastTone = "info",
  ) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const signIn = useCallback(() => {
    redirectToSignIn();
  }, []);

  return {
    user,
    setUser,
    bootstrapState,
    setBootstrapState,
    bootstrapError,
    setBootstrapError,
    toast,
    notify,
    signIn,
  };
}

export type Session = ReturnType<typeof useSession>;
