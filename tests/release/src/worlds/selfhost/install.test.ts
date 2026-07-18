import assert from "node:assert/strict";
import { test } from "node:test";

import type { MaterializedArtifact } from "../../artifacts/local-candidate-set.js";
import type { ReadinessFetch } from "../local-workspace/processes.js";
import type { Ec2Box } from "./ec2.js";
import type { SshTransport } from "./world.js";
import {
  assertRunningImageDigest,
  dockerLoadCandidateImage,
  readSetupTokenOverSsh,
  runShippedInstaller,
  waitForHealth,
  SELFHOST_REMOTE_BUNDLE,
  SELFHOST_REMOTE_IMAGE_ARCHIVE,
} from "./install.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const OTHER_IMAGE_ID = `sha256:${"b".repeat(64)}`;

function box(): Ec2Box {
  return {
    instanceId: "i-abc123",
    securityGroupId: "sg-abc",
    keyName: "selfhost-run-1",
    keyPath: "/tmp/selfhost-run-1.pem",
    publicIp: "203.0.113.10",
    sshUser: "ubuntu",
  };
}

function materialized(id: string, path: string): MaterializedArtifact {
  return { artifact_id: id, version: "0.3.28", sha256: "c".repeat(64), path };
}

interface FakeSsh extends SshTransport {
  runCalls: string[];
  scpCalls: Array<{ localPath: string; remotePath: string }>;
}

/** Fake SSH transport: records every scp/run and answers `run` from a handler. */
function fakeSsh(handler: (command: string) => string): FakeSsh {
  const runCalls: string[] = [];
  const scpCalls: Array<{ localPath: string; remotePath: string }> = [];
  return {
    runCalls,
    scpCalls,
    async scp(localPath, remotePath) {
      scpCalls.push({ localPath, remotePath });
    },
    async run(command) {
      runCalls.push(command);
      return handler(command);
    },
  };
}

/** A default handler for the full happy install path. */
function happyHandler(command: string): string {
  if (command.startsWith("sudo docker load -i")) {
    return "Loaded image: proliferate-server-qualification:0.3.28\n";
  }
  if (command.startsWith("sudo docker image inspect")) {
    return `${IMAGE_ID}|\n`;
  }
  if (command.startsWith("sudo docker ps -q --filter ancestor=")) {
    return "container-9\n";
  }
  if (command.startsWith("sudo docker inspect --format '{{.Image}}'")) {
    return `${IMAGE_ID}\n`;
  }
  // mkdir, tar-extract, install.sh invocation.
  return "";
}

function okFetch(bodyByPath: Record<string, unknown>): ReadinessFetch {
  return async (url: string) => {
    const path = new URL(url).pathname;
    return {
      ok: true,
      status: 200,
      json: async () => bodyByPath[path] ?? {},
    };
  };
}

