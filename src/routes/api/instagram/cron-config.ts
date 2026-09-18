import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/instagram/cron-config")({
  server: {
    handlers: {
      GET: async () => {
        const configured = Boolean(process.env["CRON_SECRET"]);
        return new Response(
          JSON.stringify({ ok: true, cron_secret_configured: configured, schedule_utc: "0 0 * * *" }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
      },
    },
  },
});
