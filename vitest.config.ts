import { defineConfig } from "vitest/config";
import { testEnv } from "./apps/api/test/test-env.ts";

try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch {
  // No .env file (e.g. in CI): the variables must come from the environment itself.
}

const env = testEnv(process.env);
// The global setup runs in this process, so it needs the test values too.
Object.assign(process.env, env);

export default defineConfig({
  test: {
    include: ["apps/*/test/**/*.test.ts"],
    globalSetup: ["apps/api/test/global-setup.ts"],
    env,
    // All test files share one database and queue, so they run one after the other.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});