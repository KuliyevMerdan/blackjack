/** p50, p90, p99 and the worst of a set of durations, rounded to the millisecond. */
export function percentiles(values: readonly number[]): {
  count: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
  return { count: sorted.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: at(1) };
}
