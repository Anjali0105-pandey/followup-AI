import "server-only";
import db from "@/lib/db";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/crypto";

/**
 * User-supplied AI provider keys.
 *
 * The asymmetry here is deliberate and is the whole security model: the
 * *write* path takes plaintext, the *read* path for anything UI-facing returns
 * only a masked hint, and the plaintext getter is named loudly enough that a
 * reviewer notices it being called somewhere it shouldn't be.
 */

export type AiProvider = "gemini";

export interface StoredKeyInfo {
  provider: AiProvider | null;
  /** Safe to render — e.g. "AIza…4Xk2". Null when no key is stored. */
  hint: string | null;
  updatedAt: string | null;
}

/** Shape a Settings page can render without ever touching the secret. */
export async function getKeyInfo(userId: number): Promise<StoredKeyInfo> {
  const row = await db.get<{
    ai_key_provider: AiProvider | null;
    ai_key_hint: string | null;
    ai_key_updated_at: Date | null;
  }>(
    "SELECT ai_key_provider, ai_key_hint, ai_key_updated_at FROM users WHERE id = ?",
    userId,
  );
  return {
    provider: row?.ai_key_provider ?? null,
    hint: row?.ai_key_hint ?? null,
    updatedAt: row?.ai_key_updated_at ? row.ai_key_updated_at.toISOString() : null,
  };
}

export async function setUserApiKey(userId: number, provider: AiProvider, plaintext: string): Promise<void> {
  const trimmed = plaintext.trim();
  if (!trimmed) throw new Error("API key cannot be empty");

  await db.run(
    `UPDATE users
     SET ai_key_provider = ?, ai_key_ciphertext = ?, ai_key_hint = ?, ai_key_updated_at = now()
     WHERE id = ?`,
    provider,
    encryptSecret(trimmed),
    keyHint(trimmed),
    userId,
  );
}

export async function clearUserApiKey(userId: number): Promise<void> {
  await db.run(
    `UPDATE users
     SET ai_key_provider = NULL, ai_key_ciphertext = NULL, ai_key_hint = NULL, ai_key_updated_at = NULL
     WHERE id = ?`,
    userId,
  );
}

/**
 * What the signed-in user will actually get, as opposed to what the server is
 * configured with. A user's own key makes the product live even when no
 * server-wide key exists, and the UI must say so — a "mock mode" badge next to
 * a working key reads as a bug.
 */
export async function effectiveAiMode(userId: number): Promise<"live" | "mock"> {
  if (process.env.GEMINI_API_KEY) return "live";
  const row = await db.get<{ ai_key_ciphertext: string | null }>(
    "SELECT ai_key_ciphertext FROM users WHERE id = ?",
    userId,
  );
  return row?.ai_key_ciphertext ? "live" : "mock";
}

/**
 * Decrypts the stored key. ONLY for server-side calls to the AI provider —
 * never return this value from a Server Action, never put it in a prop, never
 * log it. Returns null when the user has not supplied one, so callers fall
 * back to the server-wide key or to mock mode.
 */
export async function getDecryptedApiKeyForServerUse(userId: number): Promise<string | null> {
  const row = await db.get<{ ai_key_ciphertext: string | null }>(
    "SELECT ai_key_ciphertext FROM users WHERE id = ?",
    userId,
  );
  if (!row?.ai_key_ciphertext) return null;
  try {
    return decryptSecret(row.ai_key_ciphertext);
  } catch {
    // A key encrypted under a rotated ENCRYPTION_KEY is unrecoverable. Degrade
    // to the server key rather than taking the request down.
    return null;
  }
}
