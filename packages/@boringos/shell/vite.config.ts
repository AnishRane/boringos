import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    host: "0.0.0.0",
    allowedHosts: ["shell.boringos.dev"],
    proxy: {
      "/api": {
        target: process.env.BORINGOS_API_TARGET ?? "http://localhost:3030",
        changeOrigin: true,
      },
      // task_22 U4.5 — runtime-loaded module UIs live at
      // /modules/<id>/ui/<rest> on the framework. Proxy in dev so
      // `import("/modules/<id>/ui/index.mjs")` from the shell
      // reaches the host. The bare `/modules` SPA route (Apps
      // screen) is NOT proxied — only `/modules/<id>/ui/*` is.
      "^/modules/[^/]+/ui/.*": {
        target: process.env.BORINGOS_API_TARGET ?? "http://localhost:3030",
        changeOrigin: true,
      },
    },
  },
});
