import { env } from "cloudflare:workers";
import { token } from "./responses";
import { listReceiptKeysForRoom } from "./receipts";
import { mutationLockTimeoutMs, recentRoomWindowMs, uploadBucket, withD1ReadRetry } from "./shared";

let lastRetentionSweep = 0;
let retentionSweepInFlight: Promise<void> | null = null;

export async function purgeExpiredRooms(now: number) {
  if (now - lastRetentionSweep < 60 * 60 * 1000) return;
  if (retentionSweepInFlight) return retentionSweepInFlight;
  retentionSweepInFlight = (async () => {
    const metrics = {event:"retention_sweep", selected:0, claimed:0, deleted:0, failed:0};
    const started = Date.now();
    try {
      const staleBefore = now - mutationLockTimeoutMs;
      const candidates = await withD1ReadRetry(() => env.DB.prepare(`
        SELECT id
        FROM rooms
        WHERE (
          closes_at < ?
          AND status = 'open'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
        )
        OR (
          status = 'deleting'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
        )
        ORDER BY CASE status WHEN 'deleting' THEN 0 ELSE 1 END, closes_at ASC
        LIMIT 50
      `).bind(
        now - recentRoomWindowMs,
        staleBefore,
        staleBefore,
      ).all<{ id: string }>());

      metrics.selected = candidates.results.length;
      if (candidates.results.length) {
        const candidateIds = candidates.results.map((room) => room.id);
        const placeholders = candidateIds.map(() => "?").join(", ");
        const sweepToken = token();
        await env.DB.prepare(`
          UPDATE rooms
          SET status = 'deleting', mutation_token = ?, mutation_started_at = ?
          WHERE id IN (${placeholders})
            AND (
              (
                closes_at < ?
                AND status = 'open'
                AND (
                  mutation_token IS NULL
                  OR mutation_started_at IS NULL
                  OR mutation_started_at < ?
                )
              )
              OR (
                status = 'deleting'
                AND (
                  mutation_token IS NULL
                  OR mutation_started_at IS NULL
                  OR mutation_started_at < ?
                )
              )
            )
        `).bind(
          sweepToken,
          now,
          ...candidateIds,
          now - recentRoomWindowMs,
          staleBefore,
          staleBefore,
        ).run();
        const claimed = await withD1ReadRetry(() => env.DB.prepare(`
          SELECT id, receipt_key
          FROM rooms
          WHERE status = 'deleting' AND mutation_token = ?
          ORDER BY closes_at ASC
        `).bind(sweepToken).all<{ id: string; receipt_key: string | null }>());
        metrics.claimed = claimed.results.length;
        if (!claimed.results.length) return;

        // One room at a time, committing each deletion as soon as its objects
        // are gone: a single storage error then defers only that room instead
        // of the whole claimed batch, and a subrequest budget cuts the sweep
        // short without losing the progress made so far.
        const bucket = uploadBucket();
        for (const room of claimed.results) {
          try {
            const receiptKeys = await listReceiptKeysForRoom(bucket, room.id, room.receipt_key, true);
            for (let offset = 0; offset < receiptKeys.length; offset += 1000) {
              await bucket.delete(receiptKeys.slice(offset, offset + 1000));
            }
          } catch (error) {
            metrics.failed++;
            console.error("Deferred stale receipt cleanup", error);
            // Keep this room hidden. A later sweep can safely reclaim the stale
            // deletion token without resurrecting a partially cleaned room.
            continue;
          }
          try {
            // All private room tables use ON DELETE CASCADE in the production schema.
            const deleted = await env.DB.prepare(`
              DELETE FROM rooms
              WHERE id = ? AND status = 'deleting' AND mutation_token = ?
            `).bind(room.id, sweepToken).run();
            metrics.deleted += deleted.meta.changes;
          } catch (error) {
            metrics.failed++;
            console.error("Deferred stale room cleanup", error);
            // Leave the tombstone claimed; ambiguous D1 outcomes are retried later.
          }
        }
      }
    } finally {
      // Back off even after a storage outage so new visitors do not start a cleanup storm.
      lastRetentionSweep = Date.now();
      try {
        const backlog = await env.DB.prepare(`
          SELECT COUNT(*) AS pending, MIN(closes_at) AS oldest_deadline
          FROM rooms WHERE (status = 'open' AND closes_at < ?) OR status = 'deleting'
        `).bind(now - recentRoomWindowMs).first<{pending:number;oldest_deadline:number|null}>();
        console.info(JSON.stringify({...metrics, durationMs:Date.now()-started,
          pending:backlog?.pending ?? 0,
          oldestOverdueMs:backlog?.oldest_deadline == null ? 0 : Math.max(0,now-recentRoomWindowMs-backlog.oldest_deadline)}));
      } catch {
        console.error(JSON.stringify({...metrics, durationMs:Date.now()-started, backlog:"unavailable"}));
      }
    }
  })();
  try {
    await retentionSweepInFlight;
  } finally {
    retentionSweepInFlight = null;
  }
}
