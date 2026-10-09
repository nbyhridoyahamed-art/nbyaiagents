import { OAUTH_CHANNEL, OAUTH_STORAGE_KEY, type OAuthPopupResult } from "@/lib/integrations/oauth/popup";

/** The small page the sign-in popup lands on at the end: it tells the opener how it went, then closes itself. */

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** JSON that cannot break out of a <script> element, whatever text (provider error messages included) it holds. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

export function popupResultHtml(result: Omit<OAuthPopupResult, "at">, at = Date.now()): string {
  const payload: OAuthPopupResult = { ...result, at };
  const title = result.ok ? "You're connected" : "Couldn't connect";
  const closeAfterMs = result.ok ? 1200 : 3500;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Virtual Desks Online</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f8fa; --fg: #111827; --muted: #6b7280; --card: #ffffff; --line: #e5e7eb; --accent: #5b5fef; --ok: #12b76a; --bad: #d92d20; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --fg: #f3f4f6; --muted: #9ca3af; --card: #171a21; --line: #2a2f3a; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
  main { width: 100%; max-width: 380px; padding: 32px 24px; text-align: center; background: var(--card); border: 1px solid var(--line); border-radius: 16px; }
  .badge { display: inline-grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; font-size: 24px; font-weight: 700; color: #fff; background: ${result.ok ? "var(--ok)" : "var(--bad)"}; }
  h1 { margin: 16px 0 6px; font-size: 18px; }
  p { margin: 0 0 8px; color: var(--muted); overflow-wrap: anywhere; }
  .actions { margin-top: 20px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  a, button { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--fg); text-decoration: none; cursor: pointer; }
  a.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
</head>
<body>
<main>
  <div class="badge" aria-hidden="true">${result.ok ? "&#10003;" : "!"}</div>
  <h1>${escapeHtml(title)}</h1>
  <p id="message">${escapeHtml(result.message)}</p>
  <p>This window closes by itself. If it stays open, you can close it.</p>
  <div class="actions">
    <a class="primary" href="/integrations">Back to Integrations</a>
    <button type="button" id="close">Close window</button>
  </div>
</main>
<script>
(function () {
  var result = ${scriptJson(payload)};
  try { var channel = new BroadcastChannel(${scriptJson(OAUTH_CHANNEL)}); channel.postMessage(result); channel.close(); } catch (e) {}
  try { localStorage.setItem(${scriptJson(OAUTH_STORAGE_KEY)}, JSON.stringify(result)); } catch (e) {}
  try { if (window.opener) window.opener.postMessage(result, window.location.origin); } catch (e) {}
  var close = function () { try { window.close(); } catch (e) {} };
  document.getElementById("close").addEventListener("click", close);
  setTimeout(close, ${closeAfterMs});
})();
</script>
</body>
</html>`;
}

export function popupResultResponse(result: Omit<OAuthPopupResult, "at">): Response {
  return new Response(popupResultHtml(result), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
