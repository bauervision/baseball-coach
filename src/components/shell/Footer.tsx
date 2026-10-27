import Link from "next/link";
import { MobileResponsive } from "./MobileResponsive";

export function Footer(props: {
  teamName: string;
  league: string;
  seasonLabel: string;
  /** Team routes (Tallies): a small brand credit instead of the version. */
  poweredByTallies?: boolean;
}) {
  return (
    <footer
      className="sticky bottom-0 z-40 border-t border-white/10 backdrop-blur"
      style={{
        background: "color-mix(in oklab, var(--bg-base) 88%, transparent)",
      }}
    >
      <MobileResponsive className="flex h-12 items-center gap-3 text-xs sm:justify-between">
        {props.poweredByTallies ? (
          <Link href="/" className="shrink-0 order-1 font-semibold" style={{ color: "var(--muted)" }}>
            Kept with <span className="tallies-wordmark text-[15px]" style={{ color: "var(--foreground)" }}>tallies</span>
          </Link>
        ) : (
          <span className="shrink-0 order-1 text-white/50">
            v{process.env.APP_VERSION}
          </span>
        )}
        <span className="truncate order-2 text-[var(--primary)]">
          {props.teamName} {props.league} {props.seasonLabel}
        </span>
      </MobileResponsive>
    </footer>
  );
}
