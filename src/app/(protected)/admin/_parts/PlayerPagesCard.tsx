"use client";

// Tallies coach area: each player's page (stats, game log, career, awards,
// recognition sheet arrangement and 8×10 print) inside the selected team.

import * as React from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/Card";
import type { Player } from "@/lib/roster";
import { useSeasonLinks } from "@/lib/seasonLinks";

export function PlayerPagesCard(props: { seasonId: string; players: Player[] | null }) {
  const links = useSeasonLinks();
  const list = [...(props.players ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Card data-player-pages>
      <CardHeader>
        <CardTitle>Player pages & recognition sheets</CardTitle>
        <CardSubtitle>Open a player to review stats and awards, arrange and print their recognition sheet.</CardSubtitle>
      </CardHeader>
      <CardContent>
        {props.players === null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Loading roster…
          </div>
        ) : list.length === 0 ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No players on this roster yet.
          </div>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {list.map((p) => (
              <li key={p.id}>
                <Link
                  href={links.player(props.seasonId, p.id)}
                  className="inline-flex min-h-9 items-center rounded-xl border px-3 text-sm font-semibold"
                  style={{ borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)" }}
                >
                  #{p.number} {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
