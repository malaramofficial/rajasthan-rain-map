import { useState } from "react";

import { getInstagramAuthorizeUrl } from "@/lib/instagram/instagram.functions";

export default function InstagramConnect() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function connect() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await getInstagramAuthorizeUrl();
      if (!result.url) {
        setMessage("Instagram Connect अभी configure नहीं है। Meta App credentials जोड़ने होंगे।");
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Instagram Connect शुरू नहीं हो पाया।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pointer-events-auto absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1000] flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-1">
      <button
        type="button"
        onClick={connect}
        disabled={loading}
        className="rounded-full bg-card/90 px-3 py-2 text-xs font-semibold text-foreground shadow-sm backdrop-blur-sm disabled:opacity-60"
      >
        {loading ? "Connecting…" : "Instagram Connect"}
      </button>
      {message && (
        <p className="max-w-[280px] rounded-lg bg-card/95 px-3 py-2 text-right text-[11px] text-muted-foreground shadow-sm">
          {message}
        </p>
      )}
    </div>
  );
}
