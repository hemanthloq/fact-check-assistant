/** Formatting helpers shared by server and client components (no server-only imports). */

const STEPS: [seconds: number, unit: string][] = [
  [1, "second"],
  [60, "minute"],
  [3600, "hour"],
  [86_400, "day"],
  [2_592_000, "month"],
  [31_536_000, "year"],
];

/** "3 hours ago". Picks the largest unit that still gives a count of at least one. */
export function timeAgo(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.max(0, (Date.now() - then.getTime()) / 1000);
  if (seconds < 5) return "just now";

  let chosen = STEPS[0];
  for (const step of STEPS) {
    if (seconds >= step[0]) chosen = step;
  }
  const count = Math.floor(seconds / chosen[0]);
  return `${count} ${chosen[1]}${count === 1 ? "" : "s"} ago`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
