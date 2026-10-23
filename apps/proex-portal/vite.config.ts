import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig, type UserConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

// Alvo Node (Vercel via api/index.mjs, VPS ou servidor próprio com `vinext start`): o mesmo app, com
// `cloudflare:workers` substituído por platform-node/env.ts (SQLite persistido em
// Postgres ou disco). O alvo padrão continua sendo Cloudflare/Sites.
const nodeTarget = process.env.PROEX_TARGET === "node" || process.env.VERCEL === "1";

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  configureToolEnvironment(process.cwd());
  if (nodeTarget) {
    const nodeEnv = fileURLToPath(new URL("./platform-node/env.ts", import.meta.url));
    return {
      ...(process.env.PROEX_DEBUG_BUILD === "1" ? { build: { minify: false } } : {}),
      // Servidor autocontido: só react, react-dom e ipaddr.js ficam externos (o vinext exige).
      ssr: { noExternal: true },
      environments: { rsc: { resolve: { noExternal: true } }, ssr: { resolve: { noExternal: true } } },
      // O resolvedor de CSS do alvo Node não aplica a condição "style" dos pacotes.
      resolve: {
        alias: [
          { find: /^tailwindcss$/, replacement: fileURLToPath(new URL("./node_modules/tailwindcss/index.css", import.meta.url)) },
          { find: /^tw-animate-css$/, replacement: fileURLToPath(new URL("./node_modules/tw-animate-css/dist/tw-animate.css", import.meta.url)) },
        ],
      },
      plugins: [
        { name: "proex-node-env", enforce: "pre" as const, resolveId: (id: string) => (id === "cloudflare:workers" ? nodeEnv : null) },
        vinext(),
      ],
    };
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
