import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTEGRATIONS, showDemoIntegrations } from "@/lib/integrations/catalog";

const saved = { show: process.env.SHOW_DEMO_INTEGRATIONS, node: process.env.NODE_ENV };
const setEnv = (name: "SHOW_DEMO_INTEGRATIONS" | "NODE_ENV", value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else (process.env as Record<string, string>)[name] = value;
};

beforeEach(() => setEnv("SHOW_DEMO_INTEGRATIONS", undefined));
afterEach(() => {
  setEnv("SHOW_DEMO_INTEGRATIONS", saved.show);
  setEnv("NODE_ENV", saved.node);
});

describe("showDemoIntegrations", () => {
  it("shows demos in development and tests, hides them in production", () => {
    setEnv("NODE_ENV", "development");
    expect(showDemoIntegrations()).toBe(true);
    setEnv("NODE_ENV", "test");
    expect(showDemoIntegrations()).toBe(true);
    setEnv("NODE_ENV", "production");
    expect(showDemoIntegrations()).toBe(false);
  });

  it("lets SHOW_DEMO_INTEGRATIONS override either way", () => {
    setEnv("NODE_ENV", "production");
    setEnv("SHOW_DEMO_INTEGRATIONS", "true");
    expect(showDemoIntegrations()).toBe(true);
    setEnv("NODE_ENV", "development");
    setEnv("SHOW_DEMO_INTEGRATIONS", "false");
    expect(showDemoIntegrations()).toBe(false);
    setEnv("SHOW_DEMO_INTEGRATIONS", " TRUE ");
    expect(showDemoIntegrations()).toBe(true);
  });
});

describe("catalog", () => {
  it("lists Search Console, Analytics and GitHub as real integrations", () => {
    for (const key of ["google_search_console", "google_analytics"]) {
      const i = INTEGRATIONS.find((x) => x.key === key)!;
      expect(i).toMatchObject({ authType: "oauth2", provider: "google", availability: "requires_setup", category: "Marketing" });
      expect(i.simulated).toBeUndefined();
    }
    // GitHub signs in through its own OAuth app when the operator has registered one, and still accepts a pasted token.
    expect(INTEGRATIONS.find((x) => x.key === "github")).toMatchObject({ authType: "oauth2", provider: "github", tokenFallback: true, availability: "requires_setup" });
  });

  it("only offers a Connect button for integrations that can actually be connected", () => {
    // Google Drive has no tools yet, so it must not claim to be waiting on the operator.
    expect(INTEGRATIONS.find((x) => x.key === "google_drive")).toMatchObject({ availability: "coming_soon" });
    for (const i of INTEGRATIONS.filter((x) => x.availability === "requires_setup")) {
      expect(i.authType, `${i.key} needs a way to connect`).toBeDefined();
    }
  });

  it("flags exactly the mock integrations as simulated demos", () => {
    const simulated = INTEGRATIONS.filter((i) => i.simulated).map((i) => i.key);
    expect(simulated.length).toBeGreaterThan(0);
    expect(simulated.every((k) => k.startsWith("mock_"))).toBe(true);
  });
});
