import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  computeArtifactSetDigest,
  type RetainedReleaseReceiptV1,
} from "./retained-release-set.js";
import {
  downloadableRetainedArtifacts,
  materializeRetainedRelease,
} from "./materialize-retained-release.js";

const SHA = "e61afc274593085e51870b24269f718a543b88b4";
const BYTES: Record<string, string> = {
  "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz": "pkg-aarch64",
  "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz.sig": "sig-aarch64",
  "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz": "pkg-x64",
  "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz.sig": "sig-x64",
  "https://github.example.com/releases/download/server-v0.3.35/proliferate-deploy.tar.gz": "bundle",
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function receipt(): RetainedReleaseReceiptV1 {
  const body: Omit<RetainedReleaseReceiptV1, "artifact_set_digest"> = {
    schema_version: 1,
    kind: "proliferate.retained-release",
    release: {
      release_id: "v0.3.38",
      release_tag: "proliferate-v0.3.38",
      source_sha: SHA,
      published_at: "2026-07-17T01:07:21.493Z",
      qualification_state: "bootstrap_unqualified",
      qualification_evidence: null,
    },
    desktop: {
      version: "0.3.38",
      packages: [
        {
          platform: "darwin-aarch64",
          immutable_locator:
            "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz",
          sha256: sha("pkg-aarch64"),
          signature_locator:
            "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz.sig",
          sha256_signature: sha("sig-aarch64"),
        },
        {
          platform: "darwin-x86_64",
          immutable_locator: "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz",
          sha256: sha("pkg-x64"),
          signature_locator:
            "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_x64.app.tar.gz.sig",
          sha256_signature: sha("sig-x64"),
        },
      ],
      updater_pubkey: "dW50cnVzdGVk",
      embedded_anyharness_version: "0.3.38",
    },
    managed_runtime: {
      template_family: "pablo-5391/proliferate-runtime-cloud",
      immutable_template_id: "y7dakz4fs16tbz8vb9zo",
      template_build_id: "661a9621-78db-4c55-84d1-281c21fb72dc",
      source_tag: "sha-e61afc274593",
      input_hash: null,
      anyharness_version: "0.3.38",
      worker_version: "0.3.38",
      supervisor_version: "0.3.38",
      harness_catalog_digest: sha("catalog"),
      harness_registry_digest: sha("registry"),
    },
    self_host: {
      version: "0.3.35",
      release_tag: "server-v0.3.35",
      deploy_bundle_locator:
        "https://github.example.com/releases/download/server-v0.3.35/proliferate-deploy.tar.gz",
      deploy_bundle_sha256: sha("bundle"),
      server_image_digest: `ghcr.io/proliferate-ai/proliferate-server@sha256:${sha("image")}`,
    },
  };
  return { ...body, artifact_set_digest: computeArtifactSetDigest(body) };
}

function fakeFetch(overrides: Record<string, string> = {}, log?: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    log?.push(url);
    const bytes = overrides[url] ?? BYTES[url];
    if (bytes === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(new TextEncoder().encode(bytes));
  }) as typeof fetch;
}

test("downloadable set covers desktop packages+signatures and the self-host bundle; runtime is provider-side", () => {
  const all = downloadableRetainedArtifacts(receipt(), ["desktop", "managed-runtime", "self-host"]);
  assert.deepEqual(
    all.map((entry) => entry.artifact).sort(),
    [
      "desktop/darwin-aarch64/package",
      "desktop/darwin-aarch64/signature",
      "desktop/darwin-x86_64/package",
      "desktop/darwin-x86_64/signature",
      "self-host/deploy-bundle",
    ],
  );
  assert.equal(downloadableRetainedArtifacts(receipt(), ["managed-runtime"]).length, 0);
});

test("materializes, verifies, and caches artifact bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retained-mat-"));
  try {
    const log: string[] = [];
    const first = await materializeRetainedRelease(receipt(), {
      targets: ["desktop", "self-host"],
      cacheDirectory: dir,
      fetchImpl: fakeFetch({}, log),
    });
    assert.equal(first.length, 5);
    assert.equal(log.length, 5);
    for (const artifact of first) {
      assert.equal(sha(await readFile(artifact.path, "utf8")), artifact.sha256);
    }
    // Cache hit: no network, but bytes are STILL hash-verified per use.
    const secondLog: string[] = [];
    const second = await materializeRetainedRelease(receipt(), {
      targets: ["desktop", "self-host"],
      cacheDirectory: dir,
      fetchImpl: fakeFetch({}, secondLog),
    });
    assert.equal(secondLog.length, 0);
    assert.deepEqual(
      second.map((entry) => entry.sha256).sort(),
      first.map((entry) => entry.sha256).sort(),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("package hash drift fails closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retained-drift-"));
  try {
    await assert.rejects(
      materializeRetainedRelease(receipt(), {
        targets: ["desktop"],
        cacheDirectory: dir,
        fetchImpl: fakeFetch({
          "https://cdn.example.com/desktop/stable/Proliferate_0.3.38_aarch64.app.tar.gz":
            "tampered-bytes",
        }),
      }),
      /do not match the receipt SHA-256/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing artifact (HTTP error) fails closed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retained-missing-"));
  try {
    const notFoundFetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await assert.rejects(
      materializeRetainedRelease(receipt(), {
        targets: ["self-host"],
        cacheDirectory: dir,
        fetchImpl: notFoundFetch,
      }),
      /HTTP 404/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cache corruption is detected and repaired by a fresh verified download", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retained-corrupt-"));
  try {
    await materializeRetainedRelease(receipt(), {
      targets: ["self-host"],
      cacheDirectory: dir,
      fetchImpl: fakeFetch(),
    });
    const [cacheFile] = await readdir(dir);
    await writeFile(path.join(dir, cacheFile), "corrupted-on-disk");
    const log: string[] = [];
    const repaired = await materializeRetainedRelease(receipt(), {
      targets: ["self-host"],
      cacheDirectory: dir,
      fetchImpl: fakeFetch({}, log),
    });
    assert.equal(log.length, 1, "corrupt cache must trigger a re-download, not a trusted read");
    assert.equal(repaired[0].sha256, sha("bundle"));
    assert.equal(sha(await readFile(repaired[0].path, "utf8")), sha("bundle"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupt cache with an unreachable source fails closed rather than using stale bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retained-corrupt-offline-"));
  try {
    await materializeRetainedRelease(receipt(), {
      targets: ["self-host"],
      cacheDirectory: dir,
      fetchImpl: fakeFetch(),
    });
    const [cacheFile] = await readdir(dir);
    await writeFile(path.join(dir, cacheFile), "corrupted-on-disk");
    await assert.rejects(
      materializeRetainedRelease(receipt(), {
        targets: ["self-host"],
        cacheDirectory: dir,
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      }),
      /could not be downloaded/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
