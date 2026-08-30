import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars from the repo root (one level up from client/) instead
  // of the default client/.env, since .env lives alongside client/ and
  // server/ at the top of the repo.
  const rootDir = path.resolve(__dirname, "..");
  const env = loadEnv(mode, rootDir, "");

  return {
    plugins: [react()],
    // Re-expose the root .env values as import.meta.env.VITE_* so
    // components can read them the normal Vite way.
    define: {
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(env.GOOGLE_CLIENT_ID),
    },
    server: {
      proxy: {
        "/api": "http://localhost:5000",
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.js"],
      globals: true,
      css: false,
    },
  };
});