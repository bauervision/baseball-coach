export function NotAuthorized(props: { title?: string; message?: string }) {
  return (
    <div
      className="rounded-2xl border p-5 shadow-sm"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: "color-mix(in oklab, var(--card) 92%, transparent)",
      }}
    >
      <div className="text-lg font-semibold">
        {props.title ?? "Not authorized"}
      </div>
      <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        {props.message ?? "You don’t have access to this page."}
      </div>
    </div>
  );
}
