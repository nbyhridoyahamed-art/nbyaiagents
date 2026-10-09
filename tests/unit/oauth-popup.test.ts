import { describe, expect, it } from "vitest";
import { OAUTH_CHANNEL, OAUTH_STORAGE_KEY, isOAuthPopupResult } from "@/lib/integrations/oauth/popup";
import { escapeHtml, popupResultHtml, popupResultResponse, scriptJson } from "@/lib/integrations/oauth/popup-response";

describe("popup result protocol", () => {
  it("recognises a well-formed result and nothing else", () => {
    expect(isOAuthPopupResult({ ok: true, message: "Google connected.", provider: "google", at: Date.now() })).toBe(true);
    for (const bad of [null, undefined, "ok", 1, {}, { ok: "yes", message: "m", provider: "p", at: 1 }, { ok: true, message: 5, provider: "p", at: 1 }, { ok: true, message: "m", provider: "p" }]) {
      expect(isOAuthPopupResult(bad)).toBe(false);
    }
  });
});

describe("scriptJson", () => {
  it("cannot be broken out of a script element", () => {
    const hostile = '</script><script>alert(1)</script> & <!-- ' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    const out = scriptJson({ message: hostile });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
    // ...and still decodes to exactly what was put in.
    expect(JSON.parse(out)).toEqual({ message: hostile });
  });
});

describe("popupResultHtml", () => {
  it("reports success to the opener over the same-origin channels and closes itself", () => {
    const html = popupResultHtml({ ok: true, message: "Google connected.", provider: "google" }, 1_700_000_000_000);
    expect(html).toContain("You&#39;re connected");
    expect(html).toContain("Google connected.");
    expect(html).toContain(`new BroadcastChannel(${JSON.stringify(OAUTH_CHANNEL)})`);
    expect(html).toContain(`localStorage.setItem(${JSON.stringify(OAUTH_STORAGE_KEY)}`);
    expect(html).toContain("window.opener.postMessage(result, window.location.origin)");
    expect(html).toContain('"ok":true');
    expect(html).toContain('"at":1700000000000');
    expect(html).toContain("setTimeout(close, 1200)");
    expect(html).toContain('href="/integrations"');
  });

  it("shows a failure for longer so it can be read", () => {
    const html = popupResultHtml({ ok: false, message: "Google sign-in was cancelled.", provider: "google" });
    expect(html).toContain("Couldn&#39;t connect");
    expect(html).toContain('"ok":false');
    expect(html).toContain("setTimeout(close, 3500)");
  });

  it("never lets provider-supplied text become markup or script", () => {
    const html = popupResultHtml({ ok: false, message: 'GitHub rejected the code: <img src=x onerror=alert(1)></script><script>alert(2)</script>', provider: "github" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // Exactly one script element: the one this page ships.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it("is served as uncached HTML", async () => {
    const res = popupResultResponse({ ok: true, message: "ok", provider: "google" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
