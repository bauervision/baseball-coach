// components/ui/Toggle.tsx
"use client";

import * as React from "react";
import { cx } from "./cx";

export type ToggleProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChangeAction?: (checked: boolean) => void;

  disabled?: boolean;
  label?: string;

  className?: string;
};

export function Toggle(props: ToggleProps) {
  const isControlled = typeof props.checked === "boolean";
  const [local, setLocal] = React.useState<boolean>(
    Boolean(props.defaultChecked),
  );

  const checked = isControlled ? Boolean(props.checked) : local;

  const setChecked = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setLocal(next);
      props.onCheckedChangeAction?.(next);
    },
    [isControlled, props],
  );

  const onClick = React.useCallback(() => {
    if (props.disabled) return;
    setChecked(!checked);
  }, [checked, props.disabled, setChecked]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (props.disabled) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setChecked(!checked);
      }
    },
    [checked, props.disabled, setChecked],
  );

  return (
    <button
      type="button"
      className={cx(
        "ui-toggle",
        checked && "ui-toggle--checked",
        props.className,
      )}
      onClick={onClick}
      onKeyDown={onKeyDown}
      disabled={props.disabled}
      role="switch"
      aria-checked={checked}
      aria-label={props.label}
    >
      <span className="ui-toggle__track" aria-hidden="true" />
      <span className="ui-toggle__thumb" aria-hidden="true" />
    </button>
  );
}
