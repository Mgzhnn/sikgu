const storageKey = 'sikgu-pending-invite';
/** @param {unknown} value @param {number} now */
export function validPendingInvite(value, now) {
  if (!value || typeof value !== 'object') return null;
  const entry = /** @type {{roomId?:unknown,token?:unknown,createdAt?:unknown}} */ (value);
  if (typeof entry.roomId !== 'string' || !/^room_[\w-]{1,100}$/.test(entry.roomId)
    || typeof entry.token !== 'string' || !/^[a-f0-9]{48}$/.test(entry.token)
    || typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)
    || entry.createdAt > now || now - entry.createdAt >= 60 * 60 * 1000) return null;
  return {roomId: entry.roomId, token: entry.token, createdAt: entry.createdAt};
}
/** @param {Storage|null} storage */
export function clearPendingInvite(storage) {
  try { storage?.removeItem(storageKey); } catch { /* Storage can be disabled. */ }
}
/** Capture and scrub before any network await. Storage is only a continuation,
 * never authorization; the signed-in user must explicitly accept the invitation.
 * @param {Location} location @param {History} history @param {Storage|null} storage @param {number} now
 */
export function capturePendingInvite(location, history, storage, now) {
  const params = new URLSearchParams(location.search);
  if (params.has('invite')) {
    const candidate = validPendingInvite({roomId:params.get('room'),token:params.get('invite'),createdAt:now},now);
    params.delete('invite'); params.delete('room');
    history.replaceState({},'',location.pathname + (params.size ? `?${params}` : '') + location.hash);
    if (candidate) { try { storage?.setItem(storageKey,JSON.stringify(candidate)); } catch { /* Keep in memory. */ } }
    return candidate;
  }
  try {
    const candidate = validPendingInvite(JSON.parse(storage?.getItem(storageKey) || 'null'),now);
    if (!candidate) clearPendingInvite(storage);
    return candidate;
  } catch { return null; }
}
