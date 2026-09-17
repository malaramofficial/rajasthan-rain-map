import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { verifyConfiguredInstagramToken } from "@/lib/instagram/instagram.functions";

type Result = Awaited<ReturnType<typeof verifyConfiguredInstagramToken>>;

export const Route = createFileRoute("/instagram/token-test")({
  component: InstagramTokenTestPage,
});

function InstagramTokenTestPage() {
  const [state, setState] = useState<"checking" | "done">("checking");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    verifyConfiguredInstagramToken()
      .then((value) => {
        setResult(value);
        setState("done");
      })
      .catch((error) => {
        setResult({
          configured: true,
          valid: false,
          error: error instanceof Error ? error.message : "Token test failed.",
        });
        setState("done");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Instagram Token Test</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Token server-side रखा गया है। यहाँ token value कभी दिखाई नहीं जाएगी।
        </p>

        {state === "checking" && (
          <p className="mt-6 text-sm">Instagram API से token verify हो रहा है…</p>
        )}

        {state === "done" && result?.valid && (
          <div className="mt-6 space-y-2 rounded-xl border p-4">
            <p className="text-sm font-semibold">✅ Token valid है</p>
            <p className="text-sm">Instagram ID: {result.userId}</p>
            <p className="text-sm">Username: {result.username || "—"}</p>
          </div>
        )}

        {state === "done" && !result?.valid && (
          <div className="mt-6 space-y-2 rounded-xl border p-4">
            <p className="text-sm font-semibold">❌ Token verify नहीं हुआ</p>
            <p className="break-words text-sm text-destructive">
              {result?.error || "Unknown error"}
            </p>
          </div>
        )}

        <Link className="mt-6 inline-block text-sm underline" to="/">
          Rain Map पर वापस जाएँ
        </Link>
      </section>
    </main>
  );
}
