import { createFileRoute } from "@tanstack/react-router";

import { runInstagramCandidateIngestion } from "@/lib/instagram/instagram-ingest.functions";
import { runWorkerReelIngestion, type WorkerReelInput } from "@/lib/instagram/worker-ingest.functions";

function authorized(request: Request): boolean {
  const expectedSecret = process.env["CRON_SECRET"];
  const authorization = request.headers.get("authorization");
  return Boolean(expectedSecret && authorization === `Bearer ${expectedSecret}`);
}

export const Route = createFileRoute("/api/instagram/scan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        try {
          const result = await runInstagramCandidateIngestion();
          return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        } catch (error) {
          console.error("Instagram scheduled scan failed", error);
          return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Instagram scan failed" }), { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
      },
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        try {
          const body = (await request.json()) as { media?: WorkerReelInput[] };
          if (!Array.isArray(body.media)) return new Response(JSON.stringify({ ok: false, error: "media array is required" }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store" } });
          const result = await runWorkerReelIngestion(body.media);
          return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        } catch (error) {
          console.error("Instagram worker ingestion failed", error);
          return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Instagram worker ingestion failed" }), { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
      },
    },
  },
});
