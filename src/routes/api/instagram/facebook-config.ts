import { createFileRoute } from "@tanstack/react-router";

const REQUIRED_VARS = [
  "META_APP_ID",
  "META_FACEBOOK_CONFIG_ID",
  "META_FACEBOOK_REDIRECT_URI",
  "META_APP_SECRET",
] as const;

function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export const Route = createFileRoute("/api/instagram/facebook-config")({
  server: {
    handlers: {
      GET: async () => {
        const missing = REQUIRED_VARS.filter((name) => !configured(name));
        return new Response(
          JSON.stringify({
            ok: missing.length === 0,
            missing,
            configured: Object.fromEntries(REQUIRED_VARS.map((name) => [name, configured(name)])),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store, max-age=0",
            },
          },
        );
      },
    },
  },
});
