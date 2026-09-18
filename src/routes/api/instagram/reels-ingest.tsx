import { createFileRoute } from "@tanstack/react-router";

type ReelsWorkerMedia = {
  external_post_id: string;
  source_url: string;
  posted_at: string | null;
  caption_text: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  username: string | null;
};

export const Route = createFileRoute("/api/instagram/reels-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedSecret = process.env["REELS_WORKER_SECRET"];
        const authorization = request.headers.get("authorization");

        if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }

        try {
          const body = (await request.json()) as { media?: ReelsWorkerMedia[] };
          const media = Array.isArray(body.media) ? body.media : [];
          const supabaseUrl = process.env["SUPABASE_URL"];
          const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

          if (!supabaseUrl || !serviceRoleKey) {
            return new Response(JSON.stringify({ ok: false, error: "Supabase server configuration is missing." }), {
              status: 500,
              headers: { "content-type": "application/json", "cache-control": "no-store" },
            });
          }

          const recent = media
            .filter((item) => item?.source_url && item?.external_post_id)
            .filter((item) => {
              const posted = item.posted_at ? Date.parse(item.posted_at) : NaN;
              return Number.isFinite(posted) && Date.now() - posted >= 0 && Date.now() - posted <= 24 * 60 * 60 * 1000;
            })
            .slice(0, 100);

          const inserted: string[] = [];
          for (const item of recent) {
            const response = await fetch(`${supabaseUrl}/rest/v1/instagram_rain_evidence?on_conflict=source_url`, {
              method: "POST",
              headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates,return=minimal",
              },
              body: JSON.stringify({
                platform: "instagram",
                external_post_id: item.external_post_id,
                source_url: item.source_url,
                posted_at: item.posted_at,
                caption_text: item.caption_text,
                visual_analysis: "reels_worker_passive_feed_capture",
                location_evidence: item.username ? `instagram_user:${item.username}` : null,
                verification_status: "pending",
                original_or_repost: "unknown",
                updated_at: new Date().toISOString(),
              }),
            });

            if (response.ok) inserted.push(item.external_post_id);
          }

          return new Response(JSON.stringify({
            ok: true,
            received: media.length,
            recent_24h: recent.length,
            inserted: inserted.length,
          }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (error) {
          return new Response(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "Invalid request",
          }), {
            status: 400,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
