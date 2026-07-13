import assert from "node:assert/strict";
import test from "node:test";

import { verifyProductionDeployments } from "./verify-production-deployments.mjs";
import { buildDeploymentPayload } from "./create-component-deployment.mjs";
import { loadLaneMatrix } from "./collect-lane-proof.mjs";

const MATRIX = loadLaneMatrix();
const HEAD = "e".repeat(40);
const RELEASE = "proliferate-server@0.3.26+eeeeeeeeeeee";
const PROOFS = [
  { lane: "hosted-server", references: ["proliferate-server@sha256:" + "1".repeat(64)] },
  { lane: "self-hosted-release", references: ["anyharness.tar.gz:" + "2".repeat(64)] },
];

function serverPayload(overrides = {}) {
  return {
    ...buildDeploymentPayload({
      component: "proliferate-server",
      releaseId: RELEASE,
      headSha: HEAD,
      proofs: PROOFS,
      matrix: MATRIX,
    }),
    ...overrides,
  };
}

function manifestFor(payload, componentOverrides = {}) {
  return {
    schemaVersion: 1,
    release: {
      components: [
        {
          component: "proliferate-server",
          releaseId: RELEASE,
          headSha: HEAD,
          deploymentId: 500,
          deployedAt: "2026-07-13T00:00:00Z",
          artifacts: payload.artifacts.map((a) => ({
            lane: a.lane,
            artifactSetDigest: a.artifactSetDigest,
          })),
          ...componentOverrides,
        },
      ],
    },
  };
}

function jsonResponse(body, { link = null } = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
    headers: { get: (name) => (name.toLowerCase() === "link" ? link : null) },
  };
}

// Fake reader with configurable page size so pagination is exercised.
function makeFetch({ deployments, statuses, pageSize = 100 }) {
  return async function fetchImpl(url) {
    const { pathname, searchParams } = new URL(url);
    const page = Number(searchParams.get("page") || "1");
    if (/\/deployments$/.test(pathname)) {
      const start = (page - 1) * pageSize;
      const slice = deployments.slice(start, start + pageSize);
      const hasNext = start + pageSize < deployments.length;
      return jsonResponse(slice, {
        link: hasNext ? '<https://api.github.com/next>; rel="next"' : null,
      });
    }
    const statusesMatch = pathname.match(/\/deployments\/(\d+)\/statuses$/);
    if (statusesMatch) {
      const id = Number(statusesMatch[1]);
      const start = (page - 1) * pageSize;
      const all = statuses[id] || [];
      const slice = all.slice(start, start + pageSize);
      const hasNext = start + pageSize < all.length;
      return jsonResponse(slice, {
        link: hasNext ? '<https://api.github.com/next>; rel="next"' : null,
      });
    }
    return jsonResponse([]);
  };
}

test("valid manifest with a matching successful deployment passes", async () => {
  const payload = serverPayload();
  const fetchImpl = makeFetch({
    deployments: [{ id: 500, payload }],
    statuses: { 500: [{ state: "success", created_at: "2026-07-13T00:00:00Z" }] },
  });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("missing deployment fails closed", async () => {
  const payload = serverPayload();
  const fetchImpl = makeFetch({ deployments: [], statuses: {} });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /no production Deployment found/);
});

test("a tampered manifest digest is rejected", async () => {
  const payload = serverPayload();
  const manifest = manifestFor(payload);
  manifest.release.components[0].artifacts[0].artifactSetDigest = "0".repeat(64);
  const fetchImpl = makeFetch({
    deployments: [{ id: 500, payload }],
    statuses: { 500: [{ state: "success", created_at: "2026-07-13T00:00:00Z" }] },
  });
  const result = await verifyProductionDeployments({
    manifest,
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /manifest digest .* != recomputed/);
});

test("a payload missing a required lane is rejected", async () => {
  const payload = serverPayload();
  payload.artifacts = payload.artifacts.filter((a) => a.lane !== "self-hosted-release");
  const fetchImpl = makeFetch({
    deployments: [{ id: 500, payload }],
    statuses: { 500: [{ state: "success", created_at: "2026-07-13T00:00:00Z" }] },
  });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing required lane proof self-hosted-release/);
});

test("a deployment with no success status is rejected", async () => {
  const payload = serverPayload();
  const fetchImpl = makeFetch({
    deployments: [{ id: 500, payload }],
    statuses: { 500: [{ state: "in_progress", created_at: "2026-07-13T00:00:00Z" }] },
  });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /no successful status/);
});

test("prior same-release deployment with different digests is rejected", async () => {
  const payload = serverPayload();
  const tampered = serverPayload();
  tampered.artifacts[0].artifactSetDigest = "7".repeat(64);
  const fetchImpl = makeFetch({
    deployments: [
      { id: 500, payload },
      { id: 501, payload: tampered },
    ],
    statuses: {
      500: [{ state: "success", created_at: "2026-07-13T00:00:00Z" }],
      501: [{ state: "success", created_at: "2026-07-13T01:00:00Z" }],
    },
  });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /different artifact digests/);
});

test("deployments spread across pages are found (pagination)", async () => {
  const payload = serverPayload();
  const filler = Array.from({ length: 3 }, (_, i) => ({
    id: 100 + i,
    payload: { schemaVersion: 1, component: "proliferate-server", releaseId: "other@0.0.0+abc", headSha: HEAD, artifacts: [] },
  }));
  const fetchImpl = makeFetch({
    deployments: [...filler, { id: 500, payload }],
    statuses: { 500: [{ state: "success", created_at: "2026-07-13T00:00:00Z" }] },
    pageSize: 2,
  });
  const result = await verifyProductionDeployments({
    manifest: manifestFor(payload),
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("first-success time mismatch against the manifest is rejected", async () => {
  const payload = serverPayload();
  const fetchImpl = makeFetch({
    deployments: [{ id: 500, payload }],
    statuses: {
      500: [
        { state: "success", created_at: "2026-07-13T05:00:00Z" },
        { state: "success", created_at: "2026-07-13T00:00:00Z" },
      ],
    },
  });
  const manifest = manifestFor(payload, { deployedAt: "2026-07-13T05:00:00Z" });
  const result = await verifyProductionDeployments({
    manifest,
    repository: "proliferate-ai/proliferate",
    fetchImpl,
    matrix: MATRIX,
  });
  assert.equal(result.ok, false);
  // The earliest success (00:00:00Z) is authoritative, not the later retry.
  assert.match(result.errors.join("\n"), /!= first-success 2026-07-13T00:00:00Z/);
});
