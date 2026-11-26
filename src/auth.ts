// Shared-password login. The password lives only in the SITE_PASSWORD secret.
// After login the browser holds a signed cookie "<expiry>.<hmac>"; the HMAC key is derived
// from the password, so changing the password logs every device out.

const enc = new TextEncoder();
export const COOKIE_NAME = "rs_session";
export const SESSION_SECONDS = 180 * 24 * 60 * 60;

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function key(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode("resale-session-v1:" + password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Constant-time password check: both sides are hashed to equal length first. */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function makeToken(password: string): Promise<string> {
  const payload = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const sig = await crypto.subtle.sign("HMAC", await key(password), enc.encode(payload));
  return payload + "." + b64url(sig);
}

export async function tokenValid(password: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const sig = fromB64url(token.slice(dot + 1));
  if (!sig) return false;
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", await key(password), sig, enc.encode(payload));
}
