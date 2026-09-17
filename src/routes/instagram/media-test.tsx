import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { testInstagramMediaAccess } from "@/lib/instagram/instagram.functions";

type Result = Awaited<ReturnType<typeof testInstagramMediaAccess>>;

export const Route = createFileRoute("/instagram/media-test")({
  component: InstagramMediaTestPage,
});

function InstagramMediaTestPage() {
  const [state, setState] = useState<"checking" | "done">("checking");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    testInstagramMediaAccess()
      .then((value) => {
        setResult(value);
        setState("done");
      })
      .catch((error) => {
        setResult({
          configured: true,
          valid: false,
          mediaEndpoint: "failed",
          error: error instanceof Error ? error.message : "Media capability test failed.",
        });
        setState("done");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Instagram Media Capability Test</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          यह टेस्ट केवल server-side token से Instagram media endpoint की उपलब्धता जाँचता है।
          Token यहाँ कभी नहीं दिखाया जाएगा।
        </p>

        {state === "checking" && (
          <p className="mt-6 text-sm">Instagram media access जाँचा जा रहा है…</p>
        )}

        {state === "done" && result?.mediaEndpoint === "success" && (
          <div className="mt-6 space-y-2 rounded-xl border p-4">
            <p className="text-sm font-semibold">✅ Media endpoint उपलब्ध है</p>
            <p className="text-sm">Token: valid और configured</p>
            <p className="text-sm">पहले 10 media में मिले: {result.mediaCount ?? 0}</p>
            <p className="text-sm">Video/Reel-जैसे media: {result.reelsCount ?? 0}</p>
            <p className="text-sm">Latest timestamp: {result.latestTimestamp || "—"}</p>
          </div>
        )}

        {state === "done" && result?.mediaEndpoint === "failed" && (
          <div className="mt-6 space-y-2 rounded-xl border p-4">
            <p className="text-sm font-semibold">❌ Media endpoint test failed</p>
            <p className="text-sm">
              Server environment: {result.configured ? "configured" : "NOT configured"}
            </p>
            <p className="break-words text-sm text-destructive">
              {result.error || "Unknown error"}
            </p>
          </div>
        )}

        {state === "done" && result?.mediaEndpoint === "not_tested" && (
          <div className="mt-6 rounded-xl border p-4">
            <p className="text-sm font-semibold">⚠️ Test नहीं चला</p>
            <p className="break-words text-sm text-destructive">{result.error}</p>
          </div>
        )}

        <div className="mt-6 flex gap-4 text-sm">
          <Link className="underline" to="/instagram/token-test">
            Token Test
          </Link>
          <Link className="underline" to="/">
            Rain Map
          </Link>
        </div>
      </section>
    </main>
  );
}
