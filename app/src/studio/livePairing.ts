/**
 * Lumière Live pairing for a project on this computer. Like the FTC SDK link it is kept in local
 * storage, never in the project file: the secret is what lets this computer, and only this one, send
 * programs to the Lumière Live it deployed.
 */
import { isPairingHash, newPairingSecret, pairingHash } from "../core";

export interface LivePairing {
  version: 1;
  /** 64 hexadecimal digits. The robot code carries only its SHA-256. */
  secret: string;
  pairingHash: string;
}

const key = (projectId: string) => `lumiere-live-${projectId}`;

export function loadLivePairing(projectId: string): LivePairing | null {
  try {
    const stored = localStorage.getItem(key(projectId));
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<LivePairing>;
    if (value.version === 1 && typeof value.secret === "string" && /^[0-9a-f]{64}$/.test(value.secret) && isPairingHash(value.pairingHash)) {
      return { version: 1, secret: value.secret, pairingHash: value.pairingHash };
    }
  } catch {
    // Unreadable storage behaves like Live runs being off.
  }
  return null;
}

export function saveLivePairing(projectId: string, pairing: LivePairing | null) {
  try {
    if (pairing) localStorage.setItem(key(projectId), JSON.stringify(pairing));
    else localStorage.removeItem(key(projectId));
  } catch {
    // The pairing still works for this session.
  }
}

/** A new pairing: a fresh secret, so turning Live runs off and on again unpairs every older deploy. */
export async function createLivePairing(): Promise<LivePairing> {
  const secret = newPairingSecret();
  return { version: 1, secret, pairingHash: await pairingHash(secret) };
}
