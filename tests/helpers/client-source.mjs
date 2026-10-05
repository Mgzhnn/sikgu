// Adapter for historical structural assertions after feature extraction.
// It reads real source files; no mock implementation is substituted. Repaired
// behaviors are verified independently by SQLite, timer and browser tests.
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
export async function readClientSource() {
  const root=new URL("../../app/",import.meta.url);
  const [page,types,ui,catalog,mark,hub]=await Promise.all(["page.tsx","types.ts","room-ui.tsx","catalog.ts","restaurant-mark.tsx","room-hub.tsx"].map(file=>readFile(new URL(file,root),"utf8")));
  // The splice anchors must exist: a silent no-op here would hand every
  // downstream assertion a different document than it expects.
  for (const anchor of ["function Progress(", "function CreateModal("]) {
    assert.ok(page.includes(anchor), `client-source splice anchor missing from page.tsx: ${anchor}`);
  }
  return types+ui+catalog+page.replace("function Progress(",mark+"\nfunction Progress(").replace("function CreateModal(",hub+"\nfunction CreateModal(");
}
