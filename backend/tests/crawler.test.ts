import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

let server: http.Server;
let baseUrl: string;

const pages: Record<string, string> = {
  "/": `<html><head><title>Acme Home</title></head><body>
      <nav><a href="/careers">Careers</a><a href="/products">Products</a><a href="/about">About</a></nav>
      <p>Welcome to Acme, we build widgets.</p>
    </body></html>`,
  "/careers": `<html><head><title>Careers at Acme</title></head><body>
      <p>We are hiring engineers. Our interview process has 3 rounds.</p>
    </body></html>`,
  "/about": `<html><head><title>About Acme</title></head><body>
      <p>Acme was founded in 2010 and builds developer tools.</p>
    </body></html>`,
  "/products": `<html><head><title>Products</title></head><body><p>Buy our widgets.</p></body></html>`,
};

beforeAll(async () => {
  process.env.ALLOW_PRIVATE_FETCHES = "true";
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    if (path === "/404") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = pages[path];
    if (body) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
  delete process.env.ALLOW_PRIVATE_FETCHES;
});

describe("crawlSite", () => {
  it("fetches the homepage and discovers/ranks linked pages dynamically", async () => {
    const { crawlSite } = await import("../src/research/crawler");
    const result = await crawlSite(baseUrl, 4);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(baseUrl);
    // careers should be discovered even though we never hardcoded the path
    expect(urls.some((u) => u.includes("/careers"))).toBe(true);
    expect(result.pages.find((p) => p.url.includes("careers"))?.text).toContain("hiring");
  });

  it("bounds the crawl to maxPages", async () => {
    const { crawlSite } = await import("../src/research/crawler");
    const result = await crawlSite(baseUrl, 2);
    expect(result.pages.length).toBeLessThanOrEqual(2);
  });

  it("records a failed homepage fetch without throwing", async () => {
    const { crawlSite } = await import("../src/research/crawler");
    const result = await crawlSite(baseUrl + "/404", 4);
    expect(result.pages).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toMatch(/404/);
  });
});
