import * as React from "react";
import {
  nextNumericDraft,
  normalizeNumericDraft,
  parseNumericDraft,
} from "@/lib/numericDraft";

/**
 * Shared whole-number input for every numeric admin field. While focused it
 * edits a raw text draft (empty is allowed mid-edit) and reports each valid
 * keystroke; on blur it commits normalized text. A field showing "0" is
 * selected on focus so typing replaces it, and "0" + "7" never yields "07".
 */
export function NumberInput(props: {
  value: string;
  onChangeAction: (text: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { value, onChangeAction, allowEmpty } = props;
  const [draft, setDraft] = React.useState<string | null>(null);
  // Browsers clear a focus-time selection on the mouseup that follows the
  // focusing click; swallow that one mouseup so the "0" stays selected.
  const keepSelectionOnMouseUp = React.useRef(false);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={draft ?? value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      onFocus={(e) => {
        setDraft(value);
        if (value !== "0") return;
        const el = e.currentTarget;
        el.select();
        keepSelectionOnMouseUp.current = true;
        // iOS Safari can drop a selection made during focus.
        requestAnimationFrame(() => {
          if (document.activeElement === el && el.value === "0") el.select();
        });
      }}
      onMouseUp={(e) => {
        if (!keepSelectionOnMouseUp.current) return;
        keepSelectionOnMouseUp.current = false;
        e.preventDefault();
      }}
      onChange={(e) => {
        const next = nextNumericDraft(draft ?? value, e.target.value);
        if (next === null) return;
        setDraft(next);
        onChangeAction(next);
      }}
      onBlur={() => {
        keepSelectionOnMouseUp.current = false;
        const current = draft ?? value;
        const normalized = normalizeNumericDraft(current, allowEmpty);
        setDraft(null);
        if (normalized !== current) onChangeAction(normalized);
      }}
      className={props.className}
      style={props.style}
    />
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeAction: (v: string) => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  disabled?: boolean;
  /** Whole-number field using the shared NumberInput behavior. */
  numeric?: boolean;
  /** For numeric fields: an empty value is kept on blur instead of "0". */
  allowEmpty?: boolean;
}) {
  const className =
    "h-10 w-full min-w-0  rounded-xl border px-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed";
  const style = {
    borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
    background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
    color: "var(--foreground)",
  };

  return (
    <label className="grid gap-1">
      <div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        {props.label}
      </div>

      {props.numeric ? (
        <NumberInput
          value={props.value}
          onChangeAction={props.onChangeAction}
          allowEmpty={props.allowEmpty}
          placeholder={props.placeholder}
          disabled={props.disabled}
          className={className}
          style={style}
        />
      ) : (
        <input
          type={props.type ?? "text"}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          inputMode={props.inputMode}
          onChange={(e) => props.onChangeAction(e.target.value)}
          className={className}
          style={style}
        />
      )}
    </label>
  );
}

export function Select(props: {
  label: string;
  value: string;
  onChangeAction: (v: string) => void;
  options: Array<[string, string]>;
  /** Optional labeled groups rendered after `options` as <optgroup>s. */
  groups?: Array<{ label: string; options: Array<[string, string]> }>;
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        {props.label}
      </div>
      <select
        value={props.value}
        onChange={(e) => props.onChangeAction(e.target.value)}
        className="h-10 rounded-xl border px-3 text-sm"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
          color: "var(--foreground)",
        }}
      >
        {props.options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {props.groups
          ?.filter((g) => g.options.length > 0)
          .map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </label>
  );
}

export function MiniNumber(props: {
  label: string;
  value: string;
  onChangeAction: (n: number) => void;
}) {
  return (
    <label className="grid gap-1 min-w-0">
      <div
        className="text-[10px] font-semibold tracking-wide uppercase"
        style={{ color: "var(--muted)" }}
      >
        {props.label}
      </div>

      <NumberInput
        value={props.value}
        onChangeAction={(text) => props.onChangeAction(parseNumericDraft(text))}
        className="h-9 w-full min-w-0 rounded-xl border px-2 text-sm font-semibold tabular-nums"

        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 88%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
          color: "var(--foreground)",
        }}
      />
    </label>
  );
}



export function TabButton(props: {
  label: string;
  active: boolean;
  onClickAction: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClickAction}
      disabled={props.disabled}
      className="h-10 rounded-xl border px-3 text-sm font-semibold transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor: props.active
          ? "color-mix(in oklab, var(--primary) 45%, transparent)"
          : "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: props.active
          ? "color-mix(in oklab, var(--primary) 16%, var(--card))"
          : "color-mix(in oklab, var(--bg-base) 65%, transparent)",
        color: "var(--foreground)",
      }}
    >
      {props.label}
    </button>
  );
}