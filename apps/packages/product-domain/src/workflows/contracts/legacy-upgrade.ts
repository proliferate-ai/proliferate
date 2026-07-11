/**
 * Deterministic UUIDv5 identity derivation for the legacy-definition upgrade
 * (feature spec §5.1). Matches the Python `legacy_upgrade.py` output.
 */

import { sha1Bytes, utf8Bytes } from "./hashing";

/** Fixed Proliferate workflow-identity namespace (feature spec §5.1). */
export const PROLIFERATE_WORKFLOW_NAMESPACE = "2b5e907a-2cd8-5b8f-b5ab-5c891bb93263";

export type LegacyIdentityKind = "slot" | "node" | "group" | "lane" | "step";

const KINDS: ReadonlySet<string> = new Set(["slot", "node", "group", "lane", "step"]);

export function legacyIdentityName(
  workflowVersionId: string,
  kind: LegacyIdentityKind,
  identity: string,
): string {
  if (!KINDS.has(kind)) {
    throw new Error(`unknown identity kind ${kind}`);
  }
  return `workflow-version=${workflowVersionId}\nkind=${kind}\nidentity=${identity}`;
}

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function formatUuid(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuid5(namespace: string, name: string): string {
  const ns = uuidBytes(namespace);
  const nameBytes = utf8Bytes(name);
  const combined = new Uint8Array(ns.length + nameBytes.length);
  combined.set(ns);
  combined.set(nameBytes, ns.length);
  const hash = sha1Bytes(combined);
  const out = hash.slice(0, 16);
  out[6] = (out[6] & 0x0f) | 0x50; // version 5
  out[8] = (out[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(out);
}

export function deriveLegacyId(
  workflowVersionId: string,
  kind: LegacyIdentityKind,
  identity: string,
): string {
  return uuid5(PROLIFERATE_WORKFLOW_NAMESPACE, legacyIdentityName(workflowVersionId, kind, identity));
}
