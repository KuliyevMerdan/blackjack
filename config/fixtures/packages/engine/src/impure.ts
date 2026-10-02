// FIXTURE — every line in the function must be rejected by the purity rules in eslint.config.mjs.
export function impure() {
  const roll = Math.random();
  const now = Date.now();
  const stamp = new Date();
  const mark = performance.now();
  const env = process.env.BJ_DECKS;
  return { roll, now, stamp, mark, env };
}
