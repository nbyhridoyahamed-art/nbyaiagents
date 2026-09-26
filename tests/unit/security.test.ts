import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint, signValue, verifySignedValue } from "@/lib/security/crypto";
import { REDACTED, redact, redactString } from "@/lib/security/redact";
import { hashPassword, verifyPassword } from "@/lib/security/password";
import { passwordProblems } from "@/lib/security/password-rules";

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const secret = "sk-test-super-secret-value-1234";
    const ct = encryptSecret(secret);
    expect(ct).not.toContain(secret);
    expect(decryptSecret(ct)).toBe(secret);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("detects tampering", () => {
    const ct = encryptSecret("value");
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("hints reveal at most four characters", () => {
    expect(secretHint("abcdefghijklmnop")).toBe("••••mnop");
    expect(secretHint("short")).toBe("••••");
  });
});

describe("signed values", () => {
  it("verifies and expires", () => {
    const exp = Date.now() + 60_000;
    const sig = signValue("file_1", exp);
    expect(verifySignedValue("file_1", exp, sig)).toBe(true);
    expect(verifySignedValue("file_2", exp, sig)).toBe(false);
    expect(verifySignedValue("file_1", Date.now() - 1, signValue("file_1", Date.now() - 1))).toBe(false);
  });
});

describe("redaction", () => {
  it("redacts sensitive keys recursively", () => {
    const out = redact({ headers: { Authorization: "Bearer abc", "X-Api-Key": "k" }, body: { password: "p", name: "Sarah" } });
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.headers["X-Api-Key"]).toBe(REDACTED);
    expect(out.body.password).toBe(REDACTED);
    expect(out.body.name).toBe("Sarah");
  });

  it("redacts key-like values inside free text", () => {
    const s = redactString("failed with key sk-ant-abcdefghijklmnopqrstuvwx and Bearer eyJhbGciOiJIUzI1NiJ9.x.y");
    expect(s).not.toContain("sk-ant-abcdefghijklmnop");
    expect(s).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct horse 42");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 42", hash)).toBe(true);
    expect(await verifyPassword("wrong horse 42", hash)).toBe(false);
  });

  it("enforces minimum strength", () => {
    expect(passwordProblems("short1")).not.toBeNull();
    expect(passwordProblems("onlyletterslong")).not.toBeNull();
    expect(passwordProblems("letters-and-1234")).toBeNull();
  });
});
