"use client";

import { useEffect, useRef, useState } from "react";
import { pickupPoints, type PickupPoint } from "../catalog";

export function LocationPicker({
  currentPickup,
  onSelect,
  compact = false,
}: {
  currentPickup: string;
  onSelect: (point: PickupPoint) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const point = pickupPoints.find((item) => item.id === currentPickup) || pickupPoints[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`location-card ${compact ? "compact" : ""}`} ref={rootRef}>
      {!compact && <span>현재 위치</span>}
      <button
        type="button"
        className="location-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={compact ? "mobile-location-options" : "desktop-location-options"}
        ref={triggerRef}
      >
        <i aria-hidden="true" />
        <span>{compact ? point.code ?? point.id : `DGIST ${point.code ?? point.id}`}</span>
        <b aria-hidden="true">{open ? "⌃" : "⌄"}</b>
      </button>
      {open && (
        <div
          className="location-menu"
          id={compact ? "mobile-location-options" : "desktop-location-options"}
          aria-label="현재 위치 선택"
        >
          {pickupPoints.map((item) => (
            <button
              type="button"
              className={`location-option ${currentPickup === item.id ? "active" : ""}`}
              onClick={() => {
                onSelect(item);
                setOpen(false);
              }}
              aria-pressed={currentPickup === item.id}
              key={item.id}
            >
              <span className="location-code">{item.code ?? item.id}</span>
              <span><strong>{item.full}</strong><small>도보 기준 {item.walk}분</small></span>
              <b aria-hidden="true">{currentPickup === item.id ? "✓" : ""}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
