// ═══════════════════════════════════════════════════════════════════════
// TOKEN ENCRYPTION AT REST — broker session blobs (access/refresh tokens) are
// sensitive; they are NEVER stored in plaintext. This wraps AES-256-GCM (authenticated
// encryption: confidentiality + tamper detection) behind two functions.
//
// KEY: 32 bytes from env BROKER_TOKEN_ENC_KEY, base64-encoded (generate with
//   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
// The key lives ONLY in env — never in the DB, never in a migration, never logged. Losing
// it makes every stored session undecryptable (by design); rotating it is a v2 concern.
//
// FORMAT: `v1:<iv b64>:<authTag b64>:<ciphertext b64>` — the `v1` prefix reserves a clean
// path for key rotation / algo change without ambiguity. A random 12-byte IV per encrypt
// (GCM nonce) means identical plaintexts yield different blobs (no equality leakage).
//
// FAIL-CLOSED: a missing/malformed key throws on first use (broker ops fail loudly rather
// than silently persisting a plaintext token). The key is resolved lazily + cached so
// merely importing this module never crashes an app context that touches no broker code.
// ═══════════════════════════════════════════════════════════════════════
import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = "v1";

/** Thrown when the encryption key is absent/malformed. The controllers catch THIS and
 *  return 503 feature_unavailable — a missing key must DEGRADE the broker feature, NOT
 *  crash the platform (fail-closed, per the confirmed law). Never leaks the key. */
export class BrokerEncryptionUnavailableError extends Error {
  constructor(reason: string) {
    super(`broker token encryption unavailable: ${reason}`);
    this.name = "BrokerEncryptionUnavailableError";
  }
}

let cachedKey: Buffer | null = null;

/** Resolve + validate the 32-byte key once. Throws BrokerEncryptionUnavailableError if
 *  absent/malformed — resolved lazily (on first use), so importing this module never
 *  touches the key and app boot is never blocked by its absence. */
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.BROKER_TOKEN_ENC_KEY;
  if (!raw) {
    throw new BrokerEncryptionUnavailableError("BROKER_TOKEN_ENC_KEY is not set");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new BrokerEncryptionUnavailableError(
      `BROKER_TOKEN_ENC_KEY must decode to 32 bytes (got ${buf.length})`,
    );
  }
  cachedKey = buf;
  return buf;
}

/** Encrypt a plaintext secret → the versioned, self-describing blob stored in the DB. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a blob produced by encryptSecret. Throws on a tampered/corrupt blob (GCM auth
 *  tag mismatch) or an unknown version — never returns a partial/garbage plaintext. */
export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("malformed broker token blob (bad version/shape)");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/** Convenience: encrypt a JSON-serialisable value (e.g. a BrokerSession) as one blob. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

/** Convenience: decrypt a blob back into a typed value. Caller asserts the shape. */
export function decryptJson<T>(blob: string): T {
  return JSON.parse(decryptSecret(blob)) as T;
}
