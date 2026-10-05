import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next. Its own list ignores
  // build/** (a CRA output directory name), but here build/ holds source
  // (the Sites Vite plugin), so it is explicitly re-included.
  globalIgnores([
    ".next/**",
    "out/**",
    "test-results/**",
    "playwright-report/**",
    // Agent worktrees live under .claude/ and carry their own dist/node_modules.
    ".claude/**",
    "next-env.d.ts",
    "!build/**",
  ]),
]);

export default eslintConfig;
