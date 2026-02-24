// components/shell/MobileResponsive.tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export function MobileResponsive(props: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Mobile-first: tighter max width + consistent padding
        "mx-auto w-full max-w-140 px-4 sm:max-w-2xl sm:px-6 lg:max-w-6xl lg:px-8",
        // Safe-area support (iOS)
        "pl-[calc(env(safe-area-inset-left,0px)+1rem)] pr-[calc(env(safe-area-inset-right,0px)+1rem)]",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
