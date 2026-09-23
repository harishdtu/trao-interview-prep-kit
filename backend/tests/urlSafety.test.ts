import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkUrlSafety } from "../src/retrieval/urlSafety";

describe("checkUrlSafety", () => {
  const originalEnv = process.env.ALLOW_PRIVATE_FETCHES;
  afterEach(() => {
    process.env.ALLOW_PRIVATE_FETCHES = originalEnv;
  });

  it("rejects invalid URLs", () => {
    expect(checkUrlSafety("not a url").safe).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(checkUrlSafety("ftp://example.com").safe).toBe(false);
  });

  it("allows a normal public https URL", () => {
    expect(checkUrlSafety("https://example.com/careers").safe).toBe(true);
  });

  it("blocks IPv4 private/loopback/link-local ranges", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.1/",
      "http://0.0.0.0/",
      "http://169.254.169.254/", // cloud metadata endpoint
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.20.0.1/",
    ]) {
      expect(checkUrlSafety(url).safe, url).toBe(false);
    }
  });

  it("blocks numeric-encoded loopback forms (decimal/hex/octal)", () => {
    for (const url of ["http://2130706433/", "http://0x7f000001/", "http://017700000001/"]) {
      expect(checkUrlSafety(url).safe, url).toBe(false);
    }
  });

  it("blocks IPv6 loopback, link-local, and unique-local addresses", () => {
    for (const url of [
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
    ]) {
      expect(checkUrlSafety(url).safe, url).toBe(false);
    }
  });

  it("blocks IPv4-mapped IPv6 addresses that encode a private IPv4 range", () => {
    // Node normalizes the dotted-quad form into hex-group form; both must be blocked.
    expect(checkUrlSafety("http://[::ffff:127.0.0.1]/").safe).toBe(false);
    expect(checkUrlSafety("http://[::ffff:7f00:1]/").safe).toBe(false);
  });

  it("allows private/loopback addresses only when ALLOW_PRIVATE_FETCHES=true", async () => {
    process.env.ALLOW_PRIVATE_FETCHES = "true";
    vi.resetModules();
    const { checkUrlSafety: checkUrlSafetyAllowed } = await import("../src/retrieval/urlSafety");
    expect(checkUrlSafetyAllowed("http://127.0.0.1:8099/").safe).toBe(true);
    expect(checkUrlSafetyAllowed("http://[::1]:8099/").safe).toBe(true);
    delete process.env.ALLOW_PRIVATE_FETCHES;
    vi.resetModules();
  });
});
