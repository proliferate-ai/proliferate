/**
 * TypeScript leg of T1-WF-CONTRACT-01.
 *
 * Parses/serializes every shared golden workflow contract fixture, recomputes
 * every canonical hash with the pure-TS implementation, validates the emit
 * schema profile and its invalid cases, proves the deterministic legacy UUIDv5
 * upgrade, and asserts the credential canary is absent from public surfaces.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canonicalize, contentHash, hashExcluding } from "./canonical";
import { deriveLegacyId, type LegacyIdentityKind } from "./legacy-upgrade";
import { SchemaProfileError, validateSchemaProfile } from "./schema-profile";
import {
  normalizeCheckpointManifest,
  parseCheckpointManifest,
  parseExecutionBinding,
  parseExecutionEnvelope,
  parseGatewayCallReceipt,
  parseMaterializationOffer,
  parseObservedRun,
  parseResolvedPlan,
  parseWorkflowControlCommand,
} from "./types";
import { toPublicRunView, type ObservedRunWire } from "./adapters";

function fixture<T = Record<string, unknown>>(name: string): T {
  const url = new URL(`../../../../../../tests/contracts/workflows/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8")) as T;
}

function fixtureText(name: string): string {
  const url = new URL(`../../../../../../tests/contracts/workflows/fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf-8");
}

const CANARY_MARKER = "PROLIFERATE_WF_CREDENTIAL_CANARY_c0ffee9a1b2c3d4e";

describe("workflow contract fixtures", () => {
  it("round-trips the resolved plan and matches planHash", () => {
    const raw = fixture("resolved-plan-v2.json");
    const parsed = parseResolvedPlan(raw);
    expect(canonicalize(parsed)).toBe(canonicalize(raw));
    expect(hashExcluding(raw, "planHash")).toBe((raw as Record<string, unknown>).planHash);
  });

  it("rejects an unknown plan version and unknown step kind", () => {
    const raw = fixture<Record<string, unknown>>("resolved-plan-v2.json");
    expect(() => parseResolvedPlan({ ...raw, planVersion: 99 })).toThrow();
    const badStep = fixture<Record<string, unknown>>("resolved-plan-v2.json");
    (badStep.spine as { steps: { kind: string }[] }[])[0].steps[0].kind = "agent.telepathy";
    expect(() => parseResolvedPlan(badStep)).toThrow();
  });

  it("round-trips the checkpoint manifest, binding, and derived hashes", () => {
    const manifest = fixture("checkpoint-manifest-v1.json");
    parseCheckpointManifest(manifest);
    const ckptHash = contentHash(normalizeCheckpointManifest(manifest as Record<string, unknown>));

    const binding = fixture<Record<string, unknown>>("execution-binding-v1.json");
    parseExecutionBinding(binding);
    expect(binding.checkpointContentHash).toBe(ckptHash);
    expect(hashExcluding(binding, "bindingHash")).toBe(binding.bindingHash);
  });

  it("normalizes an unsorted checkpoint to the canonical manifest and hash", () => {
    const manifest = fixture("checkpoint-manifest-v1.json");
    const ckptHash = contentHash(normalizeCheckpointManifest(manifest as Record<string, unknown>));
    const restoration = fixture<Record<string, unknown>>("restoration/checkpoint-restoration-v1.json");
    const normalized = normalizeCheckpointManifest(restoration.unsortedManifest as Record<string, unknown>);
    expect(contentHash(normalized)).toBe(ckptHash);
    expect(restoration.expectedContentHash).toBe(ckptHash);
    expect(canonicalize(normalized)).toBe(canonicalize(manifest));
  });

  it("rejects every invalid checkpoint manifest that the strict parser owns", () => {
    const cases = fixture<{ cases: { name: string; document: unknown }[] }>(
      "invalid/checkpoint-manifest-invalid-cases.json",
    );
    for (const testCase of cases.cases) {
      expect(() => parseCheckpointManifest(testCase.document), testCase.name).toThrow();
    }
  });

  it("round-trips the offer, envelope, observed run, receipt, and command", () => {
    const plan = fixture<Record<string, unknown>>("resolved-plan-v2.json");
    const binding = fixture<Record<string, unknown>>("execution-binding-v1.json");

    const offer = fixture<Record<string, unknown>>("materialization-offer-v1.json");
    parseMaterializationOffer(offer);
    expect(offer.planHash).toBe(plan.planHash);

    const envelope = fixture<Record<string, unknown>>("execution-envelope-v1.json");
    parseExecutionEnvelope(envelope);
    expect(envelope.planHash).toBe(plan.planHash);
    expect(envelope.bindingHash).toBe(binding.bindingHash);

    const observed = fixture<Record<string, unknown>>("observed-run-v2.json");
    parseObservedRun(observed);
    expect(observed.planHash).toBe(plan.planHash);
    expect(observed.bindingHash).toBe(binding.bindingHash);

    const receipt = fixture<Record<string, unknown>>("gateway-call-receipt-v1.json");
    parseGatewayCallReceipt(receipt);
    expect(receipt.planHash).toBe(plan.planHash);

    const command = fixture<Record<string, unknown>>("workflow-control-command-v1.json");
    parseWorkflowControlCommand(command);
    expect(command.bindingHash).toBe(binding.bindingHash);
  });

  it("keeps sessions a slot map and redacts the public run view", () => {
    const plan = parseResolvedPlan(fixture("resolved-plan-v2.json"));
    const observed = fixture<ObservedRunWire>("observed-run-v2.json");
    const slotIds = new Set(plan.slots.map((s) => s.slotId));
    for (const slotId of Object.keys(observed.sessions)) {
      expect(slotIds.has(slotId)).toBe(true);
    }
    const view = toPublicRunView(plan, observed);
    expect(JSON.stringify(view)).not.toContain("DUMMY_FAKE");
  });

  it("validates the emit schema profile and rejects the invalid cases", () => {
    validateSchemaProfile(fixture("workflow-schema-profile-v1-valid.json"));
    const cases = fixture<{ cases: { name: string; reasonCode: string; document: unknown }[] }>(
      "invalid/schema-profile-invalid-cases.json",
    );
    for (const testCase of cases.cases) {
      let raised: unknown;
      try {
        validateSchemaProfile(testCase.document);
      } catch (error) {
        raised = error;
      }
      expect(raised, testCase.name).toBeInstanceOf(SchemaProfileError);
      expect((raised as SchemaProfileError).code, testCase.name).toBe(testCase.reasonCode);
    }
  });

  it("reproduces every deterministic legacy UUIDv5 identity", () => {
    const legacy = fixture<{
      newWorkflowVersionId: string;
      namespace: string;
      expectedIds: { kind: string; identity: string; name: string; uuid: string }[];
    }>("legacy-definition-upgrade-v1.json");
    expect(legacy.namespace).toBe("2b5e907a-2cd8-5b8f-b5ab-5c891bb93263");
    for (const row of legacy.expectedIds) {
      const derived = deriveLegacyId(
        legacy.newWorkflowVersionId,
        row.kind as LegacyIdentityKind,
        row.identity,
      );
      expect(derived, `${row.kind} ${row.identity}`).toBe(row.uuid);
    }
  });

  it("canonicalizes every RFC 8785 float vector to the exact shared byte string", () => {
    // WS1-follow-up float fix: cross-language shared vectors, also consumed by
    // the Python leg (`verify.py`'s `_check_canonical_number_vectors`). Any
    // drift between the TS and Python canonicalizers fails one side or the
    // other, which is what makes this a cross-language guard.
    const data = fixture<{ vectors: { value: number; canonical: string; note?: string }[] }>(
      "canonical-number-vectors-v1.json",
    );
    for (const vector of data.vectors) {
      expect(canonicalize(vector.value), vector.note ?? String(vector.value)).toBe(
        vector.canonical,
      );
    }
  });

  it("keeps the credential canary out of every non-envelope fixture", () => {
    const canary = fixture<{ marker: string; fixturesThatMustNotContainMarker: string[] }>(
      "credential-canary.json",
    );
    expect(canary.marker).toBe(CANARY_MARKER);
    for (const name of canary.fixturesThatMustNotContainMarker) {
      expect(fixtureText(name), name).not.toContain(CANARY_MARKER);
    }
  });
});
