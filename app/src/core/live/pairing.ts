/**
 * Pairing a computer with Lumière Live. The secret is random and stays on this computer; the robot
 * code carries only its SHA-256, so the generated Java can be shared or committed without letting
 * anyone else pair.
 */

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** A new pairing secret: 32 random bytes as 64 hexadecimal digits. */
export function newPairingSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** The SHA-256 of a pairing secret, as the generated `LumiereLive.java` stores it. */
export async function pairingHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return hex(new Uint8Array(digest));
}

/** True for a well-formed pairing hash: 64 lowercase hexadecimal digits. */
export function isPairingHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
