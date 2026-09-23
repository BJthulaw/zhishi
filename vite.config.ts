import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  test: { include: ["**/*.test.ts"] },
});
