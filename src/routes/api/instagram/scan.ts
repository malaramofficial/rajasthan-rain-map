import { createFileRoute } from "@tanstack/react-router";

import { runInstagramCandidateIngestion } from "@/lib/instagram/instagram-ingest.functions";

export const Route = createFileRoute("/api/instagram/scan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expectedSecret = process.env["CRON_SECRET"];
        const authorization = request.headers.get("authorization");

        if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        try {
          const result = await runInstagramCandidateIngestion();
          return new Response(JSON.stringify(result), {
            status: result.ok ? 200 : 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          console.error("Instagram scheduled scan failed", error);
          return new Response(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Instagram scan failed",
            }),
            {
              status: 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            },
          );
        }
      },
    },
  },
});
