// The API route is split into feature modules; structural tests read them as
// one document, in a fixed order, so a section() anchor can span a module.
// Each file is preceded by a banner line that tests use as a boundary anchor.
import { readFile } from "node:fs/promises";

export const apiModules = [
  "shared", "lock", "retention", "receipts", "feed", "rooms", "chat",
  "invites", "pagination", "responses", "route",
];

export async function readApiSource() {
  const root = new URL("../../app/api/sikgu/", import.meta.url);
  const sources = await Promise.all(apiModules.map((name) => readFile(new URL(`${name}.ts`, root), "utf8")));
  return sources.map((source, index) => `// ---- app/api/sikgu/${apiModules[index]}.ts ----\n${source}`).join("\n");
}
