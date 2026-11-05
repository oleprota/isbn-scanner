// The cooldown of the card's refresh button: one refresh locks every refresh, for every book, for COOLDOWN_MS.
// Kept in memory only: a page reload resets it.
export const COOLDOWN_MS = 60000;

export function createRefreshGate({ now = Date.now, cooldownMs = COOLDOWN_MS } = {}) {
  let until = 0;
  return {
    ready: () => now() >= until,
    start() { until = now() + cooldownMs; },
    left: () => Math.max(0, until - now()),
  };
}
