/** @template {{id:string,created_at:number}} T @param {T[]} previous @param {T[]} incoming */
export function mergeMessages(previous,incoming) {
  const byId=new Map(previous.map(message=>[message.id,message]));
  for(const message of incoming)byId.set(message.id,message);
  return [...byId.values()].sort((a,b)=>a.created_at-b.created_at || a.id.localeCompare(b.id));
}
/** @param {Set<string>|null} known @param {{id:string}[]} incoming */
export function newMessageCount(known,incoming){
  return known ? incoming.filter(message=>!known.has(message.id)).length : 0;
}
