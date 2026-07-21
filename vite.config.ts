import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// Build identity: the CI commit sha on deploys, a per-build local id
// otherwise. Stamped into the bundle (__BUILD_ID__), into index.html's
// inline boot-recovery script (%%BUILD_ID%%), and emitted as /version.json
// so a running client can ask "is there a newer build than me?".
const buildId =
  (process.env.GITHUB_SHA || "").slice(0, 12) ||
  `local-${Date.now().toString(36)}`;

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "build-version",
      transformIndexHtml(html) {
        return html.replace(/%%BUILD_ID%%/g, buildId);
      },
      writeBundle() {
        fs.writeFileSync(
          path.resolve(__dirname, "dist/version.json"),
          JSON.stringify({ build: buildId }),
        );
      },
    },
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
        // leak into vendor-charts (imported only by the lazy chart route
        // chunks, not by App — leaking clsx into it would make every clsx
        // importer pull recharts eagerly) or the cache-busted entry chunk.
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
