
import { MobileResponsive } from "./MobileResponsive";

export function Footer() {
  return (
    <footer className="border-t border-white/10">
      <MobileResponsive className="h-12 flex items-center text-xs text-white/50">
        <span>Tigers SCAA Spring 2026</span>
      </MobileResponsive>
    </footer>
  );
}

