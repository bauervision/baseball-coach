"use client";

import * as React from "react";
import Link from "next/link";
import { LogOut, Shield } from "lucide-react";

import { clearSession, readSession } from "@/lib/session";
import {
  startLogoutOverlay,
  finishLogoutOverlay,
} from "@/components/layout/AuthOverlayHost";

import { ThemeModeToggle } from "./ThemeModeToggle";

const LOGOUT_OVERLAY_MS = 2000;

function IconButton(props: {
  title: string;
  onClickAction: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClickAction}
      className="grid h-9 w-9 place-items-center rounded-xl border shadow-sm disabled:cursor-not-allowed disabled:opacity-60 transition-opacity hover:opacity-90"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 72%, transparent))",
      }}
    >
      {props.children}
    </button>
  );
}

function PillLink(props: {
  href: string;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={props.disabled ? "#" : props.href}
      aria-label={props.title}
      title={props.title}
      className={[
        "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-semibold shadow-sm transition-opacity",
        props.disabled ? "pointer-events-none opacity-60" : "hover:opacity-90",
      ].join(" ")}
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 92%, transparent), color-mix(in oklab, var(--card) 72%, transparent))",
        color: "var(--foreground)",
      }}
    >
      {props.children}
    </Link>
  );
}

export function Navbar(props: { title: string; seasonLabel?: string }) {
  const session = React.useMemo(() => readSession(), []);
  const isAdmin = session?.role === "admin";

  const [loggingOut, setLoggingOut] = React.useState(false);
  const logoutTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (logoutTimerRef.current) {
        window.clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };
  }, []);

  const onSignOutAction = React.useCallback(() => {
    if (loggingOut) return;

    setLoggingOut(true);
    startLogoutOverlay();

    const t = window.setTimeout(() => {
      clearSession();
      finishLogoutOverlay();
      setLoggingOut(false);
    }, LOGOUT_OVERLAY_MS);

    logoutTimerRef.current = t;
  }, [loggingOut]);

  return (
    <header
      className="sticky top-0 z-50 w-full border-b backdrop-blur"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--card) 82%, transparent), color-mix(in oklab, var(--card) 62%, transparent))",
      }}
    >
      <div
        className="h-0.5 w-full"
        style={{
          background:
            "linear-gradient(90deg, var(--primary), var(--secondary))",
          opacity: 0.9,
        }}
        aria-hidden="true"
      />

      {/* Mobile: same as before. Desktop: 3-col grid with centered season label */}
      <div className="mx-auto h-14 max-w-6xl px-4">
        <div className="flex h-full items-center justify-between gap-3 sm:hidden">
          <Link
            href="/"
            className="flex items-center gap-3 min-w-0 transition-opacity hover:opacity-90"
            aria-label="Go to home"
          >
            <div className="relative h-8 w-8 shrink-0 overflow-hidden">
              <div className="tigersMark" aria-hidden="true" />
            </div>

            <div className="min-w-0">
              <div
                className="text-sm font-semibold whitespace-nowrap truncate"
                style={{ color: "var(--foreground)" }}
              >
                {props.title}
              </div>

              {isAdmin ? (
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  Admin
                </div>
              ) : null}
            </div>
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            {isAdmin ? (
              <PillLink href="/admin" title="Go to admin" disabled={loggingOut}>
                <Shield
                  className="h-4 w-4"
                  style={{ color: "var(--secondary)" }}
                  aria-hidden="true"
                />
                <span className="text-[13px]">Admin</span>
              </PillLink>
            ) : null}

            <ThemeModeToggle disabled={loggingOut} />

            <IconButton
              title={loggingOut ? "Signing out…" : "Sign out"}
              onClickAction={onSignOutAction}
              disabled={loggingOut}
            >
              <LogOut
                className="h-4 w-4"
                style={{ color: "var(--secondary)" }}
                aria-hidden="true"
              />
            </IconButton>
          </div>
        </div>

        <div className="hidden h-full sm:grid sm:grid-cols-3 sm:items-center">
          {/* Left */}
          <div className="min-w-0">
            <Link
              href="/"
              className="flex items-center gap-3 min-w-0 transition-opacity hover:opacity-90"
              aria-label="Go to home"
            >
              <div className="relative h-8 w-8 shrink-0 overflow-hidden">
                <div className="tigersMark" aria-hidden="true" />
              </div>

              <div className="min-w-0">
                <div
                  className="text-sm font-semibold whitespace-nowrap truncate"
                  style={{ color: "var(--foreground)" }}
                >
                  {props.title}
                </div>

                {isAdmin ? (
                  <div
                    className="text-[11px]"
                    style={{ color: "var(--muted)" }}
                  >
                    Admin
                  </div>
                ) : null}
              </div>
            </Link>
          </div>

          {/* Center (desktop only) */}
          <div className="flex justify-center">
            {props.seasonLabel ? (
              <div
                className="text-sm font-semibold"
                style={{ color: "var(--muted)" }}
              >
                {props.seasonLabel}
              </div>
            ) : null}
          </div>

          {/* Right */}
          <div className="flex items-center justify-end gap-2">
            {isAdmin ? (
              <PillLink href="/admin" title="Go to admin" disabled={loggingOut}>
                <Shield
                  className="h-4 w-4"
                  style={{ color: "var(--secondary)" }}
                  aria-hidden="true"
                />
                <span>Admin</span>
              </PillLink>
            ) : null}

            <ThemeModeToggle disabled={loggingOut} />

            <IconButton
              title={loggingOut ? "Signing out…" : "Sign out"}
              onClickAction={onSignOutAction}
              disabled={loggingOut}
            >
              <LogOut
                className="h-4 w-4"
                style={{ color: "var(--secondary)" }}
                aria-hidden="true"
              />
            </IconButton>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tigersMark {
          position: absolute;
          inset: 0;
          background: var(--primary);

          -webkit-mask-image: url("/TigersLogo.png");
          mask-image: url("/TigersLogo.png");
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          -webkit-mask-position: center;
          mask-position: center;
          -webkit-mask-size: contain;
          mask-size: contain;

          padding: 4px;
        }

        :global(html.dark) .tigersMark,
        :global([data-theme="dark"]) .tigersMark {
          background: #ffffff;
        }
      `}</style>
    </header>
  );
}
