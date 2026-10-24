import { env } from "cloudflare:workers";
import { json } from "./responses";
import { uploadBucket } from "./shared";

/**
 * How long one probe answers every health request in this isolate. The check
 * needs no identity, and each probe costs a D1 query and an R2 list (a billed
 * Class A operation), so an unthrottled loop on the endpoint was a cost
 * amplifier (security review 2026-10-24, F-6). Equal to the Retry-After the
 * failure response advertises.
 */
export const healthCacheMs = 30 * 1000;

type HealthResult = { ok: boolean; database: "ok" | "unavailable"; storage: "ok" | "unavailable" };

// Holds the promise, not the result, so concurrent requests share one probe.
let cached: { at: number; result: Promise<HealthResult> } | null = null;

/** GET ?action=health: liveness plus a one-row D1 round trip and a one-key R2 listing. */
export async function health() {
  const now = Date.now();
  if (!cached || now - cached.at >= healthCacheMs || now < cached.at) {
    cached = { at: now, result: probe() };
  }
  const result = await cached.result;
  return json(result, result.ok ? 200 : 503, result.ok ? {} : { "Retry-After": "30" });
}

/** Forgets the cached probe. Tests swap bindings between probes; the app never calls this. */
export function resetHealthCache() {
  cached = null;
}

// Either dependency failing is a 503 so an uptime monitor sees a broken
// receipt bucket, not only a dead D1. Never rejects.
async function probe(): Promise<HealthResult> {
  let database: HealthResult["database"] = "ok";
  let storage: HealthResult["storage"] = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch (error) {
    database = "unavailable";
    console.error(JSON.stringify({ level: "error", context: "Health check database probe failed", error: String(error) }));
  }
  try {
    await uploadBucket().list({ prefix: "receipts/", limit: 1 });
  } catch (error) {
    storage = "unavailable";
    console.error(JSON.stringify({ level: "error", context: "Health check storage probe failed", error: String(error) }));
  }
  return { ok: database === "ok" && storage === "ok", database, storage };
}
