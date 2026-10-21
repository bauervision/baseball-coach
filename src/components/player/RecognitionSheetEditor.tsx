"use client";

import Image from "next/image";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  PlayerSeasonPlaque,
  RecognitionSlotProvider,
  SHEET_HEIGHT_PX,
  SHEET_WIDTH_PX,
  buildRecognitionCards,
  useRecognitionSlotBinding,
  type PlaqueAwardCard,
  type RecognitionSlotBinding,
} from "@/components/player/PlayerSeasonPlaque";
import { canSwapSlots, swapSlots } from "@/lib/recognitionLayout";
import { TROPHY_ART } from "@/lib/trophyArtwork";

type SheetProps = Omit<
  React.ComponentProps<typeof PlayerSeasonPlaque>,
  "order" | "id"
>;

export const RECOGNITION_PRINT_SHEET_ID = "player-season-plaque-print";

/**
 * The unscaled sheet used by browser printing and the PDF export. It lives
 * off-screen as a direct child of <body> so print CSS can show it alone on
 * one exact 10in x 8in page.
 */
export function RecognitionPrintRoot(props: {
  sheet: SheetProps;
  order: readonly string[] | null;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div id="recognition-print-root" aria-hidden="true">
      <PlayerSeasonPlaque
        {...props.sheet}
        order={props.order}
        id={RECOGNITION_PRINT_SHEET_ID}
      />
    </div>,
    document.body,
  );
}

/** Scale that fits the fixed sheet into the available width and viewport. */
function useFitScale(
  ref: React.RefObject<HTMLDivElement | null>,
  reserveBelow: number,
): number {
  const [scale, setScale] = React.useState(0.75);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      const byWidth = width / SHEET_WIDTH_PX;
      // On phones the sheet just fills the width and the page scrolls.
      if (window.innerWidth < 768) {
        setScale(Math.min(byWidth, 1));
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const byHeight =
        (window.innerHeight - top - 16 - reserveBelow) / SHEET_HEIGHT_PX;
      setScale(Math.max(0.35, Math.min(byWidth, byHeight, 1.4)));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, reserveBelow]);

  return scale;
}

type DragState = {
  from: number;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  over: number | null;
};

function slotIndexAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const slot = el?.closest<HTMLElement>("[data-slot]");
  if (!slot) return null;
  const n = Number(slot.dataset.slot);
  return Number.isInteger(n) ? n : null;
}

function slotLabel(index: number, visibleCount: number): string {
  if (index === 0) return "Featured slot";
  if (index < 4) return `Award slot ${index + 1}`;
  if (index < visibleCount) return `Honors thumbnail ${index - 3}`;
  return "Not pictured";
}

/** An earned award with no room on the sheet, still movable into a slot. */
function HiddenAwardChip(props: { index: number; card: PlaqueAwardCard }) {
  const { index, card } = props;
  const binding = useRecognitionSlotBinding();
  const slotProps = binding?.slotProps(index) ?? {};

  return (
    <div
      data-slot={index}
      {...slotProps}
      className="flex items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-3 text-xs font-black uppercase text-[#1f1b16]"
      style={{
        ...slotProps.style,
        borderColor: "#d9a35a",
        borderRadius: 999,
      }}
    >
      <Image
        src={TROPHY_ART[card.trophy.key] ?? "/trophies/trophy.png"}
        alt=""
        width={28}
        height={28}
        draggable={false}
        className="h-7 w-7 rounded-full object-contain"
      />
      {card.trophy.title}
      {card.kind === "runnerUp" ? " (runner up)" : ""}
    </div>
  );
}

const miniBtn =
  "rounded-full border px-2 py-0.5 text-[11px] font-black leading-tight shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40";

/**
 * On-screen recognition sheet. Always scaled to fit the viewport; when
 * `editing`, award slots can be swapped by drag (mouse or touch), keyboard
 * (Space to pick up, arrows to move, Space to drop, Esc to cancel), or the
 * per-slot buttons.
 */