test("runShippedInstaller transports bytes, runs the shipped installer pinned to the candidate image, and returns the digest receipt", async () => {
  const ssh = fakeSsh(happyHandler);
  const receipt = await runShippedInstaller({
    box: box(),
    ssh,
    serverImageArchive: materialized("server/linux/amd64", "/run/artifacts/server-image.tar"),
    bundle: materialized("selfhost-bundle/linux/amd64", "/run/artifacts/proliferate-deploy.tar.gz"),
    bundleSha256SumsPath: "/run/artifacts/self-hosted-assets.SHA256SUMS",
    tlsCertificatePath: "/run/secrets/qualification-cert.pem",
    tlsPrivateKeyPath: "/run/secrets/qualification-key.pem",
    siteAddress: "run-1.qualification.proliferate.com",
    candidateImageRepo: "proliferate-server-qualification",
    candidateImageTag: "0.3.28",
    fetchImpl: okFetch({ "/meta": { serverVersion: "0.3.28" } }),
  });

  assert.equal(receipt.runningImageDigest, IMAGE_ID);
  assert.equal(receipt.loadedImageId, IMAGE_ID);
  assert.equal(receipt.serverVersion, "0.3.28");
  assert.equal(receipt.bundleSha256, "c".repeat(64));
  assert.equal(receipt.apiOrigin, "https://run-1.qualification.proliferate.com");
  assert.equal(receipt.tlsVerified, true);

  // Candidate bytes and the reusable TLS pair were scp'd to their remote slots.
  assert.deepEqual(
    ssh.scpCalls.map((c) => c.remotePath).sort(),
    [
      "proliferate-candidate/proliferate-deploy.tar.gz",
      "proliferate-candidate/qualification-tls-certificate.pem",
      "proliferate-candidate/qualification-tls-private-key.pem",
      "proliferate-candidate/self-hosted-assets.SHA256SUMS",
      "proliferate-candidate/server-image.tar",
    ],
  );

  // The shipped install.sh was run with --bundle and pinned to the loaded
  // candidate image — never stable/latest.
  const installCmd = ssh.runCalls.find((c) => c.includes("install.sh --bundle"));
  assert.ok(installCmd, "install.sh --bundle invocation is present");
  assert.ok(installCmd!.includes(`--bundle ${SELFHOST_REMOTE_BUNDLE}`));
  assert.ok(installCmd!.includes("--image-repo proliferate-server-qualification"));
  assert.ok(installCmd!.includes("--version 0.3.28"));
  assert.ok(!/--version (stable|latest)/.test(installCmd!));
  assert.ok(!installCmd!.includes(":stable") && !installCmd!.includes(":latest"));
  assert.ok(
    installCmd!.includes(
      "PROLIFERATE_COMPOSE_OVERRIDE_FILE=/home/ubuntu/proliferate-candidate/qualification-tls.compose.yml",
    ),
  );

  const publicConfigs = ssh.runCalls
    .filter((command) => command.includes("| base64 -d >"))
    .map((command) => {
      const encoded = command.match(/printf '%s' '([^']+)'/)?.[1];
      assert.ok(encoded, "qualification config write contains base64 bytes");
      return Buffer.from(encoded, "base64").toString("utf8");
    });
  assert.ok(
    publicConfigs.some((config) =>
      config.includes("tls /qualification-tls/certificate.pem /qualification-tls/private-key.pem"),
    ),
    "qualification Caddyfile pins the reusable certificate and key",
  );
  assert.ok(
    publicConfigs.some(
      (config) =>
        config.includes("/qualification-tls/certificate.pem:ro") &&
        config.includes("/qualification-tls/private-key.pem:ro") &&
        config.includes("/etc/caddy/Caddyfile:ro"),
    ),
    "qualification compose override mounts the TLS pair and Caddyfile read-only",
  );
});

test("runShippedInstaller passes --cors-allow-origins when browser origins are supplied, and omits it otherwise", async () => {
  const withCors = fakeSsh(happyHandler);
  await runShippedInstaller({
    box: box(),
    ssh: withCors,
    serverImageArchive: materialized("server/linux/amd64", "/run/artifacts/server-image.tar"),
    bundle: materialized("selfhost-bundle/linux/amd64", "/run/artifacts/proliferate-deploy.tar.gz"),
    bundleSha256SumsPath: "/run/artifacts/self-hosted-assets.SHA256SUMS",
    tlsCertificatePath: "/run/secrets/qualification-cert.pem",
    tlsPrivateKeyPath: "/run/secrets/qualification-key.pem",
    siteAddress: "run-1.qualification.proliferate.com",
    candidateImageRepo: "proliferate-server-qualification",
    candidateImageTag: "0.3.28",
    corsAllowOrigins: "http://127.0.0.1:5173,http://localhost:5173,null",
    fetchImpl: okFetch({ "/meta": { serverVersion: "0.3.28" } }),
  });
  const corsCmd = withCors.runCalls.find((c) => c.includes("install.sh --bundle"));
  assert.ok(corsCmd!.includes("--cors-allow-origins http://127.0.0.1:5173,http://localhost:5173,null"));
  // The CSV is a single argv token (no spaces) and precedes --yes.
  assert.ok(/--cors-allow-origins \S+ --yes/.test(corsCmd!));

  const noCors = fakeSsh(happyHandler);
  await runShippedInstaller({
    box: box(),
    ssh: noCors,
    serverImageArchive: materialized("server/linux/amd64", "/run/artifacts/server-image.tar"),
    bundle: materialized("selfhost-bundle/linux/amd64", "/run/artifacts/proliferate-deploy.tar.gz"),
    bundleSha256SumsPath: "/run/artifacts/self-hosted-assets.SHA256SUMS",
    tlsCertificatePath: "/run/secrets/qualification-cert.pem",
    tlsPrivateKeyPath: "/run/secrets/qualification-key.pem",
    siteAddress: "run-1.qualification.proliferate.com",
    candidateImageRepo: "proliferate-server-qualification",
    candidateImageTag: "0.3.28",
    fetchImpl: okFetch({ "/meta": { serverVersion: "0.3.28" } }),
  });
  const plainCmd = noCors.runCalls.find((c) => c.includes("install.sh --bundle"));
  assert.ok(!plainCmd!.includes("--cors-allow-origins"));
});

