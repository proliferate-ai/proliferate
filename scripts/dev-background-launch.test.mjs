// Launcher-level proof for BG4-LOCAL-01.
//
// `make run PROFILE=<name> BACKGROUND=1` must start the Celery worker/Beat
// against the ACTUAL selected profile database (same host Postgres + same
// profile DB name the host-run API uses), on profile-scoped broker/store ports.
// A regression here is silent: the plane comes up but observes a DIFFERENT
// database than the API, or collides with another worktree on default ports.
//
// This test drives the real launcher allocation (scripts/dev.mjs) in an isolated
// HOME, applies the exact DATABASE_URL rewrite the Makefile uses (the shared
// backgroundDatabaseUrl helper), then renders `docker compose config` and
// asserts:
//   * the worker AND beat DATABASE_URL resolve to the profile DB name on
//     host.docker.internal (never a compose-internal `db`, never a bare
//     loopback host a container cannot reach); and
//   * rabbitmq/redis publish the profile-scoped host ports, not the defaults.
//
// `docker compose config` is pure parse/interpolate and needs no daemon, but the
// compose CLI itself may be absent; the test skips cleanly when it is.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { backgroundDatabaseUrl } from "./dev.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devScript = path.join(repoRoot, "scripts", "dev.mjs");
const composeFile = path.join(repoRoot, "server", "docker-compose.yml");
const makefile = path.join(repoRoot, "Makefile");

