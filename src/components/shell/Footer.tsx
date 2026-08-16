import { MobileResponsive } from "./MobileResponsive";

export function Footer(props: {
  teamName: string;
  league: string;
  seasonLabel: string;
}) {
  return (
    <footer className="border-t border-white/10">
      <MobileResponsive className="h-12 flex items-center text-xs text-white/50">
        <span>
          {props.teamName} {props.league} {props.seasonLabel}
        </span>
      </MobileResponsive>
    </footer>
  );
}
