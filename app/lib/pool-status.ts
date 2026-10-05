import type { Pool } from "../types";

/** Won still missing before the pool reaches its minimum order amount. */
export const remainingAmount = (pool: Pool) => Math.max(0, pool.target - pool.total);

export const isReady = (pool: Pool) => remainingAmount(pool) === 0;

/** A viewer who is not already in the room cannot join past its capacity. */
export const isFull = (pool: Pool) => !pool.isHost && pool.myStatus !== "approved" && pool.people >= pool.capacity;

export const isClosed = (pool: Pool, now: number) => pool.closesAt <= now;

export type JoinStatus = "host" | "approved" | "requested" | "full" | "rejected" | "ready" | "open";

/**
 * The join-action ladder shared by the pool dialog and the campus map, in
 * the order those decide: membership first, then capacity, then the viewer's
 * last answer from the host, then whether the pool can already order.
 */
export function joinStatus(pool: Pool): JoinStatus {
  if (pool.isHost) return "host";
  if (pool.myStatus === "approved") return "approved";
  if (pool.myStatus === "requested") return "requested";
  if (isFull(pool)) return "full";
  if (pool.myStatus === "rejected") return "rejected";
  if (isReady(pool)) return "ready";
  return "open";
}

/** Open pools per pickup point, for the map markers. */
export function poolCounts(pools: Pool[]) {
  return pools.reduce<Record<string, number>>((counts, pool) => {
    counts[pool.pickup] = (counts[pool.pickup] || 0) + 1;
    return counts;
  }, {});
}

/**
 * Merges rows by id: an incoming row replaces a previous one in place, new
 * rows append in order. Used wherever a refresh or a history page meets the
 * rows already on screen.
 */
export function mergeById<T extends { id: string }>(previous: T[], incoming: T[]) {
  return [...new Map([...previous, ...incoming].map((row) => [row.id, row] as const)).values()];
}
