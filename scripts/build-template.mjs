#!/usr/bin/env node

import { Template, defaultBuildLogger, waitForTimeout } from "e2b";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.join(import.meta.dirname, "..");
const DEFAULT_BUILD_TARGET = "x86_64-unknown-linux-musl";
const DEV_TEMPLATE_CPU_COUNT = 4;
const DEV_TEMPLATE_MEMORY_MB = 8192;
const DEFAULT_BINARY_PATH = path.join(
  REPO_ROOT,
  "target",
  DEFAULT_BUILD_TARGET,
  "release",
  "anyharness"
);
// Keep this aligned with the cloud-supported agent set in server/proliferate/constants/cloud.py.
const TEMPLATE_AGENT_KINDS = ["claude", "codex"];

function printUsage() {
  console.log(`Build a runtime-ready E2B dev template for local Proliferate development.

Usage:
  node scripts/build-template.mjs [--alias <name>] [--name <template-family>] [--tag <tag>] [--publish] [--binary <path>] [--rebuild-runtime]

Options:
  --alias <name>         Override the local template alias.
  --name <family>        Override the template family name. Accepts bare names
                         like proliferate-runtime-cloud or public refs like
                         team-slug/proliferate-runtime-cloud.
  --tag <tag>            Assign a tag to the built template. Repeatable.
  --publish              Publish the template family after a successful build.
                         Requires E2B_TEAM_ID and the E2B CLI on PATH.
  --binary <path>        Use an existing Linux AnyHarness binary.
  --rebuild-runtime      Rebuild the Linux AnyHarness binary before template build.
  --help                 Show this help text.

Examples:
  node scripts/build-template.mjs
  node scripts/build-template.mjs --rebuild-runtime
  node scripts/build-template.mjs --alias proliferate-runtime-dev-pablo
  node scripts/build-template.mjs --name team-slug/proliferate-runtime-cloud --tag sha-1234567 --publish
  node scripts/build-template.mjs --binary target/x86_64-unknown-linux-musl/release/anyharness
`);
}

function parseArgs(argv) {
  let alias;
  let name;
  let binary;
  const tags = [];
  let publish = false;
  let rebuildRuntime = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--alias":
        alias = argv[i + 1];
        i += 1;
        break;
      case "--name":
        name = argv[i + 1];
        i += 1;
        break;
      case "--tag":
        tags.push(argv[i + 1]);
        i += 1;
        break;
      case "--publish":
        publish = true;
        break;
      case "--binary":
        binary = argv[i + 1];
        i += 1;
        break;
      case "--rebuild-runtime":
        rebuildRuntime = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (alias && name) {
    throw new Error("Use either --alias or --name, not both.");
  }
  if (rebuildRuntime && binary) {
    throw new Error("Use either --binary or --rebuild-runtime, not both.");
  }
  if (publish && !name) {
    throw new Error("--publish requires --name so the shared template family is explicit.");
  }

  return { alias, name, binary, tags, publish, rebuildRuntime, help };
}

function sanitizeUsername(value) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "user";
}

function defaultAlias() {
  const username = process.env.USER || os.userInfo().username || "user";
  return `proliferate-runtime-dev-${sanitizeUsername(username)}`;
}

function normalizeTemplateFamily(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Template name cannot be empty.");
  }

  const [familyPart, inlineTag] = trimmed.split(":");
  if (!familyPart) {
    throw new Error(`Invalid template name: ${input}`);
  }

  const segments = familyPart.split("/");
  const bareName = segments.at(-1);
  if (!bareName) {
    throw new Error(`Invalid template name: ${input}`);
  }
  if (!/^[a-z0-9_-]+$/.test(bareName)) {
    throw new Error(
      `Template family must contain only lowercase letters, numbers, dashes, or underscores: ${bareName}`
    );
  }

  const publicFamily = segments.length > 1 ? familyPart : null;
  return {
    bareName,
    inlineTag: inlineTag?.trim() || null,
    publicFamily,
  };
}

function candidateBinaryPaths() {
  const envOverride =
    process.env.CLOUD_RUNTIME_SOURCE_BINARY_PATH ||
    process.env.E2B_RUNTIME_SOURCE_BINARY_PATH;
  const candidates = [];
  if (envOverride) {
    candidates.push(path.resolve(envOverride));
  }
  candidates.push(
    DEFAULT_BINARY_PATH,
    path.join(REPO_ROOT, "target", "x86_64-unknown-linux-gnu", "release", "anyharness")
  );
  if (process.platform === "linux") {
    candidates.push(path.join(REPO_ROOT, "target", "release", "anyharness"));
  }
  return candidates;
}

