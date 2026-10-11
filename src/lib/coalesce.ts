/** Wraps a handler so bursts of calls (e.g. many storage events from one tap
 *  or a sync pull) run it at most once per `delay` ms, on the trailing edge. */
export function coalesce(fn: () => void, delay = 120): (() => void) & { cancel(): void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (t) return;
    t = setTimeout(() => {
      t = null;
      fn();
    }, delay);
  };
  return Object.assign(run, { cancel: () => { if (t) clearTimeout(t); t = null; } });
}
