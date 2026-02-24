"use client";

import * as React from "react";
import { cx } from "./cx";

type AccordionType = "single" | "multiple";

type AccordionCtx = {
  type: AccordionType;
  openValues: string[];
  toggle: (value: string) => void;
  collapsible: boolean;
};

const Ctx = React.createContext<AccordionCtx | null>(null);

function useAccordionCtx() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("Accordion components must be used within Accordion.");
  return ctx;
}

export function Accordion(props: {
  type?: AccordionType;
  defaultValue?: string | string[];
  collapsible?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const type: AccordionType = props.type ?? "single";
  const collapsible = props.collapsible ?? true;

  const [openValues, setOpenValues] = React.useState<string[]>(() => {
    if (type === "multiple") {
      if (Array.isArray(props.defaultValue)) return props.defaultValue;
      if (typeof props.defaultValue === "string") return [props.defaultValue];
      return [];
    }
    if (typeof props.defaultValue === "string") return [props.defaultValue];
    if (Array.isArray(props.defaultValue) && props.defaultValue.length)
      return [props.defaultValue[0]];
    return [];
  });

  const toggle = React.useCallback(
    (value: string) => {
      setOpenValues((prev) => {
        const isOpen = prev.includes(value);

        if (type === "multiple") {
          if (isOpen) return collapsible ? prev.filter((v) => v !== value) : prev;
          return [...prev, value];
        }

        if (isOpen) return collapsible ? [] : prev;
        return [value];
      });
    },
    [collapsible, type],
  );

  const ctx = React.useMemo<AccordionCtx>(
    () => ({ type, openValues, toggle, collapsible }),
    [collapsible, openValues, toggle, type],
  );

  return (
    <div className={cx("ui-accordion", props.className)}>
      <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
    </div>
  );
}

export function AccordionItem(props: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useAccordionCtx();
  const open = ctx.openValues.includes(props.value);

  return (
    <div
      className={cx("ui-acc-item", open && "ui-acc-item--open", props.className)}
      data-open={open ? "true" : "false"}
    >
      <AccordionItemCtx.Provider value={{ value: props.value, open }}>
        {props.children}
      </AccordionItemCtx.Provider>
    </div>
  );
}

type ItemCtx = { value: string; open: boolean };
const AccordionItemCtx = React.createContext<ItemCtx | null>(null);
function useItemCtx() {
  const ctx = React.useContext(AccordionItemCtx);
  if (!ctx) throw new Error("AccordionTrigger/Content must be inside AccordionItem.");
  return ctx;
}

export function AccordionTrigger(props: {
  children: React.ReactNode;
  className?: string;
}) {
  const acc = useAccordionCtx();
  const item = useItemCtx();

  return (
    <button
      type="button"
      className={cx("ui-acc-trigger", props.className)}
      aria-expanded={item.open}
      onClick={() => acc.toggle(item.value)}
    >
      <span className="ui-acc-trigger__text">{props.children}</span>
      <span className="ui-acc-trigger__chev" aria-hidden="true" />
    </button>
  );
}

export function AccordionContent(props: {
  children: React.ReactNode;
  className?: string;
}) {
  const item = useItemCtx();

  return (
    <div
      className={cx("ui-acc-content", item.open && "ui-acc-content--open", props.className)}
      hidden={!item.open}
    >
      <div className="ui-acc-content__inner">{props.children}</div>
    </div>
  );
}
