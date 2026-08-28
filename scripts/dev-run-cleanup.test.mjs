import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makefilePath = path.join(repoRoot, "Makefile");

function extractRunRecipe() {
  const lines = readFileSync(makefilePath, "utf8").split("\n");
  const start = lines.findIndex((line) => /^run:/.test(line));
  assert.ok(start >= 0, "run: target must exist in the Makefile");
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "" || /^[^\t]/.test(line)) {
      break;
    }
    body.push(line.replace(/^\t/, ""));
  }
  return body.join("\n");
}

function extractOwnedLifecycle() {
  const recipe = extractRunRecipe();
  const start = recipe.indexOf("process_identity()");
  const end = recipe.indexOf("$(SERVER_ENV_SOURCE)", start);
  assert.ok(start >= 0, "run recipe must initialize owned process tracking");
  assert.ok(end > start, "run recipe must place cleanup before environment startup");
  return recipe.slice(start, end).replaceAll("$$", "$");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

test("run cleanup owns process trees without owning the caller's process group", {
  skip: process.platform === "win32",
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "proliferate-run-cleanup-"));
  const ownedFixture = path.join(tempRoot, "owned-tree.sh");
  const harness = path.join(tempRoot, "harness.sh");
  const caller = path.join(tempRoot, "caller.sh");
  const resultFile = path.join(tempRoot, "result");
  const ownedGrandchildPid = path.join(tempRoot, "owned-grandchild.pid");
  const ownedRootPid = path.join(tempRoot, "owned-root.pid");
  const bystanderStart = path.join(tempRoot, "bystander-start");
  const bystanderTerm = path.join(tempRoot, "bystander-term");
  const bystanderChildTerm = path.join(tempRoot, "bystander-child-term");
  const bystanderPid = path.join(tempRoot, "bystander.pid");
  const bystanderChildPid = path.join(tempRoot, "bystander-child.pid");
  const callerPgid = path.join(tempRoot, "caller.pgid");
  const harnessPgid = path.join(tempRoot, "harness.pgid");
  const bystanderPgid = path.join(tempRoot, "bystander.pgid");
  const runLock = path.join(tempRoot, "profile", "run.lock");

  writeFileSync(
    ownedFixture,
    `#!/bin/sh
grandchild_pid_file="$1"
(
  sleep 60
) &
grandchild_pid=$!
printf '%s\\n' "$grandchild_pid" > "$grandchild_pid_file"
wait "$grandchild_pid"
`,
    { mode: 0o755 },
  );

  const lifecycle = extractOwnedLifecycle();
  assert.doesNotMatch(lifecycle, /kill 0/, "cleanup must not signal the shared process group");
  assert.match(lifecycle, /collect_owned_tree/, "cleanup must account for owned descendants");
  assert.match(lifecycle, /process_identity/, "cleanup must validate retained process identities");
  assert.match(lifecycle, /\/proc\/\$pid\/stat/, "Linux cleanup must use process start ticks");
  assert.match(lifecycle, /ps -o lstart=/, "POSIX cleanup must use a start-time token");
  assert.match(lifecycle, /retained_identity/, "cleanup must retain identities for rescanned PIDs");

  writeFileSync(
    harness,
    `#!/bin/sh
set -eu
printf '%s\\n' "$(ps -o pgid= -p "$$" | tr -d ' ')" > ${shellQuote(harnessPgid)}
launch_env=${shellQuote(path.join(tempRoot, "profile", "launch.env"))}
${lifecycle}
bystander_identity=$(process_identity "$bystander_pid")
owned_tree_records="$bystander_pid|stale-identity"
collect_owned_tree "$bystander_pid" "$bystander_identity"
signal_owned_processes TERM
owned_tree_records=""
mkdir -p ${shellQuote(path.dirname(runLock))}
touch ${shellQuote(runLock)}
start_owned_process sh ${shellQuote(ownedFixture)} \
  ${shellQuote(ownedGrandchildPid)}
printf '%s\\n' "$last_owned_pid" > ${shellQuote(ownedRootPid)}
while [ ! -f ${shellQuote(ownedGrandchildPid)} ]; do sleep 0.01; done
exit 37
`,
    { mode: 0o755 },
  );

  writeFileSync(
    caller,
    `#!/bin/sh
set +e
bystander_term=${shellQuote(bystanderTerm)}
bystander_child_term=${shellQuote(bystanderChildTerm)}
export bystander_term
export bystander_child_term
(
  trap 'printf TERM > "$bystander_term"; exit 143' TERM
  touch ${shellQuote(bystanderStart)}
  (
    trap 'printf TERM > "$bystander_child_term"; exit 143' TERM
    while :; do :; done
  ) &
  bystander_child_pid=$!
  printf '%s\\n' "$bystander_child_pid" > ${shellQuote(bystanderChildPid)}
  wait "$bystander_child_pid"
) &
bystander_pid=$!
printf '%s\\n' "$bystander_pid" > ${shellQuote(bystanderPid)}
export bystander_pid
printf '%s\\n' "$(ps -o pgid= -p "$$" | tr -d ' ')" > ${shellQuote(callerPgid)}
printf '%s\\n' "$(ps -o pgid= -p "$bystander_pid" | tr -d ' ')" > ${shellQuote(bystanderPgid)}
while [ ! -f ${shellQuote(bystanderStart)} ]; do sleep 0.01; done
while [ ! -f ${shellQuote(bystanderChildPid)} ]; do sleep 0.01; done
cleanup_bystander() {
  kill -TERM "$(cat ${shellQuote(bystanderChildPid)})" 2>/dev/null || true
  wait "$(cat ${shellQuote(bystanderChildPid)})" 2>/dev/null || true
  kill -TERM "$(cat ${shellQuote(bystanderPid)})" 2>/dev/null || true
  wait "$(cat ${shellQuote(bystanderPid)})" 2>/dev/null || true
}
trap cleanup_bystander EXIT
sh ${shellQuote(harness)}
status="$?"
printf 'STATUS=%s\\n' "$status" > ${shellQuote(resultFile)}
if [ "$status" -ne 37 ]; then
  exit 1
fi
if [ "$(cat ${shellQuote(callerPgid)})" != "$(cat ${shellQuote(harnessPgid)})" ] || \
   [ "$(cat ${shellQuote(callerPgid)})" != "$(cat ${shellQuote(bystanderPgid)})" ]; then
  printf 'SAME_PROCESS_GROUP=0\\n' >> ${shellQuote(resultFile)}
  exit 1
fi
printf 'SAME_PROCESS_GROUP=1\\n' >> ${shellQuote(resultFile)}
if [ -f ${shellQuote(bystanderChildTerm)} ] || ! kill -0 "$(cat ${shellQuote(bystanderChildPid)})" 2>/dev/null; then
  printf 'STALE_IDENTITY_SAFE=0\\n' >> ${shellQuote(resultFile)}
  exit 1
fi
printf 'STALE_IDENTITY_SAFE=1\\n' >> ${shellQuote(resultFile)}
if [ -f ${shellQuote(bystanderTerm)} ]; then
  printf 'BYSTANDER_TERM=1\\n' >> ${shellQuote(resultFile)}
else
  printf 'BYSTANDER_TERM=0\\n' >> ${shellQuote(resultFile)}
fi
if kill -0 "$(cat ${shellQuote(bystanderPid)})" 2>/dev/null; then
  printf 'BYSTANDER_ALIVE=1\\n' >> ${shellQuote(resultFile)}
else
  printf 'BYSTANDER_ALIVE=0\\n' >> ${shellQuote(resultFile)}
fi
printf 'CALLER_SURVIVED=1\\n' >> ${shellQuote(resultFile)}
if kill -0 "$(cat ${shellQuote(ownedRootPid)})" 2>/dev/null; then
  printf 'OWNED_ROOT_ALIVE=1\\n' >> ${shellQuote(resultFile)}
else
  printf 'OWNED_ROOT_ALIVE=0\\n' >> ${shellQuote(resultFile)}
fi
if kill -0 "$(cat ${shellQuote(ownedGrandchildPid)})" 2>/dev/null; then
  printf 'OWNED_GRANDCHILD_ALIVE=1\\n' >> ${shellQuote(resultFile)}
else
  printf 'OWNED_GRANDCHILD_ALIVE=0\\n' >> ${shellQuote(resultFile)}
fi
kill -TERM "$(cat ${shellQuote(bystanderPid)})" 2>/dev/null || true
exit 0
`,
    { mode: 0o755 },
  );

  try {
    const completed = spawnSync("sh", [caller], {
      cwd: repoRoot,
      detached: true,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(completed.error, undefined, completed.error?.message);
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    const result = readFileSync(resultFile, "utf8");
    assert.match(result, /SAME_PROCESS_GROUP=1/);
    assert.match(result, /BYSTANDER_TERM=0/);
    assert.match(result, /BYSTANDER_ALIVE=1/);
    assert.match(result, /CALLER_SURVIVED=1/);
    assert.match(result, /STATUS=37/);
    assert.match(result, /STALE_IDENTITY_SAFE=1/);
    assert.match(result, /OWNED_ROOT_ALIVE=0/);
    assert.match(result, /OWNED_GRANDCHILD_ALIVE=0/);
    assert.equal(existsSync(runLock), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("run tracks every long-running launcher and keeps Desktop blocking", () => {
  const recipe = extractRunRecipe();
  assert.doesNotMatch(recipe, /kill 0/);
  for (const command of [
    "start_owned_process env RUST_LOG=info",
    "start_owned_process sh -c 'cd server && exec .venv/bin/uvicorn",
    "start_owned_process env VITE_PROLIFERATE_API_BASE_URL",
    "start_owned_process stripe listen",
    "start_owned_process ngrok http",
    "start_owned_process sh -c 'cd apps/desktop && exec pnpm tauri dev",
  ]) {
    assert.match(recipe, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(recipe, /tauri_pid="\$\$last_owned_pid";/);
  assert.match(recipe, /wait "\$\$tauri_pid"/);
  assert.match(recipe, /trap 'exit 130' INT/);
  assert.match(recipe, /trap 'exit 143' TERM/);
});
