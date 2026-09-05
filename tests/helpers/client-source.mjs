// Adapter for historical structural assertions after feature extraction.
// It reads real source files; no mock implementation is substituted. Repaired
// behaviors are verified independently by SQLite, timer and browser tests.
import {readFile} from "node:fs/promises";
export async function readClientSource() {
  const root=new URL("../../app/",import.meta.url);
  const [page,types,ui,catalog,mark,hub]=await Promise.all(["page.tsx","types.ts","room-ui.tsx","catalog.ts","restaurant-mark.tsx","room-hub.tsx"].map(file=>readFile(new URL(file,root),"utf8")));
  return types+ui+catalog+page.replace("function Progress(",mark+"\nfunction Progress(").replace("function CreateModal(",hub+"\nfunction CreateModal(");
}
