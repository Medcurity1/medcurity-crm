import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "preload-app-chunk",
      transformIndexHtml: {
        order: "post",
        handler(html, ctx) {
          const app = Object.values(ctx.bundle ?? {}).find(
            (c) => c.type === "chunk" && /^App-/.test((c.fileName.split("/").pop() ?? "")),
          );
          return app
            ? html.replace("</head>", `  <link rel="modulepreload" crossorigin href="/${app.fileName}">\n</head>`)
            : html;
        },
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing libraries into their own cached chunks
        // so they (a) don't bloat the main/app bundle and (b) stay cached across
        // app deploys. recharts/exceljs/xlsx only load with the routes that use
        // them; react/query/dnd are shared app-wide. clsx and react-dom/client
        // are pinned to vendor-react on purpose (object entries are processed
        // in order, so listing vendor-react first claims them) so they don't
        // leak into vendor-charts (eagerly imported by App) or the cache-busted
        // entry chunk.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-dom/client", "clsx", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-charts": ["recharts"],
          "vendor-xlsx": ["xlsx"],
          "vendor-exceljs": ["exceljs"],
          "vendor-dnd": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
        },
      },
    },
  },
});
