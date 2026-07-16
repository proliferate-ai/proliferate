import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CANDIDATE_SERVER_CONTAINER, createBoxExec } from "./box-exec.js";
import { REMOTE_WORKDIR, type SshExec } from "./ingress.js";

interface RecordedSsh {
  ssh: SshExec;
  runs: string[];
  copies: Array<{ localPath: string; remotePath: string }>;
  stdoutFor(matcher: (command: string) => boolean, stdout: string): void;
}

function recordingSsh(): RecordedSsh {
  const runs: string[] = [];
  const copies: Array<{ localPath: string; remotePath: string }> = [];
  const stubs: Array<{ match: (command: string) => boolean; stdout: string }> = [];
  const ssh: SshExec = {
    async run(_dest, _key, command) {
      runs.push(command);
      const stub = stubs.find((entry) => entry.match(command));
      return { stdout: stub?.stdout ?? "", stderr: "" };
    },
    async copyFile(_dest, _key, localPath, remotePath) {
      copies.push({ localPath, remotePath });
    },
  };
  return {
    ssh,
    runs,
    copies,
    stdoutFor(matcher, stdout) {
      stubs.push({ match: matcher, stdout });
    },
  };
}

async function makeBox() {
  const secretsDir = await mkdtemp(path.join(tmpdir(), "box-exec-"));
  const recorded = recordingSsh();
  const box = createBoxExec({
    ssh: recorded.ssh,
    destination: "ubuntu@203.0.113.10",
    keyPath: "/run/key.pem",
    secretsDir,
  });
  return { box, recorded, secretsDir };
}

test("putSecretFile stages a 0600 file under REMOTE_WORKDIR and scp's it (value never in an argv)", async () => {
  const { box, recorded } = await makeBox();
  const remotePath = await box.putSecretFile("auth.json", '{"token":"s3cret"}');
  assert.equal(remotePath, `${REMOTE_WORKDIR}/auth.json`);
  assert.equal(recorded.copies.length, 1);
  assert.equal(recorded.copies[0]!.remotePath, `${REMOTE_WORKDIR}/auth.json`);
  // The secret only ever transits as a copied file; no SSH command carries it.
  assert.ok(recorded.runs.every((command) => !command.includes("s3cret")));
});

test("serverPython runs python inside candidate-server against a staged script path, then shreds it", async () => {
  const { box, recorded } = await makeBox();
  recorded.stdoutFor((command) => command.includes("docker exec"), '{"ok": true}');
  const result = await box.serverPython("print('hi')", { env: { SEED_USER_ID: "abc" }, scriptName: "s.py" });
  assert.equal(result.stdout, '{"ok": true}');
  const execRun = recorded.runs.find((command) => command.includes("docker exec"));
  assert.ok(execRun, "expected a docker exec run");
  assert.ok(execRun!.includes(CANDIDATE_SERVER_CONTAINER));
  assert.ok(execRun!.includes(`${REMOTE_WORKDIR}/s.py`));
  assert.ok(execRun!.includes("SEED_USER_ID=abc"));
  // The script file is removed afterward.
  assert.ok(recorded.runs.some((command) => command.startsWith("rm -f") && command.includes("s.py")));
});

test("putSecretFile does not leave the staged local copy behind", async () => {
  const { box, secretsDir } = await makeBox();
  await box.putSecretFile("ephemeral.json", "data");
  await assert.rejects(readFile(path.join(secretsDir, "box-ephemeral.json")));
});

test("readRemoteFile returns the remote contents over the ssh channel", async () => {
  const { box, recorded } = await makeBox();
  recorded.stdoutFor((command) => command.startsWith("cat "), "rotated-token-value\n");
  const contents = await box.readRemoteFile(`${REMOTE_WORKDIR}/rotated.txt`);
  assert.equal(contents, "rotated-token-value\n");
});
