import crypto from "crypto";

/**
 * AES-256-GCM encryption for social media credentials at rest.
 * Requires env SOCIAL_ENCRYPTION_KEY: hex-encoded 32-byte key
 * (generate: `openssl rand -hex 32`).
 *
 * Output shape (stored in DB Json column):
 *   { v: 1, iv: <hex>, tag: <hex>, data: <hex> }
 */

export interface EncryptedBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function getKey(): Buffer {
  const hex = process.env.SOCIAL_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "SOCIAL_ENCRYPTION_KEY env var is required (hex-encoded 32-byte key)",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `SOCIAL_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptCredentials(plain: Record<string, unknown>): EncryptedBlob {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

export function decryptCredentials<T = Record<string, unknown>>(blob: unknown): T {
  if (!blob || typeof blob !== "object") {
    throw new Error("Invalid encrypted blob");
  }
  const b = blob as Partial<EncryptedBlob>;
  if (b.v !== 1 || !b.iv || !b.tag || !b.data) {
    throw new Error("Invalid encrypted blob shape");
  }
  const key = getKey();
  const iv = Buffer.from(b.iv, "hex");
  const tag = Buffer.from(b.tag, "hex");
  const data = Buffer.from(b.data, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.v === 1 && typeof v.iv === "string" && typeof v.tag === "string" && typeof v.data === "string";
}
