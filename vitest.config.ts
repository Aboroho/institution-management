import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/tests/unit/**/*.test.ts", "src/tests/integration/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
