// Adapter for historical structural assertions after feature extraction.
// It reads real source files; no mock implementation is substituted. Repaired
// behaviors are verified independently by SQLite, timer and browser tests.
import {readdir, readFile} from "node:fs/promises";

// Every client source file, concatenated in a stable order: the app root,
// then each layer's folder, files sorted by name within a folder. The .mjs
// modules are read by their own tests.
const folders = ["", "lib", "hooks", "components", "views", "modals"];

export async function readClientSource() {
  const root=new URL("../../app/",import.meta.url);
  const files=[];
  for (const folder of folders) {
    const entries=await readdir(new URL(folder ? `${folder}/` : "./",root),{withFileTypes:true});
    const names=entries.filter(entry=>entry.isFile() && /\.tsx?$/.test(entry.name)).map(entry=>entry.name).sort();
    files.push(...names.map(name=>folder ? `${folder}/${name}` : name));
  }
  const sources=await Promise.all(files.map(file=>readFile(new URL(file,root),"utf8")));
  return sources.join("\n");
}
