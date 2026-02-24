import { num } from "./adminHelpers";

export function Field(props: {
  label: string;
  value: string;
  onChangeAction: (v: string) => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        {props.label}
      </div>

      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        inputMode={props.inputMode}
        onChange={(e) => props.onChangeAction(e.target.value)}
        className="h-10 w-full min-w-0  rounded-xl border px-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
          background: "color-mix(in oklab, var(--bg-base) 65%, transparent)",
          color: "var(--foreground)",
        }}
      />
    </label>
  );
}

export function Select(props: {
  label: string;
  value: string;
  onChangeAction: (v: string) => void;
  options: Array<[string, string]>;
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

      <input
        value={props.value}
        inputMode="numeric"
        onChange={(e) => props.onChangeAction(num(e.target.value))}
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