test("runShippedInstaller refuses a rolling stable/latest candidate tag", async () => {
  const ssh = fakeSsh(happyHandler);
  await assert.rejects(
    () =>
      runShippedInstaller({
        box: box(),
        ssh,
        serverImageArchive: materialized("server/linux/amd64", "/a/server-image.tar"),
        bundle: materialized("selfhost-bundle/linux/amd64", "/a/proliferate-deploy.tar.gz"),
        bundleSha256SumsPath: "/a/self-hosted-assets.SHA256SUMS",
        tlsCertificatePath: "/a/qualification-cert.pem",
        tlsPrivateKeyPath: "/a/qualification-key.pem",
        siteAddress: "run-1.qualification.proliferate.com",
        candidateImageRepo: "proliferate-server-qualification",
        candidateImageTag: "latest",
        fetchImpl: okFetch({}),
      }),
    /rolling tag/,
  );
  // Fail-closed BEFORE any byte is transported.
  assert.equal(ssh.scpCalls.length, 0);
});

test("dockerLoadCandidateImage parses the loaded ref and returns the image id", async () => {
  const ssh = fakeSsh(happyHandler);
  const loaded = await dockerLoadCandidateImage(
    ssh,
    SELFHOST_REMOTE_IMAGE_ARCHIVE,
    "proliferate-server-qualification:0.3.28",
  );
  assert.equal(loaded.imageId, IMAGE_ID);
  assert.equal(loaded.repoDigest, null);
});

test("dockerLoadCandidateImage rejects an archive that restores a different image than the map pins", async () => {
  const ssh = fakeSsh((command) => {
    if (command.startsWith("sudo docker load -i")) {
      return "Loaded image: some-other-image:9.9.9\n";
    }
    return happyHandler(command);
  });
  await assert.rejects(
    () => dockerLoadCandidateImage(ssh, SELFHOST_REMOTE_IMAGE_ARCHIVE, "proliferate-server-qualification:0.3.28"),
    /refusing to install a mismatched image/,
  );
});

test("assertRunningImageDigest hard-fails on a digest mismatch", async () => {
  const ssh = fakeSsh((command) => {
    if (command.startsWith("sudo docker inspect --format '{{.Image}}'")) {
      return `${OTHER_IMAGE_ID}\n`;
    }
    return happyHandler(command);
  });
  await assert.rejects(
    () => assertRunningImageDigest(ssh, { loadedImageId: IMAGE_ID, loadedRepoDigest: null }),
    /running image digest mismatch/,
  );
});

test("assertRunningImageDigest hard-fails when no container descends from the candidate image", async () => {
  const ssh = fakeSsh((command) => {
    if (command.startsWith("sudo docker ps -q --filter ancestor=")) {
      return "\n";
    }
    return happyHandler(command);
  });
  await assert.rejects(
    () => assertRunningImageDigest(ssh, { loadedImageId: IMAGE_ID, loadedRepoDigest: null }),
    /no running container descends from the candidate image/,
  );
});

test("readSetupTokenOverSsh returns the trimmed token and never leaks it on the empty path", async () => {
  const okSsh = fakeSsh((command) => {
    if (command.includes("exec -T api cat")) {
      return "  setup-tok-XYZ \n";
    }
    return "";
  });
  assert.equal(await readSetupTokenOverSsh(okSsh), "setup-tok-XYZ");

  const emptySsh = fakeSsh(() => "\n");
  await assert.rejects(
    () => readSetupTokenOverSsh(emptySsh),
    (error: unknown) => error instanceof Error && !/setup-tok/.test(error.message),
  );
});

test("waitForHealth resolves on a 2xx and times out on persistent failure", async () => {
  await waitForHealth("https://run-1.qualification.proliferate.com", {
    timeoutMs: 1_000,
    fetchImpl: okFetch({}),
  });

  const failing: ReadinessFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(
    () =>
      waitForHealth("https://run-1.qualification.proliferate.com", {
        timeoutMs: 50,
        fetchImpl: failing,
      }),
    /did not become healthy/,
  );
});
