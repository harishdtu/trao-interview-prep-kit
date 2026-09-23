import { describe, it, expect } from "vitest";
import { rankLinks, scoreLink } from "../src/research/linkRanker";

describe("scoreLink", () => {
  it("scores a careers-related link higher than an unrelated one", () => {
    const careersScore = scoreLink("https://acme.com/careers", "Careers");
    const unrelatedScore = scoreLink("https://acme.com/products/widget", "Our Widget");
    expect(careersScore).toBeGreaterThan(unrelatedScore);
  });

  it("gives zero score to links with no relevant signal terms", () => {
    expect(scoreLink("https://acme.com/products/widget-3000", "Buy now")).toBe(0);
  });

  it("rewards multiple signal terms", () => {
    const score = scoreLink("https://acme.com/careers/engineering-culture", "Engineering Culture Careers");
    expect(score).toBeGreaterThanOrEqual(3);
  });
});

describe("rankLinks", () => {
  it("filters out zero-score links and sorts by score descending", () => {
    const links = [
      { url: "https://acme.com/products", text: "Products" },
      { url: "https://acme.com/careers", text: "Careers" },
      { url: "https://acme.com/careers/engineering", text: "Engineering roles" },
    ];
    const ranked = rankLinks(links, 10);
    expect(ranked.map((r) => r.url)).not.toContain("https://acme.com/products");
    expect(ranked[0].url).toBe("https://acme.com/careers/engineering");
  });

  it("respects the maxLinks bound", () => {
    const links = Array.from({ length: 20 }, (_, i) => ({
      url: `https://acme.com/careers/${i}`,
      text: "Careers",
    }));
    const ranked = rankLinks(links, 5);
    expect(ranked).toHaveLength(5);
  });

  it("de-duplicates the same URL, keeping the best score", () => {
    const links = [
      { url: "https://acme.com/careers", text: "Home" },
      { url: "https://acme.com/careers", text: "Careers and hiring" },
    ];
    const ranked = rankLinks(links, 10);
    expect(ranked).toHaveLength(1);
  });
});
