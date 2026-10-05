"use client";

import { useEffect, useState } from "react";
import { pickupPoints, currentPickupStorageKey } from "../catalog";

/**
 * The pickup point this device considers "here". Restored from localStorage
 * after mount (so the server and first client render agree), then persisted
 * on every change.
 */
export function useCurrentPickup() {
  const [currentPickup, setCurrentPickup] = useState("E3");
  const [locationReady, setLocationReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let savedPickup: string | null = null;
      try {
        savedPickup = window.localStorage.getItem(currentPickupStorageKey);
      } catch {
        // Fall back to the default pickup point when storage is unavailable.
      }
      if (savedPickup && pickupPoints.some((point) => point.id === savedPickup)) {
        setCurrentPickup(savedPickup);
      }
      setLocationReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (locationReady) {
      try {
        window.localStorage.setItem(currentPickupStorageKey, currentPickup);
      } catch {
        // A quota or security error must not unmount the app.
      }
    }
  }, [currentPickup, locationReady]);

  return [currentPickup, setCurrentPickup] as const;
}
