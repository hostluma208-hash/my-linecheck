// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getKeyRevision, lsStore, setUserScope } from "@/lib/lsStore";

describe("lsStore per-key revisions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setUserScope("revision-test");
  });

  it("increments for repeated same-value writes", () => {
    const key = "linecheck:section:GRILL:2026-08-05";
    lsStore.setItem(key, '{"status":"OK"}');
    const first = getKeyRevision(key);
    lsStore.setItem(key, '{"status":"OK"}');

    expect(getKeyRevision(key)).toBe(first + 1);
  });

  it("keeps revisions isolated by station key and account scope", () => {
    const stationA = "linecheck:section:A:2026-08-05";
    const stationB = "linecheck:section:B:2026-08-05";
    lsStore.setItem(stationA, "one");

    expect(getKeyRevision(stationA)).toBe(1);
    expect(getKeyRevision(stationB)).toBe(0);

    setUserScope("another-account");
    expect(getKeyRevision(stationA)).toBe(0);
  });
});