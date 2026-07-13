import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeploymentPayload,
  createOrReuseComponentDeployment,
} from "./create-component-deployment.mjs";
import { loadLaneMatrix } from "./collect-lane-proof.mjs";

const MATRIX = loadLaneMatrix();
const HEAD = "d".repeat(40);
const RELEASE = "proliferate-server@0.3.26+dddddddddddd";
const SERVER_PROOFS = [
  { lane: "hosted-server", references: ["proliferate-server@sha256:" + "1".repeat(64)] },
  { lane: "self-hosted-release", references: ["anyharness.tar.gz:" + "2".repeat(64)] },
];

function jsonResponse(body, { status = 200, link = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
    headers: { get: (name) => (name.toLowerCase() === "link" ? link : null) },
  };
}

// Minimal in-memory GitHub Deployments API. Supports paginated GET of
// deployments and statuses (one full page + an empty second page) plus POST.
class FakeGithub {
  constructor({ deployments = [] } = {}) {
    this.deployments = deployments; // [{id, payload, statuses:[]}]
    this.nextId = deployments.reduce((max, d) => Math.max(max, d.id), 100) + 1;
    this.calls = [];
    this.fetch = this.fetch.bind(this);
  }

  async fetch(url, options = {}) {
    const method = options.method || "GET";
    const { pathname, searchParams } = new URL(url);
    const page = Number(searchParams.get("page") || "1");
    this.calls.push(`${method} ${pathname}?page=${page}`);

    const deploymentsMatch = pathname.match(/\/deployments$/);
    const statusesMatch = pathname.match(/\/deployments\/(\d+)\/statuses$/);

    if (method === "GET" && deploymentsMatch) {
      if (page > 1) return jsonResponse([]);
      const items = this.deployments.map((d) => ({ id: d.id, payload: d.payload, sha: d.payload.headSha }));
      return jsonResponse(items);
    }
    if (method === "POST" && deploymentsMatch) {
      const payload = JSON.parse(options.body).payload;
      const deployment = { id: this.nextId++, payload, statuses: [] };
      this.deployments.push(deployment);
      return jsonResponse({ id: deployment.id, payload });
    }
    if (method === "GET" && statusesMatch) {
      if (page > 1) return jsonResponse([]);
      const id = Number(statusesMatch[1]);
      const deployment = this.deployments.find((d) => d.id === id);
      return jsonResponse(deployment ? deployment.statuses : []);
    }
    if (method === "POST" && statusesMatch) {
      const id = Number(statusesMatch[1]);
      const deployment = this.deployments.find((d) => d.id === id);
      const created_at = `2026-07-13T0${deployment.statuses.length}:00:00Z`;
      const status = { state: JSON.parse(options.body).state, created_at };
      deployment.statuses.push(status);
      return jsonResponse(status);
    }
    return jsonResponse({ message: "not found" }, { status: 404 });
  }
}

test("buildDeploymentPayload requires exactly the matrix lanes", () => {
  assert.throws(
    () => buildDeploymentPayload({ component: "proliferate-server", releaseId: RELEASE, headSha: HEAD, proofs: [SERVER_PROOFS[0]], matrix: MATRIX }),
    /Missing required lane proof/,
  );
  assert.throws(
    () =>
      buildDeploymentPayload({
        component: "proliferate-server",
        releaseId: RELEASE,
        headSha: HEAD,
        proofs: [...SERVER_PROOFS, { lane: "hosted-web", references: ["dpl_x"] }],
        matrix: MATRIX,
      }),
    /not required for component/,
  );
  assert.throws(
    () =>
      buildDeploymentPayload({
        component: "proliferate-server",
        releaseId: RELEASE,
        headSha: HEAD,
        proofs: [SERVER_PROOFS[0], SERVER_PROOFS[0]],
        matrix: MATRIX,
      }),
    /Duplicate lane proof/,
  );
});

test("buildDeploymentPayload sorts lanes and rejects a bad headSha", () => {
  const payload = buildDeploymentPayload({
    component: "proliferate-server",
    releaseId: RELEASE,
    headSha: HEAD,
    proofs: [...SERVER_PROOFS].reverse(),
    matrix: MATRIX,
  });
  assert.deepEqual(payload.artifacts.map((a) => a.lane), ["hosted-server", "self-hosted-release"]);
  assert.equal(payload.schemaVersion, 1);
  assert.throws(
    () => buildDeploymentPayload({ component: "proliferate-server", releaseId: RELEASE, headSha: "short", proofs: SERVER_PROOFS, matrix: MATRIX }),
    /40-character git SHA/,
  );
});

test("creates a new deployment with one success status", async () => {
  const api = new FakeGithub();
  const result = await createOrReuseComponentDeployment({
    repository: "proliferate-ai/proliferate",
    component: "proliferate-server",
    releaseId: RELEASE,
    headSha: HEAD,
    proofs: SERVER_PROOFS,
    token: "t",
    fetchImpl: api.fetch,
    matrix: MATRIX,
  });
  assert.equal(result.reused, false);
  assert.equal(result.firstSuccessAt, "2026-07-13T00:00:00Z");
  assert.equal(api.deployments.length, 1);
  assert.equal(api.deployments[0].statuses.length, 1);
});

test("reuses the deployment and preserves the first-success timestamp on retry", async () => {
  const api = new FakeGithub();
  const first = await createOrReuseComponentDeployment({
    repository: "proliferate-ai/proliferate",
    component: "proliferate-server",
    releaseId: RELEASE,
    headSha: HEAD,
    proofs: SERVER_PROOFS,
    token: "t",
    fetchImpl: api.fetch,
    matrix: MATRIX,
  });
  const retry = await createOrReuseComponentDeployment({
    repository: "proliferate-ai/proliferate",
    component: "proliferate-server",
    releaseId: RELEASE,
    headSha: HEAD,
    proofs: [...SERVER_PROOFS].reverse(),
    token: "t",
    fetchImpl: api.fetch,
    matrix: MATRIX,
  });
  assert.equal(retry.reused, true);
  assert.equal(retry.deploymentId, first.deploymentId);
  // No second deployment, and the first-success time is unchanged.
  assert.equal(api.deployments.length, 1);
  assert.equal(retry.firstSuccessAt, first.firstSuccessAt);
  assert.equal(api.deployments[0].statuses.length, 1);
});

test("hard-fails a same-release deployment with different digests", async () => {
  const api = new FakeGithub();
  await createOrReuseComponentDeployment({
    repository: "proliferate-ai/proliferate",
    component: "proliferate-server",
    releaseId: RELEASE,
    headSha: HEAD,
    proofs: SERVER_PROOFS,
    token: "t",
    fetchImpl: api.fetch,
    matrix: MATRIX,
  });
  const tampered = [
    { lane: "hosted-server", references: ["proliferate-server@sha256:" + "9".repeat(64)] },
    { lane: "self-hosted-release", references: ["anyharness.tar.gz:" + "2".repeat(64)] },
  ];
  await assert.rejects(
    createOrReuseComponentDeployment({
      repository: "proliferate-ai/proliferate",
      component: "proliferate-server",
      releaseId: RELEASE,
      headSha: HEAD,
      proofs: tampered,
      token: "t",
      fetchImpl: api.fetch,
      matrix: MATRIX,
    }),
    /different artifact digests/,
  );
});
