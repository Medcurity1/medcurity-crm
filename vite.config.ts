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
        // them; react/query/dnd/supabase are shared app-wide. clsx and
        // react-dom are claimed by vendor-react on purpose (the checks below
        // run in order, first match wins) so they don't leak into
        // vendor-charts (imported only by the lazy chart route chunks, not by
        // App — leaking clsx into it would make every clsx importer pull
        // recharts eagerly) or the cache-busted entry chunk.
        //
        // WHY A FUNCTION AND NOT THE OBJECT MAP THIS USED TO BE: the object
        // form resolves each listed specifier with no importer, so it only
        // works for packages with a legacy main/module field. Every
        // @supabase/* package is exports-map-only, so `"vendor-supabase":
        // ["@supabase/supabase-js"]` resolved to nothing, was silently
        // skipped (no warning), and the SDK stayed in App — measured: App
        // byte-identical at 578.3KB either way. Matching on the resolved
        // node_modules path sidesteps resolution entirely. The port was
        // verified chunk-by-chunk against the previous object map: xlsx
        // and dnd came out byte-identical, charts identical in size, react
        // +0.8KB, exceljs +0.5KB, query −0.7KB — pure bookkeeping.
        //
        // vendor-supabase is the point of the change: ~190KB of SDK that
        // never changes between our deploys used to live inside the
        // cache-busted App chunk, so every deploy renamed it and forced
        // every client to re-download the lot. App: 578.3KB → 388.4KB.
        //
        // NOT pinned: radix-ui / cmdk / sonner. `radix-ui` is a barrel over
        // ~30 separate @radix-ui/react-* directories, so pinning it means
        // enumerating and re-enumerating them as components are added — a
        // maintenance trap for a much smaller win.
        manualChunks(id) {
          if (!id.includes("node_modules/")) return undefined;
          const inPkg = (name: string) => id.includes(`node_modules/${name}/`);
          if (
            inPkg("react") ||
            inPkg("react-dom") ||
            inPkg("clsx") ||
            inPkg("react-router-dom")
          ) {
            return "vendor-react";
          }
          if (inPkg("@tanstack/react-query")) return "vendor-query";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (inPkg("recharts")) return "vendor-charts";
          if (inPkg("xlsx")) return "vendor-xlsx";
          if (inPkg("exceljs")) return "vendor-exceljs";
          if (id.includes("node_modules/@dnd-kit/")) return "vendor-dnd";
          return undefined;
        },
      },
    },
  },
});
