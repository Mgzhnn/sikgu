import { readJson, redirectToSignIn } from "../room-ui";

type MutationResult = { signInPath?: string; roomId?: string; token?: string; expiresAt?: number };

/**
 * One mutation path for the page and the room sheet. It carries the
 * same-origin request header the server requires, and an expired session
 * (401) sends the browser to sign-in from every caller alike.
 */
export async function apiPost<T extends object = MutationResult>(payload: Record<string, unknown>) {
  const response = await fetch("/api/sikgu", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sikgu-request": "1" },
    body: JSON.stringify(payload),
  });
  const data = await readJson<T>(response);
  if (response.status === 401) {
    redirectToSignIn();
    throw new Error("로그인이 필요합니다.");
  }
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어요.");
  return data;
}

/**
 * A read of the feed or a room. The response is handed back with the body:
 * a feed load throws on failure, while a room poll tells a deleted room apart
 * from a removed member before deciding.
 */
export async function apiGet<T extends object>(query: string, signal?: AbortSignal) {
  const response = await fetch(`/api/sikgu?${query}`, { cache: "no-store", signal });
  const data = await readJson<T>(response);
  return { response, data };
}
