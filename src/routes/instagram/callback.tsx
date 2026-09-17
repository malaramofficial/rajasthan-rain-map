import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { exchangeInstagramCode } from "@/lib/instagram/instagram.functions";

export const Route = createFileRoute("/instagram/callback")({
  component: InstagramCallbackPage,
});

function InstagramCallbackPage() {
  const [state, setState] = useState<"working" | "success" | "error">("working");
  const [profile, setProfile] = useState<{ userId: string; username?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const oauthError = params.get("error_description");

    if (oauthError) {
      setError(oauthError);
      setState("error");
      return;
    }

    if (!code) {
      setError("Instagram ने authorization code नहीं भेजा।");
      setState("error");
      return;
    }

    exchangeInstagramCode({ data: { code } })
      .then((result) => {
        setProfile(result);
        setState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Token exchange failed");
        setState("error");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Instagram Connect</h1>
        {state === "working" && (
          <p className="mt-3 text-sm text-muted-foreground">
            Authorization verify हो रहा है…
          </p>
        )}
        {state === "error" && (
          <>
            <p className="mt-3 text-sm text-destructive">{error}</p>
            <Link className="mt-4 inline-block text-sm underline" to="/">
              Rain Map पर वापस जाएँ
            </Link>
          </>
        )}
        {state === "success" && profile && (
          <div className="mt-4 space-y-3">
            <p className="text-sm font-semibold">✅ Instagram authorization सफल है</p>
            <p className="text-sm">Instagram ID: {profile.userId}</p>
            <p className="text-sm">Username: {profile.username || "—"}</p>
            <p className="text-xs text-muted-foreground">
              Access token browser को नहीं भेजा गया।
            </p>
            <Link className="block text-center text-sm underline" to="/">
              Rain Map पर वापस जाएँ
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
