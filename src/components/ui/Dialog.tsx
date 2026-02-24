// components/ui/Dialog.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

type DialogCtx = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const Ctx = React.createContext<DialogCtx | null>(null);

function useDialogCtx() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("Dialog components must be used within <Dialog>.");
  return ctx;
}

function getFocusable(root: HTMLElement) {
  const selector =
    'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"),
  );
}

export type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChangeAction?: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog(props: DialogProps) {
  const isControlled = typeof props.open === "boolean";
  const [openLocal, setOpenLocal] = React.useState(Boolean(props.defaultOpen));
  const open = isControlled ? Boolean(props.open) : openLocal;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setOpenLocal(next);
      props.onOpenChangeAction?.(next);
    },
    [isControlled, props],
  );

  const ctx = React.useMemo(() => ({ open, setOpen }), [open, setOpen]);

  return <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>;
}

/**
 * Render-prop trigger to avoid cloneElement typing issues.
 * Usage:
 * <DialogTrigger>
 *   {({ open }) => <Button onClick={open}>Open</Button>}
 * </DialogTrigger>
 */
export function DialogTrigger(props: {
  children: (api: { open: () => void }) => React.ReactNode;
}) {
  const ctx = useDialogCtx();
  const open = React.useCallback(() => ctx.setOpen(true), [ctx]);
  return <>{props.children({ open })}</>;
}

/**
 * Render-prop close to avoid cloneElement typing issues.
 * Usage:
 * <DialogClose>
 *   {({ close }) => <Button variant="ghost" onClick={close}>Close</Button>}
 * </DialogClose>
 */
export function DialogClose(props: {
  children: (api: { close: () => void }) => React.ReactNode;
}) {
  const ctx = useDialogCtx();
  const close = React.useCallback(() => ctx.setOpen(false), [ctx]);
  return <>{props.children({ close })}</>;
}

export function DialogContent(props: {
  title?: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useDialogCtx();
  const [mounted, setMounted] = React.useState(false);

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const lastFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!ctx.open) return;

    lastFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const panel = panelRef.current;
    if (!panel) return;

    const focusables = getFocusable(panel);
    (focusables[0] ?? panel).focus();

    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = prevOverflow;
      lastFocusRef.current?.focus?.();
    };
  }, [ctx.open]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ctx.setOpen(false);
        return;
      }

      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusables = getFocusable(panel);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [ctx],
  );

  const onOverlayMouseDown = React.useCallback(() => {
    ctx.setOpen(false);
  }, [ctx]);

  if (!mounted) return null;
  if (!ctx.open) return null;

  return createPortal(
    <div className="ui-dialog" role="dialog" aria-modal="true">
      <div className="ui-dialog__overlay" onMouseDown={onOverlayMouseDown} />
      <div
        ref={panelRef}
        className={cx("ui-dialog__panel", props.className)}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {(props.title || props.description) && (
          <div className="ui-dialog__header">
            {props.title ? (
              <div className="ui-dialog__title">{props.title}</div>
            ) : null}
            {props.description ? (
              <div className="ui-dialog__desc">{props.description}</div>
            ) : null}
          </div>
        )}
        <div className="ui-dialog__content">{props.children}</div>
      </div>
    </div>,
    document.body,
  );
}
