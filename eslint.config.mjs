import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-module files that use CommonJS require():
    "dbsetup.js",
    "coverage/**",
    // Agent worktrees (ephemeral copies, not part of the codebase):
    ".claude/**",
  ]),
  // Test, E2E, and setup files use `any` for legitimate reasons:
  // - Test files: Vitest mock implementations (mocked DB/fetch have unknown return shapes)
  // - auth.ts / prisma/seed.ts / scripts/: NextAuth and Prisma adapter types don't exactly
  //   match their generic signatures; `as any` bridges the gap without unsafe runtime behavior.
  {
    files: [
      "__tests__/**/*.ts",
      "e2e/**/*.ts",
      "auth.ts",
      "prisma/**/*.ts",
      "scripts/**/*.ts",
      "src/lib/db.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // react-hooks/set-state-in-effect is a new strict rule that flags the common
  // fetch-then-setState pattern used throughout this codebase. All flagged calls
  // are inside async handlers (setState runs after await, not synchronously in
  // the effect body), so the rule produces false positives here.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
