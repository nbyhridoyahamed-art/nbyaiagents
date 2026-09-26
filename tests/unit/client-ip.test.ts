import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "@/lib/security/client-ip";

const h = (xff?: string, real?: string) => new Headers({ ...(xff ? { "x-forwarded-for": xff } : {}), ...(real ? { "x-real-ip": real } : {}) });

describe("client IP", () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });
  it("ignores client-supplied X-Forwarded-For entries and uses the proxy-appended one", () => {
    // A client sends a fake first hop; our proxy appends the real address.
    expect(clientIp(h("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    process.env.TRUSTED_PROXY_HOPS = "2"; // CDN → load balancer → app
    expect(clientIp(h("1.2.3.4, 203.0.113.9, 10.0.0.2"))).toBe("203.0.113.9");
    expect(clientIp(h("203.0.113.9"))).toBe("203.0.113.9");
  });
  it("falls back to X-Real-IP", () => {
    expect(clientIp(h(undefined, "198.51.100.7"))).toBe("198.51.100.7");
    expect(clientIp(h())).toBeUndefined();
  });
});
