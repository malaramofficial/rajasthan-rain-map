import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

import { getPublicRainSnapshot } from "@/lib/rain/rain.functions";

const RainMap = lazy(() => import("@/components/map/RainMap"));

export const Route = createFileRoute("/")({
  loader: () => getPublicRainSnapshot(),
  head: () => ({
    meta: [
      { title: "Rajasthan Rain Map — Live Rain Status by District" },
      {
        name: "description",
        content:
          "A clean full-screen map showing where it is raining across Rajasthan, district by district.",
      },
      { property: "og:title", content: "Rajasthan Rain Map" },
      {
        property: "og:description",
        content: "See where it is raining across Rajasthan on one simple map.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RainMapPage,
});

function formatUpdated(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function RainMapPage() {
  const snapshot = Route.useLoaderData();

  useEffect(() => {
    const refresh = window.setInterval(() => window.location.reload(), 5 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, []);

  return (
    <main className="fixed inset-0 overflow-hidden bg-background">
      <h1 className="sr-only">Rajasthan Rain Map</h1>

      <ClientOnly fallback={<div className="h-full w-full bg-muted" />}>
        <Suspense fallback={<div className="h-full w-full bg-muted" />}>
          <RainMap snapshot={snapshot} />
        </Suspense>
      </ClientOnly>


      <p
        className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-card/85 px-3 py-1 text-[11px] font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm"
        aria-live="polite"
      >
        Updated {formatUpdated(snapshot.updated_at)}
      </p>
    </main>
  );
}
