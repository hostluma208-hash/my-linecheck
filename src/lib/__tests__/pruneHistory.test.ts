import { describe, it, expect, beforeEach } from "vitest";

const store = new Map<string, string>();
(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
};
(globalThis as any).window.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
  clear: () => store.clear(),
};

describe("pruneOldHistory", () => {
  beforeEach(() => store.clear());

  it("deletes dated linecheck records older than 3 months", async () => {
    const { pruneOldHistory } = await import("@/lib/lineCheck");
    const old = new Date();
    old.setMonth(old.getMonth() - 4);
    const oldDate = old.toISOString().slice(0, 10);
    const recent = new Date().toISOString().slice(0, 10);
    store.set(`linecheck:section:NIKK:${oldDate}`, "{}");
    store.set(`linecheck:section:NIKK:${recent}`, "{}");
    store.set("linecheck:settings:staff", "[]");
    const removed = pruneOldHistory(3);
    expect(removed).toBe(1);
    expect(store.has(`linecheck:section:NIKK:${oldDate}`)).toBe(false);
    expect(store.has(`linecheck:section:NIKK:${recent}`)).toBe(true);
    expect(store.has("linecheck:settings:staff")).toBe(true);
  });

  it("keeps records from exactly 3 months ago", async () => {
    const { pruneOldHistory } = await import("@/lib/lineCheck");
    const edge = new Date();
    edge.setMonth(edge.getMonth() - 3);
    const d = edge.toISOString().slice(0, 10);
    store.set(`linecheck:section:NIKK:${d}`, "{}");
    expect(pruneOldHistory(3)).toBe(0);
    expect(store.has(`linecheck:section:NIKK:${d}`)).toBe(true);
  });
});
