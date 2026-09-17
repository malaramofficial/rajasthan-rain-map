import { useState } from "react";

import { getFacebookBusinessAuthorizeUrl, getInstagramAuthorizeUrl } from "@/lib/instagram/instagram.functions";

export default function InstagramConnect() {
  const [loading, setLoading] = useState<"business" | "instagram" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function connectBusiness() {
    setLoading("business");
    setMessage(null);
    try {
      const result = await getFacebookBusinessAuthorizeUrl();
      if (!result.url) {
        setMessage(result.error ?? "Facebook Business Login अभी configure नहीं है।");
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Facebook Business Login शुरू नहीं हो पाया।");
    } finally {
      setLoading(null);
    }
  }

  async function connectInstagram() {
    setLoading("instagram");
    setMessage(null);
    try {
      const result = await getInstagramAuthorizeUrl();
      if (!result.url) {
        setMessage("Instagram Connect अभी configure नहीं है।");
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Instagram Connect शुरू नहीं हो पाया।");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="pointer-events-auto absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1000] flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-1">
      <button
        type="button"
        onClick={connectBusiness}
        disabled={loading !== null}
        className="rounded-full bg-card/90 px-3 py-2 text-xs font-semibold text-foreground shadow-sm backdrop-blur-sm disabled:opacity-60"
      >
        {loading === "business" ? "Connecting…" : "Instagram Discovery Connect"}
      </button>
      <button
        type="button"
        onClick={connectInstagram}
        disabled={loading !== null}
        className="rounded-full bg-card/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm disabled:opacity-60"
      >
        {loading === "instagram" ? "Connecting…" : "Instagram Login"}
      </button>
      {message && (
        <p className="max-w-[300px] rounded-lg bg-card/95 px-3 py-2 text-right text-[11px] text-muted-foreground shadow-sm">
          {message}
        </p>
      )}
    </div>
  );
}
