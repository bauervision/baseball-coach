import packageJson from "../../../package.json";
import { MobileResponsive } from "./MobileResponsive";

export function Footer(props: {
  teamName: string;
  league: string;
  seasonLabel: string;
}) {
  return (
    <footer
      className="sticky bottom-0 z-40 border-t border-white/10 backdrop-blur"
      style={{
        background: "color-mix(in oklab, var(--bg-base) 88%, transparent)",
      }}
    >
      <MobileResponsive className="flex h-12 items-center gap-3 text-xs sm:justify-between">
        <span className="shrink-0 order-1 text-white/50">
          v{packageJson.version}
        </span>
        <span className="truncate order-2 text-[var(--primary)]">
          {props.teamName} {props.league} {props.seasonLabel}
        </span>
      </MobileResponsive>
    </footer>
  );
}
