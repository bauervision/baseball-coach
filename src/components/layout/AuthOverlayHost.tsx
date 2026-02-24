/* eslint-disable @next/next/no-img-element */
"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";

type OverlayKind = "idle" | "logout" | "enter" | "error";

declare global {
  interface Window {
    __knexusOverlayKind?: OverlayKind;
  }
}

const EVT = "knexus:overlay";

function setOverlay(kind: OverlayKind) {
  if (typeof window === "undefined") return;
  window.__knexusOverlayKind = kind;
  window.dispatchEvent(new CustomEvent(EVT, { detail: { kind } }));
}

/** API (logout) */
export function startLogoutOverlay() {
  setOverlay("logout");
}
export function finishLogoutOverlay() {
  setOverlay("idle");
}

/** API (entering) */
export function startEnterOverlay() {
  setOverlay("enter");
}
export function finishEnterOverlay() {
  setOverlay("idle");
}

/** API (error) */
export function startErrorOverlay() {
  setOverlay("error");
}
export function finishErrorOverlay() {
  setOverlay("idle");
}

function readOverlayKind(): OverlayKind {
  if (typeof window === "undefined") return "idle";
  return window.__knexusOverlayKind ?? "idle";
}

export default function AuthOverlayHost() {
  const [kind, setKind] = React.useState<OverlayKind>(() => readOverlayKind());

  React.useEffect(() => {
    setKind(readOverlayKind());

    const onEvt = (e: Event) => {
      const next = (e as CustomEvent).detail?.kind as OverlayKind | undefined;
      if (next) setKind(next);
    };

    window.addEventListener(EVT, onEvt as EventListener);
    return () => window.removeEventListener(EVT, onEvt as EventListener);
  }, []);

  const on = kind !== "idle";
  const isError = kind === "error";

  const title =
    kind === "logout"
      ? "Securing your session…"
      : isError
        ? "Sign-in failed"
        : "Loading…";

  const subtitle =
    kind === "logout"
      ? "Signing out safely."
      : isError
        ? "Returning to sign-in."
        : "Warming up the dugout.";

  return (
    <AnimatePresence>
      {on ? (
        <motion.div
          className="fixed inset-0 z-9999 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, transition: { duration: 0.22 } }}
          role="dialog"
          aria-modal="true"
          aria-label={
            kind === "logout"
              ? "Signing out"
              : isError
                ? "Sign-in failed"
                : "Entering app"
          }
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur" />

          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            aria-hidden="true"
          >
            <motion.div
              className="absolute -left-[20%] top-0 h-full w-[70%] rotate-6 blur-3xl"
              style={{
                background: isError
                  ? "radial-gradient(circle at 30% 30%, color-mix(in oklab, #fb7185 55%, transparent), transparent 60%)"
                  : "radial-gradient(circle at 30% 30%, color-mix(in oklab, var(--secondary) 40%, transparent), transparent 60%)",
              }}
              initial={{
                x: isError ? "120%" : "-40%",
                opacity: 0.25,
              }}
              animate={{
                x: isError ? "-40%" : "120%",
                opacity: 0.6,
                transition: {
                  duration: isError ? 0.75 : 0.95,
                  ease: [0.16, 1, 0.3, 1],
                },
              }}
            />

            <motion.div
              className="absolute -right-[25%] bottom-[-10%] h-[60%] w-[60%] rounded-full blur-3xl"
              style={{
                background: isError
                  ? "radial-gradient(circle at 30% 30%, color-mix(in oklab, #f97316 45%, transparent), transparent 65%)"
                  : "radial-gradient(circle at 30% 30%, color-mix(in oklab, var(--primary) 35%, transparent), transparent 65%)",
              }}
              initial={{
                scale: 0.9,
                opacity: 0.2,
              }}
              animate={{
                scale: isError ? 1.0 : 1.1,
                opacity: isError ? 0.0 : 0.55,
                x: isError ? "-140%" : 0,
                transition: isError
                  ? { duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }
                  : { duration: 0.65, ease: [0.16, 1, 0.3, 1] },
              }}
            />
          </motion.div>

          <div className="relative z-10 grid h-full place-items-center px-6">
            <motion.div
              className="w-115 max-w-[92vw] rounded-2xl border p-6"
              style={{
                borderColor:
                  "color-mix(in oklab, var(--stroke) 92%, transparent)",
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--card) 96%, var(--bg-base) 4%), var(--card))",
                color: "var(--foreground)",
                boxShadow:
                  "0 30px 90px rgba(0,0,0,0.55), 0 0 0 1px color-mix(in oklab, var(--primary) 10%, transparent) inset",
              }}
              initial={{ y: 18, scale: 0.985, opacity: 0 }}
              animate={{
                y: 0,
                scale: 1,
                opacity: 1,
                transition: {
                  type: "spring",
                  stiffness: 420,
                  damping: 32,
                  mass: 0.75,
                },
              }}
              exit={{
                y: 12,
                scale: 0.985,
                opacity: 0,
                transition: { duration: 0.2 },
              }}
            >
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  {/* Theme-aware Tigers logo tint using mask */}
                  <div
                    className="tigersLogoMark h-11 w-11"
                    aria-hidden="true"
                    style={{
                      background: isError ? "#fb7185" : "var(--primary)",
                      WebkitMaskImage: 'url("/TigersLogo.png")',
                      maskImage: 'url("/TigersLogo.png")',
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      filter:
                        "drop-shadow(0 14px 26px rgba(0,0,0,0.35)) drop-shadow(0 0 0.8px rgba(255,255,255,0.18))",
                    }}
                  />
                </div>

                <div className="min-w-0">
                  <div
                    className="teamLabel"
                    style={{ color: "var(--foreground)", opacity: 0.92 }}
                  >
                    TIGERS BASEBALL
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    Tigers 2026 • Parent Portal
                  </div>
                </div>
              </div>

              <div
                className="mt-5 text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {title}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {subtitle}
              </div>

              <motion.div
                className="mt-5 h-2 w-full overflow-hidden rounded-full"
                style={{
                  background:
                    "color-mix(in oklab, var(--stroke) 35%, transparent)",
                }}
                aria-hidden="true"
              >
                {isError ? (
                  <motion.div
                    className="h-full w-full"
                    style={{
                      background: "linear-gradient(90deg, #fb7185, #f97316)",
                    }}
                    initial={{ scaleX: 0, transformOrigin: "0% 50%" }}
                    animate={{
                      scaleX: 1,
                      transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
                    }}
                  />
                ) : (
                  <motion.div
                    className="h-full w-[40%] rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, var(--primary), var(--secondary))",
                    }}
                    initial={{ x: "-120%" }}
                    animate={{
                      x: "280%",
                      transition: {
                        repeat: Infinity,
                        duration: 0.85,
                        ease: "easeInOut",
                      },
                    }}
                  />
                )}
              </motion.div>

              <div className="mt-5 flex items-center gap-2">
                <PulseDot delay={0} tone={isError ? "error" : "ok"} />
                <PulseDot delay={0.12} tone={isError ? "error" : "ok"} />
                <PulseDot delay={0.24} tone={isError ? "error" : "ok"} />
                <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                  {isError ? "Try again…" : "Please wait…"}
                </span>
              </div>

              <style jsx>{`
                .teamLabel {
                  font-size: 12px;
                  font-weight: 800;
                  letter-spacing: 0.12em;
                  text-transform: uppercase;
                  line-height: 1.1;
                }
              `}</style>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PulseDot({ delay, tone }: { delay: number; tone: "ok" | "error" }) {
  const bg =
    tone === "error"
      ? "color-mix(in oklab, #fb7185 70%, white 30%)"
      : "color-mix(in oklab, var(--primary) 70%, white 30%)";

  return (
    <motion.span
      className="h-2.5 w-2.5 rounded-full"
      style={{ background: bg }}
      initial={{ opacity: 0.25, scale: 0.9 }}
      animate={{ opacity: [0.25, 0.9, 0.25], scale: [0.9, 1.05, 0.9] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
      aria-hidden="true"
    />
  );
}