export function RecognitionSheetStage(props: {
  sheet: SheetProps;
  order: readonly string[] | null;
  editing: boolean;
  onOrderChange?: (order: string[]) => void;
}) {
  const { sheet, order, editing, onOrderChange } = props;

  const recognition = buildRecognitionCards({
    player: sheet.player,
    awards: sheet.awards,
    runnerUpAwards: sheet.runnerUpAwards,
    savedOrder: order,
  });
  const { cards, visibleCount } = recognition;

  // Keep the "not pictured" tray on screen with the sheet while editing.
  const fitRef = React.useRef<HTMLDivElement>(null);
  const scale = useFitScale(
    fitRef,
    editing && cards.length > visibleCount ? 60 : 0,
  );
  const current = recognition.order;

  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const stageRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!editing) {
      setDrag(null);
      setPicked(null);
    }
  }, [editing]);

  const titleAt = React.useCallback(
    (i: number) => cards[i]?.trophy.title ?? "",
    [cards],
  );

  const swap = React.useCallback(
    (from: number, to: number): boolean => {
      if (!onOrderChange || !canSwapSlots(current, from, to)) return false;
      onOrderChange(swapSlots(current, from, to));
      setAnnouncement(
        `${titleAt(from)} moved to ${slotLabel(to, visibleCount).toLowerCase()}; ${titleAt(to)} moved to ${slotLabel(from, visibleCount).toLowerCase()}.`,
      );
      return true;
    },
    [current, onOrderChange, titleAt, visibleCount],
  );

  // Pointer dragging, tracked on window so the pointer can leave the slot.
  React.useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const moved =
        Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
      const active = drag.active || moved > 6;
      setDrag({
        ...drag,
        x: e.clientX,
        y: e.clientY,
        active,
        over: active ? slotIndexAt(e.clientX, e.clientY) : null,
      });
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      if (drag.active && drag.over !== null && drag.over !== drag.from) {
        swap(drag.from, drag.over);
      }
      setDrag(null);
    };

    const onCancel = () => setDrag(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag, swap]);

  const focusSlot = (i: number) =>
    stageRef.current
      ?.querySelector<HTMLElement>(`[data-slot="${i}"]`)
      ?.focus();

  const onSlotKeyDown = (index: number, e: React.KeyboardEvent) => {
    const last = cards.length - 1;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusSlot(Math.min(last, index + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusSlot(Math.max(0, index - 1));
    } else if (e.key === "Escape" && picked !== null) {
      e.preventDefault();
      setPicked(null);
      setAnnouncement("Move cancelled.");
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (picked === null) {
        setPicked(index);
        setAnnouncement(
          `Picked up ${titleAt(index)}. Use the arrow keys to choose a slot, then press Space to swap. Escape cancels.`,
        );
      } else if (picked === index) {
        setPicked(null);
        setAnnouncement("Move cancelled.");
      } else if (swap(picked, index)) {
        setPicked(null);
      } else {
        setAnnouncement("A runner-up finish can't be the featured award.");
      }
    }
  };

  const source = drag?.active ? drag.from : picked;
  const target = drag?.active ? drag.over : null;

  const binding: RecognitionSlotBinding | null = editing
    ? {
        slotProps: (index) => {
          const isSource = source === index;
          const valid = source !== null && canSwapSlots(current, source, index);
          const isTarget = target === index;

          return {
            tabIndex: 0,
            role: "button",
            "aria-roledescription": "draggable award",
            "aria-label": `${slotLabel(index, visibleCount)}: ${titleAt(index)}`,
            "aria-pressed": picked === index,
            onPointerDown: (e: React.PointerEvent) => {
              if (e.button !== 0) return;
              setDrag({
                from: index,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                x: e.clientX,
                y: e.clientY,
                active: false,
                over: null,
              });
            },
            onKeyDown: (e: React.KeyboardEvent) => onSlotKeyDown(index, e),
            style: {
              cursor: drag?.active ? "grabbing" : "grab",
              touchAction: "none",
              userSelect: "none",
              borderRadius: 18,
              outlineOffset: 3,
              outline: isSource
                ? "3px solid #ff4d00"
                : isTarget
                  ? valid
                    ? "4px solid #ff4d00"
                    : "3px solid #b91c1c"
                  : source !== null && valid
                    ? "2px dashed #efa243"
                    : undefined,
              opacity: drag?.active && isSource ? 0.45 : 1,
              background:
                isTarget && valid ? "rgba(255,77,0,0.08)" : undefined,
              transition: "opacity 120ms ease",
            },
          } as React.HTMLAttributes<HTMLDivElement>;
        },
        overlay: (index) => {
          if (index >= visibleCount || drag?.active) return null;
          const stop = (e: React.PointerEvent) => e.stopPropagation();

          return (
            <div
              data-editor-ui="true"
              className="absolute right-2 top-2 z-10 flex gap-1"
              onPointerDown={stop}
            >
              {index > 0 && index < 4 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  className={miniBtn}
                  style={{
                    background: "#efa243",
                    borderColor: "#d98a26",
                    color: "#1f1b16",
                  }}
                  disabled={!canSwapSlots(current, index, 0)}
                  onClick={() => swap(index, 0)}
                  title="Make this the featured award"
                >
                  ★ Feature
                </button>
              ) : null}
            </div>
          );
        },
      }
    : null;

  const hidden = cards.slice(visibleCount);

  return (
    <div ref={stageRef} className="grid min-w-0 gap-3">
      <div ref={fitRef} className="w-full min-w-0 overflow-hidden">
        <div
          className="relative mx-auto"
          style={{
            width: SHEET_WIDTH_PX * scale,
            height: SHEET_HEIGHT_PX * scale,
          }}
        >
          <div
            className="absolute left-0 top-0 overflow-hidden rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
            style={{
              width: SHEET_WIDTH_PX,
              height: SHEET_HEIGHT_PX,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <RecognitionSlotProvider value={binding}>
              <PlayerSeasonPlaque {...sheet} order={current} />
            </RecognitionSlotProvider>
          </div>
        </div>
      </div>

      {editing && hidden.length > 0 ? (
        <div
          className="mx-auto flex w-full max-w-240 flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
            background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
          }}
        >
          <div
            className="mr-1 text-xs font-semibold"
            style={{ color: "var(--muted)" }}
          >
            Also earned — not pictured (drag onto a slot to show):
          </div>
          <RecognitionSlotProvider value={binding}>
            {hidden.map((card, i) => (
              <HiddenAwardChip
                key={card.key}
                index={visibleCount + i}
                card={card}
              />
            ))}
          </RecognitionSlotProvider>
        </div>
      ) : null}

      {drag?.active ? (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-3 text-xs font-black uppercase text-[#1f1b16] shadow-lg"
          style={{
            left: drag.x + 12,
            top: drag.y + 12,
            borderColor: "#ff4d00",
          }}
        >
          <Image
            src={
              TROPHY_ART[cards[drag.from]?.trophy.key ?? ""] ??
              "/trophies/trophy.png"
            }
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-full object-contain"
          />
          {titleAt(drag.from)}
        </div>
      ) : null}

      <div className="sr-only" aria-live="assertive">
        {announcement}
      </div>
    </div>
  );
}
