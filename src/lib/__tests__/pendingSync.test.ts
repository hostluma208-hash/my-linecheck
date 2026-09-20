// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  markDirty,
  getDirty,
  clearDirty,
  hasDirty,
  dirtyCount,
  backoffDelay,
  clearAllDirty,
} from "@/lib/pendingSync";

describe("pendingSync queue", () => {
  beforeEach(() => clearAllDirty("u1"));

  it("persists dirty keys across module reads (localStorage backed)", () => {
    markDirty("u1", "linecheck:shift:a");
    markDirty("u1", "linecheck:shift:a");
    markDirty("u1", "linecheck:shift:b");
    expect(dirtyCount("u1")).toBe(2);
    expect(window.localStorage.getItem("linecheck:pending:u1")).toContain("shift:b");
  });

  it("clears only the keys included in a successful push", () => {
    markDirty("u1", "a");
    markDirty("u1", "b");
    const inFlight = getDirty("u1");
    markDirty("u1", "c"); // arrives mid-flight
    clearDirty("u1", inFlight);
    expect([...getDirty("u1")]).toEqual(["c"]);
    expect(hasDirty("u1")).toBe(true);
  });

  it("keeps scopes isolated", () => {
    markDirty("u1", "a");
    expect(hasDirty("u2")).toBe(false);
  });

  it("backs off exponentially and caps at 30s", () => {
    expect(backoffDelay(1)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelay(3)).toBeGreaterThanOrEqual(4000);
    expect(backoffDelay(20)).toBeLessThanOrEqual(30300);
  });
});
