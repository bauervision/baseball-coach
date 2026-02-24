// app/player/page.tsx
import * as React from "react";
import PlayerPageClient from "./PlayerPageClient";

export default function PlayerPage() {
  return (
    <React.Suspense
      fallback={
        <div
          className="rounded-2xl border p-4"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
            background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
            color: "var(--muted)",
          }}
        >
          Loading player…
        </div>
      }
    >
      <PlayerPageClient />
    </React.Suspense>
  );
}