import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { exchangeFacebookBusinessCode } from "@/lib/instagram/instagram.functions";

export const Route = createFileRoute("/instagram/facebook-callback")({
  component: FacebookInstagramCallbackPage,
});

function FacebookInstagramCallbackPage() {
  const [state, setState] = useState<"working" | "success" | "error">("working");
  const [connection, setConnection] = useState<{ pageId: string; pageName?: string; instagramUserId: string; instagramUsername?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error_description") || params.get("error_message");
    const oauthState = params.get("state");

    if (oauthError) {
      setError(oauthError);
      setState("error");
      return;
    }
    if (!code || !oauthState) {
      setError("Meta ने authorization code/state नहीं भेजा।");
      setState("error");
      return;
    }

    exchangeFacebookBusinessCode({ data: { code, state: oauthState } })
      .then((result) => {
        setConnection(result);
        setState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Facebook Business token exchange failed");
        setState("error");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Instagram Discovery Connect</h1>
        {state === "working" && <p className="mt-3 text-sm text-muted-foreground">Meta authorization verify हो रहा है…</p>}
        {state === "error" && (
          <>
            <p className="mt-3 text-sm text-destructive">{error}</p>
            <Link className="mt-4 inline-block text-sm underline" to="/">Rain Map पर वापस जाएँ</Link>
          </>
        )}
        {state === "success" && connection && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold">✅ Meta connection सफल है</p>
            <p className="text-sm">Page: {connection.pageName || connection.pageId}</p>
            <p className="text-sm">Instagram ID: {connection.instagramUserId}</p>
            <p className="text-sm">Username: {connection.instagramUsername || "—"}</p>
            <p className="text-xs text-muted-foreground">Access token server-side सुरक्षित रखा गया है; browser को token नहीं भेजा गया। अब यही connection hashtag-based rain discovery में इस्तेमाल किया जा सकता है।</p>
            <Link className="block text-center text-sm underline" to="/">Rain Map पर वापस जाएँ</Link>
          </div>
        )}
      </section>
    </main>
  );
}
