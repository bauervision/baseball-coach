"use client";

import * as React from "react";
import { cx } from "./cx";

type RadioGroupCtx = {
  name: string;
  value: string | null;
  setValue: (v: string) => void;
  disabled?: boolean;
};

const Ctx = React.createContext<RadioGroupCtx | null>(null);

function useRadioGroupCtx() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("RadioGroupItem must be used within RadioGroup.");
  return ctx;
}

export type RadioGroupProps = {
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onValueChangeAction?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
};

export function RadioGroup(props: RadioGroupProps) {
  const isControlled = typeof props.value === "string";
  const [valueLocal, setValueLocal] = React.useState<string | null>(
    typeof props.defaultValue === "string" ? props.defaultValue : null,
  );

  const value = isControlled ? (props.value ?? null) : valueLocal;

  const setValue = React.useCallback(
    (v: string) => {
      if (!isControlled) setValueLocal(v);
      props.onValueChangeAction?.(v);
    },
    [isControlled, props],
  );

  const ctx = React.useMemo<RadioGroupCtx>(
    () => ({
      name: `rg-${Math.random().toString(16).slice(2)}`,
      value,
      setValue,
      disabled: props.disabled,
    }),
    [props.disabled, setValue, value],
  );

  return (
    <div className={cx("ui-radio-group", props.className)} role="radiogroup">
      <Ctx.Provider value={ctx}>{props.children}</Ctx.Provider>
    </div>
  );
}

export type RadioGroupItemProps = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function RadioGroupItem(props: RadioGroupItemProps) {
  const ctx = useRadioGroupCtx();
  const disabled = Boolean(ctx.disabled || props.disabled);
  const checked = ctx.value === props.value;

  const onSelect = React.useCallback(() => {
    if (disabled) return;
    ctx.setValue(props.value);
  }, [ctx, disabled, props.value]);

  const ref = React.useRef<HTMLButtonElement | null>(null);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
        return;
      }

      if (
        e.key !== "ArrowRight" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }

      e.preventDefault();

      const root = ref.current?.closest('[role="radiogroup"]');
      const items = root
        ? (Array.from(
            root.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
          ) as HTMLButtonElement[])
        : [];

      const enabled = items.filter((el) => !el.disabled);
      const idx = enabled.findIndex((el) => el === ref.current);
      if (idx < 0 || enabled.length === 0) return;

      const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      const next = enabled[(idx + dir + enabled.length) % enabled.length];
      next?.focus();
      next?.click();
    },
    [disabled, onSelect],
  );

  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        "ui-radio",
        checked && "ui-radio--checked",
        disabled && "ui-radio--disabled",
        props.className,
      )}
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="ui-radio__dot" aria-hidden="true" />
      <span className="ui-radio__text">
        <span className="ui-radio__label">{props.label}</span>
        {props.description ? (
          <span className="ui-radio__desc">{props.description}</span>
        ) : null}
      </span>
    </button>
  );
}
