import { defineConfig } from "vite";

export default defineConfig({
  // Portals (Poki, CrazyGames, itch) serve the build from a subdirectory inside an
  // iframe, so every asset reference must be relative to index.html. The Vite default
  // of "/" produces /assets/... URLs that 404 anywhere but the domain root.
  base: "./",
});
