import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { exchangeInstagramCode } from "@/lib/instagram/instagram.functions";

export const Route = createFileRoute("/instagram/callback")({
  component: InstagramCallbackPage,
});

function InstagramCallbackPage() {
  const [state, setState] = useState<"working" | "success" | "error">("working");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const oauthError = new URLSearchParams(window.location.search).get("error_description");

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
        setToken(result.accessToken);
        setState("success");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Token exchange failed");
        setState("error");
      });
  }, []);

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Instagram Connect</h1>
        {state === "working" && <p className="mt-3 text-sm text-muted-foreground">Authorization verify हो रहा है…</p>}
        {state === "error" && (
          <>
            <p className="mt-3 text-sm text-destructive">{error}</p>
            <Link className="mt-4 inline-block text-sm underline" to="/">Rain Map पर वापस जाएँ</Link>
          </>
        )}
        {state === "success" && token && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Access token मिला। इसे किसी को share न करें और GitHub/source code में न डालें।
            </p>
            <textarea
              readOnly
              value={token}
              rows={5}
              className="w-full resize-none rounded-lg border bg-muted p-3 font-mono text-xs"
              aria-label="Instagram access token"
            />
            <button
              type="button"
              onClick={copyToken}
              className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
            >
              {copied ? "Copied" : "Copy Token"}
            </button>
            <Link className="block text-center text-sm underline" to="/">Rain Map पर वापस जाएँ</Link>
          </div>
        )}
      </section>
    </main>
  );
}
