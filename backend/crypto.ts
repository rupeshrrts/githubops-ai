import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// GitHub tokens are stored encrypted with AES-256-GCM, so a leaked database dump or
// backup is useless without TOKEN_ENCRYPTION_KEY (which lives only in the deployment env).
const PREFIX = "enc:v1:";

type Env = Record<string, string | undefined>;

function key(env: Env = process.env): Buffer {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return bytes;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string, env?: Env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(stored: string, env?: Env): string {
  if (!isEncrypted(stored)) throw new Error("Value is not encrypted");
  const [iv, tag, data] = stored.slice(PREFIX.length).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(env), iv);
  decipher.setAuthTag(tag); // tampered ciphertext fails here
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
