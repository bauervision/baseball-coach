"use client";

import * as React from "react";
import { cx } from "./cx";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundToStep(v: number, min: number, step: number) {
  const snapped = Math.round((v - min) / step) * step + min;
  const p = Math.max(0, Math.ceil(-Math.log10(step) + 2));
  return Number(snapped.toFixed(p));
}

export type SliderProps = {
  value?: number;
  defaultValue?: number;
  onValueChangeAction?: (value: number) => void;

  min?: number;
  max?: number;
  step?: number;

  disabled?: boolean;
  label?: string;

  className?: string;
};

export function Slider(props: SliderProps) {
  const min = typeof props.min === "number" ? props.min : 0;
  const max = typeof props.max === "number" ? props.max : 100;
  const step = typeof props.step === "number" ? props.step : 1;

  const isControlled = typeof props.value === "number";
  const [valueLocal, setValueLocal] = React.useState<number>(() => {
    const init =
      typeof props.defaultValue === "number" ? props.defaultValue : min;
    return clamp(roundToStep(init, min, step), min, max);
  });

  const value = clamp(
    roundToStep(isControlled ? (props.value ?? min) : valueLocal, min, step),
    min,
    max,
  );

  const setValue = React.useCallback(
    (next: number) => {
      const v = clamp(roundToStep(next, min, step), min, max);
      if (!isControlled) setValueLocal(v);
      props.onValueChangeAction?.(v);
    },
    [isControlled, max, min, props, step],
  );

  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const percent = ((value - min) / (max - min || 1)) * 100;

  const valueFromClientX = React.useCallback(
    (clientX: number) => {
      const el = rootRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / rect.width, 0, 1);
      return min + t * (max - min);
    },
    [max, min, value],
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (props.disabled) return;
      e.preventDefault();

      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      setValue(valueFromClientX(e.clientX));
    },
    [props.disabled, setValue, valueFromClientX],
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (props.disabled) return;
      if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId))
        return;
      e.preventDefault();
      setValue(valueFromClientX(e.clientX));
    },
    [props.disabled, setValue, valueFromClientX],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (props.disabled) return;

      let next = value;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step;
      else if (e.key === "ArrowRight" || e.key === "ArrowUp")
        next = value + step;
      else if (e.key === "Home") next = min;
      else if (e.key === "End") next = max;
      else return;

      e.preventDefault();
      setValue(next);
    },
    [max, min, props.disabled, setValue, step, value],
  );

  const TRACK_INSET_PX = 12;

const layout = React.useMemo(() => {
  const el = rootRef.current;
  if (!el) {
    return { fillPx: 0, thumbPx: TRACK_INSET_PX };
  }

  const w = el.getBoundingClientRect().width;
  const trackW = Math.max(0, w - TRACK_INSET_PX * 2);

  const t = clamp((value - min) / (max - min || 1), 0, 1);
  const fillPx = Math.round(trackW * t);
  const thumbPx = TRACK_INSET_PX + fillPx;

  return { fillPx, thumbPx };
}, [max, min, value]);


  return (
    <div className={cx("ui-slider-wrap", props.className)}>
      <div
        ref={rootRef}
        className={cx("ui-slider", props.disabled && "ui-slider--disabled")}
        role="slider"
        tabIndex={props.disabled ? -1 : 0}
        aria-label={props.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={props.disabled ? true : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="ui-slider__track" aria-hidden="true" />
        <div
  className="ui-slider__fill"
  aria-hidden="true"
  style={{ width: `${layout.fillPx}px` }}
/>

<div
  className="ui-slider__thumb"
  aria-hidden="true"
  style={{ left: `${layout.thumbPx}px` }}
/>
      </div>

      <div className="ui-slider__meta" aria-hidden="true">
        <div className="ui-slider__value">{value}</div>
      </div>
    </div>
  );
}
