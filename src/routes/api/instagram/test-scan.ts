import { createFileRoute } from "@tanstack/react-router";
import { runInstagramCandidateIngestion } from "@/lib/instagram/instagram-ingest.functions";

const TEST_KEY = "RRMAP-TEST-2026-09-18-7Q4P9K2M";

export const Route = createFileRoute("/api/instagram/test-scan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = new URL(request.url).searchParams.get("key");
        if (key !== TEST_KEY) {
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
          return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), {
            status: 500,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
