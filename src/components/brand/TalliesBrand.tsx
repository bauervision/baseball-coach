// Tallies wordmark and tally-mark symbol.
//
// Wordmark: lowercase "tallies" set in Bubblegum Sans (SIL OFL 1.1,
// self-hosted; see src/app/fonts/BubblegumSans-OFL.txt), no final period —
// the tagline already ends in one and the bare word stays legible at header
// sizes. Symbol: a five-bar tally gate (four strokes and a crossing stroke)
// on a rounded tile; it reads at favicon size and on light or dark
// backgrounds. Supporting text never uses the display face.

import * as React from "react";

export function TallyMark(props: {
  size?: number;
  /** "tile": coral tile with cream strokes; "mono": strokes in currentColor. */
  variant?: "tile" | "mono";
  title?: string;
  className?: string;
}) {
  const { size = 32, variant = "tile", title, className } = props;
  const tile = variant === "tile";
  const stroke = tile ? "#FFF8EE" : "currentColor";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {tile ? <rect x="0" y="0" width="32" height="32" rx="8" fill="#EF4F5A" /> : null}
      <g stroke={stroke} strokeWidth="2.6" strokeLinecap="round">
        <line x1="9.5" y1="8" x2="9.5" y2="24" />
        <line x1="14" y1="8" x2="14" y2="24" />
        <line x1="18.5" y1="8" x2="18.5" y2="24" />
        <line x1="23" y1="8" x2="23" y2="24" />
      </g>
      <line
        x1="6.5"
        y1="21.5"
        x2="25.5"
        y2="10.5"
        stroke={tile ? "#FFB627" : "currentColor"}
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark(props: {
  /** Font size (px number or any CSS length, e.g. clamp()). */
  size?: number | string;
  as?: "span" | "h1" | "div";
  className?: string;
  style?: React.CSSProperties;
}) {
  const { size = 28, as: Tag = "span", className, style } = props;
  return (
    <Tag
      className={["tallies-wordmark", className ?? ""].join(" ")}
      style={{ fontSize: size, ...style }}
      data-tallies-wordmark
    >
      tallies
    </Tag>
  );
}

/** Compact lockup for headers: symbol + wordmark. */
export function TalliesLockup(props: { size?: number }): React.ReactElement {
  const size = props.size ?? 28;
  return (
    <span className="inline-flex items-center gap-2">
      <TallyMark size={Math.round(size * 1.05)} />
      <Wordmark size={size} />
    </span>
  );
}