function composeAvailable() {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function parseEnvFile(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^export\s+([A-Za-z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

test("background plane reaches the selected profile DB on profile-scoped ports", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "bg-launch-"));
  try {
    const profile = "bglaunchproof";
    // Drive the real launcher: allocate + persist the profile env (ports, DB).
    execFileSync("node", [devScript, "ensure", "--profile", profile], {
      env: { ...process.env, HOME: home },
      stdio: "ignore",
    });
    const profileEnvPath = path.join(
      home,
      ".proliferate-local",
      "dev",
      "profiles",
      profile,
      "profile.env",
    );
    const profileEnv = parseEnvFile(readFileSync(profileEnvPath, "utf8"));

    const dbName = profileEnv.PROLIFERATE_DEV_DB_NAME;
    assert.equal(dbName, `proliferate_dev_${profile}`);
    for (const key of [
      "PROLIFERATE_RABBITMQ_HOST_PORT",
      "PROLIFERATE_RABBITMQ_MGMT_HOST_PORT",
      "PROLIFERATE_REDIS_HOST_PORT",
    ]) {
      assert.ok(profileEnv[key], `${key} must be allocated for the profile`);
    }

    // The host-run API's DATABASE_URL for this profile (macOS default host is
    // ::1, which the old sed rewrite silently failed to match — exercise it).
    const hostDbUrl = `postgresql+asyncpg://proliferate:localdev@[::1]:5455/${dbName}`;
    const backgroundDbUrl = backgroundDatabaseUrl(hostDbUrl);
    // The profile DB NAME must survive the rewrite; only the host changes.
    assert.ok(backgroundDbUrl.endsWith(`/${dbName}`));
    assert.ok(backgroundDbUrl.includes("@host.docker.internal:5455/"));

    if (!composeAvailable()) {
      // Parse-level assertions above already hold; the render assertions need the
      // compose CLI. Skip the render but keep the test meaningful.
      return;
    }

    const rendered = execFileSync(
      "docker",
      ["compose", "-f", composeFile, "--profile", "background", "config", "--format", "json"],
      {
        env: {
          ...process.env,
          BACKGROUND_DATABASE_URL: backgroundDbUrl,
          PROLIFERATE_RABBITMQ_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_HOST_PORT,
          PROLIFERATE_RABBITMQ_MGMT_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_MGMT_HOST_PORT,
          PROLIFERATE_REDIS_HOST_PORT: profileEnv.PROLIFERATE_REDIS_HOST_PORT,
        },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const config = JSON.parse(rendered);
    const services = config.services;

    // Worker AND Beat must observe the profile DB on host.docker.internal.
    for (const name of ["worker", "beat"]) {
      const url = services[name].environment.DATABASE_URL;
      assert.equal(
        url,
        backgroundDbUrl,
        `${name} DATABASE_URL must be the rewritten profile DB URL`,
      );
      assert.ok(url.endsWith(`/${dbName}`), `${name} must target the profile DB name`);
      assert.ok(
        url.includes("@host.docker.internal:"),
        `${name} must reach the host Postgres, not a compose-internal db`,
      );
      assert.ok(
        !/@db:5432\//.test(url),
        `${name} must not point at the throwaway compose db`,
      );
    }

    // Broker/store host ports must be profile-scoped, not the shared defaults.
    const publishedHostPorts = (service) =>
      (services[service].ports || []).map((p) => String(p.published));
    assert.ok(
      publishedHostPorts("rabbitmq").includes(profileEnv.PROLIFERATE_RABBITMQ_HOST_PORT),
      "rabbitmq must publish the profile-scoped host port",
    );
    assert.ok(
      publishedHostPorts("redis").includes(profileEnv.PROLIFERATE_REDIS_HOST_PORT),
      "redis must publish the profile-scoped host port",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// BG4-LOCAL-02: the JS-level proof above does not touch the REAL `make run
// BACKGROUND=1` decision seam in the Makefile. That seam (a) refuses to start the
// background plane unless the profile DB is in use, and (b) rewrites the host-run
// DATABASE_URL to reach the same host Postgres/profile DB from a container. It
// previously had its OWN inline `sed` rewrite, diverging from the JS helper. The
// tests below assert the Makefile now routes through the shared `dev.mjs
// background-db-url` seam (one source of truth) and that the two decisions hold
// when the actual Makefile recipe lines run — without requiring Docker.

// Extract the body of the `run:` recipe from the Makefile as executable shell.
// Recipe lines are TAB-indented and use `\`-continuations; strip the leading tab
// and the recipe-echo `@` so the block can run under bash directly.
function extractRunRecipe() {
  const text = readFileSync(makefile, "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^run:/.test(l));
  assert.ok(start >= 0, "run: target must exist in the Makefile");
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "" || /^[^\t]/.test(line)) break; // next target / blank ends recipe
    body.push(line.replace(/^\t/, ""));
  }
  return body.join("\n");
}

test("Makefile BACKGROUND seam routes through the shared dev.mjs rewrite (no inline sed)", () => {
  const recipe = extractRunRecipe();
  // The background branch must derive the container DB URL via the shared
  // subcommand, not a private sed copy that can drift from the JS helper.
  assert.ok(
    recipe.includes("node scripts/dev.mjs background-db-url"),
    "run recipe must call `dev.mjs background-db-url` for the container DB rewrite",
  );
  assert.ok(
    !recipe.includes("host.docker.internal:\\1/"),
    "run recipe must not keep the private inline sed rewrite",
  );
});

// Slice the contiguous `background_mode=...if...fi` block out of the run recipe
// and render it as a runnable, Docker-free shell fragment: make variables become
// concrete test values, the `docker compose up` line is neutralized to an echo so
// no daemon is touched, and `$$` becomes a literal `$`. Everything else — the
// profile-DB abort, the three port `:?` guards, the shared `dev.mjs` rewrite call,
// and the loopback fail-closed check — runs verbatim.
function backgroundSeamScript(profile) {
  const recipe = extractRunRecipe();
  const lines = recipe.split("\n");
  const start = lines.findIndex((l) => l.includes('background_mode="$(BACKGROUND)"'));
  assert.ok(start >= 0, "run recipe must contain the BACKGROUND branch");
  // Find the `fi;` that closes the `if [ "$$background_mode" ... ]` block. After
  // extractRunRecipe strips one leading tab, the OUTER block sits at zero indent
  // while nested `if/fi` keep leading whitespace, so anchor on a zero-indent
  // `fi;` (ignoring the trailing line-continuation) to skip the inner closer.
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^fi;\s*\\?$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  assert.ok(end > start, "BACKGROUND branch must be closed by fi;");
  const block = lines
    .slice(start, end + 1)
    .map((l) => l.replace(/\s*\\$/, "")) // drop trailing line-continuations
    .join("\n")
    // Neutralize the only Docker call: keep the surrounding branch, run no daemon.
    .replace(/docker compose .*$/m, 'echo "COMPOSE_WOULD_RUN"')
    // Render the make variables the branch references to concrete test values.
    .replaceAll("$(BACKGROUND)", "1")
    .replaceAll("$(PROFILE)", profile)
    .replaceAll("$(LOCAL_PGPORT)", "5432")
    // `$$` in a Makefile recipe is a literal `$` at shell runtime.
    .replaceAll("$$", "$");
  return block;
}

test("Makefile BACKGROUND seam decisions hold when the real recipe lines run", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "bg-make-"));
  try {
    const profile = "bgmakeproof";
    execFileSync("node", [devScript, "ensure", "--profile", profile], {
      env: { ...process.env, HOME: home },
      stdio: "ignore",
    });
    const profileEnv = parseEnvFile(
      readFileSync(
        path.join(home, ".proliferate-local", "dev", "profiles", profile, "profile.env"),
        "utf8",
      ),
    );
    const dbName = profileEnv.PROLIFERATE_DEV_DB_NAME;

    const branch = backgroundSeamScript(profile);
    // Sanity: the guards we exercise are really present in the sliced block.
    assert.ok(branch.includes('if [ "$use_profile_db" != "1" ]; then'));
    assert.ok(branch.includes("PROLIFERATE_RABBITMQ_HOST_PORT:?background port not allocated"));
    assert.ok(branch.includes("PROLIFERATE_REDIS_HOST_PORT:?background port not allocated"));
    assert.ok(branch.includes("node scripts/dev.mjs background-db-url"));

    const harness = path.join(home, "seam.sh");
    writeFileSync(
      harness,
      [
        "set -euo pipefail",
        "cd " + JSON.stringify(repoRoot),
        branch,
        'echo "SEAM_OK background_db_url=$background_db_url"',
      ].join("\n"),
    );

    // Positive: profile DB in use + ports allocated -> rewrite yields the profile
    // DB name on host.docker.internal.
    const ok = execFileSync("bash", [harness], {
      env: {
        ...process.env,
        use_profile_db: "1",
        PROLIFERATE_DEV_PROFILE: profile,
        DATABASE_URL: `postgresql+asyncpg://proliferate:localdev@[::1]:5455/${dbName}`,
        PROLIFERATE_RABBITMQ_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_HOST_PORT,
        PROLIFERATE_RABBITMQ_MGMT_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_MGMT_HOST_PORT,
        PROLIFERATE_REDIS_HOST_PORT: profileEnv.PROLIFERATE_REDIS_HOST_PORT,
      },
      encoding: "utf8",
    });
    assert.match(ok, /SEAM_OK background_db_url=/);
    assert.ok(
      ok.includes(`@host.docker.internal:5455/${dbName}`),
      "the real Makefile seam must rewrite to the profile DB on host.docker.internal",
    );

    // Negative: DATABASE_URL override (use_profile_db=0) must abort the plane.
    let aborted = false;
    try {
      execFileSync("bash", [harness], {
        env: {
          ...process.env,
          use_profile_db: "0",
          DATABASE_URL: `postgresql+asyncpg://proliferate:localdev@[::1]:5455/${dbName}`,
          PROLIFERATE_RABBITMQ_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_HOST_PORT,
          PROLIFERATE_RABBITMQ_MGMT_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_MGMT_HOST_PORT,
          PROLIFERATE_REDIS_HOST_PORT: profileEnv.PROLIFERATE_REDIS_HOST_PORT,
        },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      aborted = true;
      assert.match(String(error.stderr), /requires the profile database/);
    }
    assert.ok(aborted, "BACKGROUND=1 with a DATABASE_URL override must fail closed");

    // Negative: a missing profile-scoped broker port must abort (the `:?` guard).
    let portAborted = false;
    try {
      execFileSync("bash", [harness], {
        env: {
          ...process.env,
          use_profile_db: "1",
          PROLIFERATE_DEV_PROFILE: profile,
          DATABASE_URL: `postgresql+asyncpg://proliferate:localdev@[::1]:5455/${dbName}`,
          PROLIFERATE_RABBITMQ_MGMT_HOST_PORT: profileEnv.PROLIFERATE_RABBITMQ_MGMT_HOST_PORT,
          PROLIFERATE_REDIS_HOST_PORT: profileEnv.PROLIFERATE_REDIS_HOST_PORT,
          // PROLIFERATE_RABBITMQ_HOST_PORT deliberately unset.
        },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      portAborted = true;
      assert.match(String(error.stderr), /background port not allocated/);
    }
    assert.ok(portAborted, "an unallocated profile broker port must fail closed");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
