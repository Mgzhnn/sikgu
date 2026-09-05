// Evaluate time inside SQLite, so an RPC waiting in the database queue cannot
// authorize a write using the timestamp of an earlier JavaScript read.
export const databaseNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status,
  headers: {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  },
});

export function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

