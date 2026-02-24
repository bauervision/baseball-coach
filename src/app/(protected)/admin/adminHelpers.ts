
export type GameResult = "W" | "L" | "T";

export type LineDelta = {
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  hitByPitch: number;
};

export type LineState = {
  hidden: boolean;
  delta: LineDelta;
};

export const EMPTY_DELTA: LineDelta = {
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  hitByPitch: 0,
};

export function anyNonZero(d: LineDelta) {
  return (
    d.atBats !== 0 ||
    d.hits !== 0 ||
    d.doubles !== 0 ||
    d.triples !== 0 ||
    d.homeRuns !== 0 ||
    d.runs !== 0 ||
    d.rbi !== 0 ||
    d.walks !== 0 ||
    d.hitByPitch !== 0
  );
}

export function num(v: string): number {
  const t = v.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function todayISO() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}