function resolveBinaryPath(explicitBinaryPath) {
  if (explicitBinaryPath) {
    const resolved = path.resolve(explicitBinaryPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Binary not found at ${resolved}`);
    }
    return resolved;
  }

  for (const candidate of candidateBinaryPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "AnyHarness Linux runtime binary was not found.",
      `Expected one of: ${candidateBinaryPaths().join(", ")}`,
      "Build it first with `cargo zigbuild --release --target x86_64-unknown-linux-musl -p anyharness`",
      "or rerun this script with --rebuild-runtime.",
    ].join(" ")
  );
}

function rebuildRuntimeBinary() {
  console.log("Rebuilding AnyHarness Linux runtime artifact...");
  const result = spawnSync(
    "cargo",
    [
      "zigbuild",
      "--release",
      "--target",
      DEFAULT_BUILD_TARGET,
      "-p",
      "anyharness",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    throw new Error(`Failed to start cargo zigbuild: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`cargo zigbuild failed with exit code ${result.status}`);
  }
  if (!fs.existsSync(DEFAULT_BINARY_PATH)) {
    throw new Error(`Expected rebuilt binary at ${DEFAULT_BINARY_PATH}`);
  }
  return DEFAULT_BINARY_PATH;
}

function prepareTemplateContext(binaryPath) {
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), "proliferate-e2b-template-"));
  fs.copyFileSync(binaryPath, path.join(contextDir, "anyharness"));
  return contextDir;
}

function buildAgentInstallCommand(agentKinds) {
  const agentArgs = agentKinds.map((agentKind) => `--agent ${agentKind}`).join(" ");
  return [
    "set -eu",
    `echo "Preinstalling agents: ${agentKinds.join(", ")}"`,
    `/home/user/anyharness install-agents ${agentArgs}`,
  ].join(" && ");
}

function buildTemplateDefinition() {
  let template = Template({ fileContextPath: "." })
    .fromBaseImage()
    .setUser("root")
    .aptInstall(
      [
        "bash",
        "build-essential",
        "ca-certificates",
        "curl",
        "git",
        "libssl-dev",
        "pkg-config",
        "xz-utils",
      ],
      { noInstallRecommends: true }
    )
    .runCmd('bash -lc "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"')
    .aptInstall("nodejs", { noInstallRecommends: true })
    .runCmd(
      [
        "rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx",
        "ln -sf /usr/bin/node /usr/local/bin/node",
        "ln -sf /usr/bin/npm /usr/local/bin/npm",
        "ln -sf /usr/bin/npx /usr/local/bin/npx",
      ],
      { user: "root" }
    )
    .setUser("user")
    .runCmd(
      'bash -lc "curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal"'
    )
    .setUser("root")
    .runCmd(
      [
        "ln -sf /home/user/.cargo/bin/cargo /usr/local/bin/cargo",
        "ln -sf /home/user/.cargo/bin/rustc /usr/local/bin/rustc",
        "ln -sf /home/user/.cargo/bin/rustup /usr/local/bin/rustup",
      ],
      { user: "root" }
    )
    .copy("anyharness", "/home/user/anyharness", { mode: 0o755 })
    .makeDir("/home/user/workspace", { mode: 0o755, user: "user" })
    .setUser("user")
    .runCmd("node --version && npm --version && cargo --version && git --version");

  template = template.runCmd(buildAgentInstallCommand(TEMPLATE_AGENT_KINDS));

  return template
    .runCmd(
      [
        "rm -rf /home/user/.cargo/git /home/user/.cargo/registry /home/user/.npm/_cacache",
        "rm -rf /home/user/.proliferate/anyharness/agents/codex/agent_process/source-build-target",
      ].join(" && ")
    )
    .setWorkdir("/home/user/workspace")
    .setReadyCmd(waitForTimeout(0));
}

function runCommandOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    env: options.env || process.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `:\n${detail}` : ""}`
    );
  }
  return result.stdout ?? "";
}

function listTemplates({ apiKey, teamId }) {
  const args = ["template", "list", "--format", "json"];
  if (teamId) {
    args.push("--team", teamId);
  }
  const output = runCommandOrThrow("e2b", args, {
    env: { ...process.env, E2B_API_KEY: apiKey },
  });
  return JSON.parse(output);
}

function findTemplateRecord(records, bareName) {
  return records.find((record) => {
    const aliases = Array.isArray(record.aliases) ? record.aliases : [];
    const names = Array.isArray(record.names) ? record.names : [];
    return (
      aliases.includes(bareName) ||
      names.includes(bareName) ||
      names.some((name) => name.endsWith(`/${bareName}`))
    );
  });
}

function resolvePublicFamily(record, bareName, fallbackPublicFamily) {
  const names = Array.isArray(record?.names) ? record.names : [];
  return (
    names.find((name) => name.endsWith(`/${bareName}`)) ||
    fallbackPublicFamily ||
    bareName
  );
}

function ensureTemplatePublished({ bareName, publicFamily, apiKey, teamId }) {
  if (!teamId) {
    throw new Error("E2B_TEAM_ID is required when using --publish.");
  }

  const beforePublish = findTemplateRecord(listTemplates({ apiKey, teamId }), bareName);
  if (!beforePublish?.public) {
    const args = ["template", "publish", bareName, "--yes", "--team", teamId];
    runCommandOrThrow("e2b", args, {
      env: { ...process.env, E2B_API_KEY: apiKey },
      stdio: "inherit",
    });
  }

  const publishedRecord = findTemplateRecord(listTemplates({ apiKey, teamId }), bareName);
  if (!publishedRecord?.public) {
    throw new Error(`Template family ${bareName} did not become public after publish.`);
  }

  return resolvePublicFamily(publishedRecord, bareName, publicFamily);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error("");
    printUsage();
    process.exit(1);
  }

  if (parsed.help) {
    printUsage();
    return;
  }

  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.error("ERROR: E2B_API_KEY environment variable is required");
    process.exit(1);
  }

  const explicitName = parsed.name || parsed.alias;
  const normalizedName = explicitName ? normalizeTemplateFamily(explicitName) : null;
  const templateName = normalizedName?.bareName || defaultAlias();
  const buildTags = [...new Set([normalizedName?.inlineTag, ...parsed.tags].filter(Boolean))];
  const teamId = process.env.E2B_TEAM_ID || "";
  const binaryPath = parsed.rebuildRuntime
    ? rebuildRuntimeBinary()
    : resolveBinaryPath(parsed.binary);
  const binaryStats = fs.statSync(binaryPath);

  console.log("=== Proliferate E2B Dev Template Builder ===");
  console.log(`Template name: ${templateName}`);
  if (buildTags.length > 0) {
    console.log(`Tags: ${buildTags.join(", ")}`);
  }
  console.log(`Binary: ${binaryPath}`);
  console.log(`Binary size: ${(binaryStats.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(
    `Template resources: ${DEV_TEMPLATE_CPU_COUNT} CPU / ${DEV_TEMPLATE_MEMORY_MB} MB`
  );
  if (parsed.publish) {
    console.log(`Publish: yes (team ${teamId || "MISSING"})`);
  }
  console.log("");
  console.log("Building template...");

  const contextDir = prepareTemplateContext(binaryPath);
  try {
    const previousCwd = process.cwd();
    process.chdir(contextDir);
    try {
      const template = buildTemplateDefinition();
      const buildInfo = await Template.build(template, templateName, {
        apiKey,
        cpuCount: DEV_TEMPLATE_CPU_COUNT,
        memoryMB: DEV_TEMPLATE_MEMORY_MB,
        tags: buildTags,
        onBuildLogs: defaultBuildLogger(),
      });

      let publicFamily = null;
      if (parsed.publish) {
        publicFamily = ensureTemplatePublished({
          bareName: templateName,
          publicFamily: normalizedName?.publicFamily || null,
          apiKey,
          teamId,
        });
      }

      console.log("");
      console.log("Template build completed.");
      console.log(`Template: ${buildInfo.name}`);
      console.log(`Template ID: ${buildInfo.templateId}`);
      console.log(`Build ID: ${buildInfo.buildId}`);
      if (buildInfo.tags.length > 0) {
        console.log(`Built tags: ${buildInfo.tags.join(", ")}`);
      }
      console.log("");

      const privateRefs = buildInfo.tags.length > 0
        ? buildInfo.tags.map((tag) => `${templateName}:${tag}`)
        : [templateName];
      console.log("Built template refs:");
      for (const ref of privateRefs) {
        console.log(`- ${ref}`);
      }

      if (publicFamily) {
        console.log("");
        console.log("Published public template refs:");
        const publicRefs = buildInfo.tags.length > 0
          ? buildInfo.tags.map((tag) => `${publicFamily}:${tag}`)
          : [publicFamily];
        for (const ref of publicRefs) {
          console.log(`- ${ref}`);
        }
      }

      if (!parsed.name) {
        console.log("");
        console.log("Set this in your local server env before creating a cloud workspace:");
        console.log(`E2B_TEMPLATE_NAME=${privateRefs[0]}`);
      }
    } finally {
      process.chdir(previousCwd);
    }
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
