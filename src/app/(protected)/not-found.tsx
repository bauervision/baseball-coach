import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-2xl border p-5"
      style={{
        borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
        background: "color-mix(in oklab, var(--card) 92%, transparent)",
      }}
    >
      <div className="text-lg font-semibold">Page not found</div>
      <div className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        That route doesn’t exist in this template.
      </div>
      <div className="mt-4">
        <Link
          href="/"
          className="rounded-xl border px-3 py-2 text-sm font-semibold inline-block"
          style={{
            borderColor: "color-mix(in oklab, var(--stroke) 92%, transparent)",
            background: "color-mix(in oklab, var(--bg-base) 70%, transparent)",
            color: "var(--foreground)",
          }}
        >
          Go home
        </Link>
      </div>
    </div>
  );
}