"use client";

// Tallies public homepage (multi-coach builds). Compact hero, three
// benefits, supported sports. No registration, pricing, or testimonials:
// access is by invitation only. The hero art is decorative and invented —
// no real players, children, or team data appear on this page.

import * as React from "react";
import Link from "next/link";
import { Award, BookOpen, ClipboardList, Lock } from "lucide-react";

import { TallyMark, TalliesLockup, Wordmark } from "@/components/brand/TalliesBrand";
import { TALLIES_TAGLINE } from "@/lib/talliesBrand";

const BENEFITS = [
  {
    icon: ClipboardList,
    title: "Track the season",
    body: "Stats, rosters, games, and team progress, kept game by game.",
  },
  {
    icon: Award,
    title: "Celebrate the moments",
    body: "Awards, recognitions, and player achievements worth printing.",
  },
  {
    icon: BookOpen,
    title: "Keep the journey",
    body: "Past seasons, career progress, and keepsakes families can revisit.",
  },
] as const;

/** n tally strokes, drawn as five-bar gates. */
function TallyCount(props: { n: number; color: string }) {
  const gates = Math.floor(props.n / 5);
  const rest = props.n % 5;
  const groups = [...Array(gates).fill(5), ...(rest ? [rest] : [])] as number[];
  return (
    <span className="inline-flex items-center gap-2">
      {groups.map((g, i) => (
        <svg key={i} viewBox={`0 0 ${g === 5 ? 30 : 6 * g + 2} 24`} width={g === 5 ? 30 : 6 * g + 2} height={24} aria-hidden="true">
          <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            {Array.from({ length: Math.min(g, 4) }, (_, k) => (
              <line key={k} x1={4 + k * 6} y1={3} x2={4 + k * 6} y2={21} />
            ))}
          </g>
          {g === 5 ? <line x1={1} y1={18} x2={26} y2={6} stroke={props.color} strokeWidth="2.8" strokeLinecap="round" /> : null}
        </svg>
      ))}
    </span>
  );
}

function HeroCard() {
  const rows = [
    { label: "Games", n: 12, color: "var(--t-coral)" },
    { label: "Hits", n: 17, color: "var(--t-sun)" },
    { label: "Awards", n: 6, color: "var(--t-teal)" },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-105 select-none">
      <div
        className="tallies-pennant absolute -left-3 -top-5 h-16 w-40 sm:-left-6 sm:h-20 sm:w-52"
        style={{ background: "var(--t-coral)" }}
      />
      <div
        className="tallies-card relative -rotate-2 p-5 shadow-[0_18px_40px_-18px_rgba(34,27,58,0.45)] sm:p-6"
        style={{ borderWidth: 2 }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--t-muted)" }}>
            Season tally
          </span>
          <TallyMark size={26} />
        </div>
        <div className="mt-4 grid gap-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--t-line)" }}>
              <span className="text-sm font-semibold">{r.label}</span>
              <span style={{ color: "var(--t-ink)" }}>
                <TallyCount n={r.n} color={r.color} />
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "color-mix(in oklab, var(--t-sun) 26%, transparent)" }}>
          <span>Season MVP</span>
          <span aria-hidden="true">★</span>
        </div>
      </div>
    </div>
  );
}

export function TalliesLanding() {
  React.useEffect(() => {
    document.title = "Tallies — Every season counts.";
  }, []);

  return (
    <div className="tallies flex flex-col" data-tallies-landing>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-6">
        <Link href="/" aria-label="Tallies home" className="rounded-lg">
          <TalliesLockup size={30} />
        </Link>
        <Link href="/signin/" className="tallies-link text-sm">
          Coach sign in
        </Link>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-8 pt-8 sm:px-6 sm:pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:pb-10 lg:pt-12">
          <div className="min-w-0">
            <h1 className="m-0">
              <Wordmark size="clamp(76px, 13vw, 132px)" />
            </h1>
            <p className="mt-3 text-[clamp(1.5rem,3.4vw,2.15rem)] font-extrabold leading-tight tracking-tight" data-tagline>
              {TALLIES_TAGLINE}
            </p>
            <p className="mt-3 max-w-xl text-lg font-semibold" style={{ color: "var(--t-ink-soft)" }}>
              Track the stats. Celebrate the moments. Keep the journey.
            </p>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed" style={{ color: "var(--t-muted)" }}>
              Tallies helps youth coaches record every game, recognize every player, and keep each season&rsquo;s story
              for families to look back on.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/signin/" className="tallies-btn" data-coach-signin-cta>
                Coach sign in
              </Link>
              <p className="flex items-center gap-1.5 text-sm" style={{ color: "var(--t-muted)" }} data-invite-only>
                <Lock className="h-4 w-4" aria-hidden="true" />
                Invitation only for now.
              </p>
            </div>
          </div>
          <HeroCard />
        </section>

        <section aria-labelledby="tallies-benefits" className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6">
          <h2 id="tallies-benefits" className="sr-only">
            What Tallies does
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="tallies-card flex gap-3 p-4">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{ background: "color-mix(in oklab, var(--t-coral) 16%, transparent)", color: "var(--t-coral-ink)" }}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{title}</span>
                  <span className="mt-0.5 block text-sm leading-snug" style={{ color: "var(--t-muted)" }}>
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--t-muted)" }} data-sports>
            <span className="font-semibold" style={{ color: "var(--t-ink)" }}>
              Made for
            </span>
            <span className="tallies-chip">Baseball</span>
            <span className="tallies-chip">Softball</span>
            <span>More sports later.</span>
          </p>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 border-t px-4 py-4 text-xs sm:px-6" style={{ borderColor: "var(--t-line)", color: "var(--t-muted)" }}>
        <span>© {new Date().getFullYear()} Tallies</span>
        <a href="/licenses/BubblegumSans-OFL.txt" className="underline underline-offset-2">
          Font license
        </a>
      </footer>
    </div>
  );
}
