import { describe, expect, it } from "vitest";
import { restaurantHistoryUrl } from "../shareUrl";

describe("restaurant history links", () => {
  it("includes the saved restaurant name without changing the report ID", () => {
    const url = new URL(restaurantHistoryUrl("/s/report-id", "Host Luma"));
    expect(url.searchParams.get("restaurant")).toBe("Host Luma");
    expect(url.pathname).toBe("/s/report-id");
  });

  it("adds the name to old cached links and uses the public app origin", () => {
    expect(restaurantHistoryUrl("https://old-preview.example/s/cached-id", "Host Luma"))
      .toBe("https://my-linecheck.lovable.app/s/cached-id?restaurant=Host+Luma");
  });

  it("encodes special characters without losing any part of the restaurant name", () => {
    const url = new URL(restaurantHistoryUrl("/s/report-id", "Luma & مطعم #1"));
    expect(url.searchParams.get("restaurant")).toBe("Luma & مطعم #1");
    expect(url.hash).toBe("");
  });
});