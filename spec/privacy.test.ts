import { describe, expect, inject, it } from "vitest";

const baseUrl = inject("baseUrl");

describe("privacy", () => {
  it("lets the game page connect only to this server and the pose model's download hosts", async () => {
    for (const path of ["/", "/room-link-fallback"]) {
      const res = await fetch(new URL(path, baseUrl));
      const csp = res.headers.get("content-security-policy") ?? "";
      const connect = csp.match(/connect-src ([^;]+)/)?.[1].trim().split(/\s+/);
      expect(connect).toEqual(["'self'", "https://cdn.jsdelivr.net", "https://storage.googleapis.com"]);
    }
  });
});
