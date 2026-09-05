import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async generateBundle(_options, bundle) {
      // Exact module provenance for each emitted chunk, including explicit
      // external imports. This is stronger dependency evidence than grepping
      // minified function names, which can change or disappear.
      const chunks = Object.values(bundle).filter(item => item.type === "chunk").map(chunk => ({
        file: chunk.fileName,
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
        modules: Object.keys(chunk.modules).map(id => id.replaceAll(root, "<project>").replaceAll("\u0000", "")).sort(),
      }));
      const evidence = resolve(root, "verification");
      await mkdir(evidence, {recursive:true});
      await writeFile(resolve(evidence, `modules-${this.environment.name}.json`), JSON.stringify(chunks,null,2)+"\n");
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
