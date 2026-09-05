export class InvalidCursorError extends Error {}
export function decodeCursor(raw: string | null): {value:number;id:string} | null {
  if (!raw) return null;
  try {
    if (raw.length > 512) throw new Error();
    const value: unknown = JSON.parse(atob(raw));
    if (!value || typeof value !== 'object') throw new Error();
    const cursor = value as {value:number;id:string};
    if (!Number.isSafeInteger(cursor.value) || typeof cursor.id !== 'string'
      || !/^[\w-]{1,128}$/.test(cursor.id)) throw new Error();
    return cursor;
  } catch { throw new InvalidCursorError('페이지 정보를 확인해주세요.'); }
}
export function encodeCursor(row: Record<string,unknown> | undefined, column = 'created_at') {
  return row ? btoa(JSON.stringify({value:Number(row[column]),id:String(row.id)})) : null;
}
export function cursorWhere(cursor: ReturnType<typeof decodeCursor>, column: string, direction: 'ASC'|'DESC') {
  const op=direction==='DESC'?'<':'>';
  return cursor ? {sql:` AND (${column} ${op} ? OR (${column} = ? AND r.id ${op} ?))`,bind:[cursor.value,cursor.value,cursor.id]} : {sql:'',bind:[]};
}
