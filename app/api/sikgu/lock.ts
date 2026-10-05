import { env } from "cloudflare:workers";
import { token } from "./responses";
import { mutationLockTimeoutMs } from "./shared";

export async function acquireRoomMutation(
  id: string,
  email: string,
  mode: "update" | "delete",
) {
  const mutationToken = token();
  const now = Date.now();
  const staleBefore = now - mutationLockTimeoutMs;
  const result = mode === "delete"
    ? await env.DB.prepare(`
        UPDATE rooms
        SET status = 'deleting', mutation_token = ?, mutation_started_at = ?
        WHERE id = ? AND host_email = ?
          AND (
            (
              status = 'open'
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
      `).bind(mutationToken, now, id, email, staleBefore, staleBefore).run()
    : await env.DB.prepare(`
        UPDATE rooms
        SET mutation_token = ?, mutation_started_at = ?
        WHERE id = ? AND host_email = ? AND status = 'open'
          AND (
            mutation_token IS NULL
            OR mutation_started_at IS NULL
            OR mutation_started_at < ?
          )
      `).bind(mutationToken, now, id, email, staleBefore).run();
  return result.meta.changes ? mutationToken : null;
}

export async function releaseRoomMutation(id: string, email: string, mutationToken: string) {
  await env.DB.prepare(`
    UPDATE rooms
    SET status = 'open', mutation_token = NULL, mutation_started_at = NULL
    WHERE id = ? AND host_email = ? AND mutation_token = ?
  `).bind(id, email, mutationToken).run();
}
