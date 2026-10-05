import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base relativa: funciona en GitHub Pages (https://usuario.github.io/repo/) y en local.
// La app usa HashRouter, así que no necesita reescrituras de rutas en el servidor.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
