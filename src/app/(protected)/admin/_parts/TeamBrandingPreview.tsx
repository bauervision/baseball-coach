// app/admin/_parts/TeamBrandingPreview.tsx
"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { BigStat, SmallStat } from "@/components/player/PlayerStatsCards";
import {
  ScopedBranding,
  TeamMark,
  useTrophyArt,
} from "@/components/theme/BrandingProvider";
import {
  plaqueAccents,
  sportLabel,
  type SeasonBranding,
} from "@/lib/branding";
import { paletteCssVars, type ThemeMode } from "@/lib/themeTokens";

const MASK: React.CSSProperties = {
  background: "var(--primary)",
  WebkitMaskImage: "var(--team-logo-mark)",
  maskImage: "var(--team-logo-mark)",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

function AwardSample() {
  const art = useTrophyArt();
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border p-2.5"
      style={{
        borderColor: "color-mix(in oklab, var(--primary) 45%, var(--stroke))",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--primary) 12%, var(--card)), var(--card))",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={art.batting_champ ?? "/trophies/trophy.png"}
        alt=""
        className="h-14 w-14 rounded-xl object-cover"
      />
      <div className="min-w-0">
        <div className="text-sm font-bold">Batting Champ</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          Highest batting average
        </div>
        <div className="mt-1 text-xs font-semibold" style={{ color: "var(--primary)" }}>
          Earned · .450
        </div>
      </div>
    </div>
  );
}

/**
 * Real app components rendered with a draft branding. Everything is scoped
 * to this container (CSS variables + context); the live app is unchanged.
 */
export function TeamBrandingPreview(props: { branding: SeasonBranding; mode: ThemeMode }) {
  const { branding, mode } = props;
  const palette = branding.palettes[mode];
  const title = branding.division.trim()
    ? `${branding.division.trim()} ${branding.teamName || "Team"}`
    : branding.teamName || "Team";
  const accents = plaqueAccents(branding.palettes.light);

  return (
    <ScopedBranding branding={branding}>
      <div
        data-testid="branding-preview"
        className="grid gap-3 rounded-2xl border p-3"
        style={{
          ...paletteCssVars(palette),
          background: "var(--bg-base)",
          color: "var(--foreground)",
          borderColor: "var(--stroke)",
        }}
      >
        {/* Navigation */}
        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          style={{
            borderColor: "var(--stroke)",
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--card) 82%, transparent), color-mix(in oklab, var(--card) 62%, transparent))",
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-7 w-7 shrink-0">
              <TeamMark style={MASK} monogramStyle={{ fontSize: 11 }} />
            </div>
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Spring 2027
          </span>
          <span
            className="rounded-lg border px-2 py-1 text-xs font-semibold"
            style={{ borderColor: "var(--stroke)", color: "var(--secondary)" }}
          >
            Trophies
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Player card + stats */}
          <Card>
            <CardContent className="grid gap-2 p-3">
              <div className="flex items-center justify-between">
                <div className="text-lg font-extrabold leading-none" style={{ color: "var(--secondary)" }}>
                  Sample Player
                </div>
                <div className="text-3xl font-extrabold leading-none" style={{ color: "var(--primary)" }}>
                  12
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <BigStat label="Batting Average" value=".450" leader tone="primary" />
                <BigStat label="On-Base %" value=".520" tone="secondary" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SmallStat label="Hits" value="9" leader />
                <SmallStat label="RBI" value="6" />
                <SmallStat label="Runs" value="7" />
              </div>
            </CardContent>
          </Card>

          <div className="grid content-start gap-3">
            {/* Buttons and badges */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Save game</Button>
              <Button size="sm" variant="secondary">
                Cancel
              </Button>
              <Chip label="Leader" kind="primary" />
              <Chip label="Coach pick" kind="accent2" />
            </div>

            {/* Award presentation */}
            <AwardSample />

            {/* Recognition sheet accents (always printed on light paper) */}
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: accents.goldLine, background: "#fffdf8", color: "#1f1b16" }}
            >
              <div style={{ height: 4, background: `linear-gradient(90deg, ${accents.brand}, ${accents.gold})` }} />
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="h-8 w-8 shrink-0">
                  <TeamMark
                    style={{ ...MASK, background: accents.brand }}
                    monogramStyle={{ fontSize: 12, background: "none", color: accents.brand }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">
                    {branding.teamName || "Team"} {sportLabel(branding.sport)}
                  </div>
                  <div
                    className="text-[10px] font-black uppercase tracking-[0.2em]"
                    style={{ color: accents.deep }}
                  >
                    Recognition sheet
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScopedBranding>
  );
}
