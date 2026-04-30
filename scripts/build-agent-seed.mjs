#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_INPUTS = join(REPO_ROOT, "desktop/src-tauri/agent-seed.inputs.json");
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, "desktop/src-tauri/agent-seeds");

const args = parseArgs(process.argv.slice(2));
const target = requireArg(args.target, "--target");
const outputDir = resolve(args.outputDir ?? DEFAULT_OUTPUT_DIR);
const inputsPath = resolve(args.inputs ?? DEFAULT_INPUTS);
const runtimeHome = resolve(args.runtimeHome ?? mkdtempSync(join(tmpdir(), `agent-seed-${target}-`)));
const anyharnessBin = resolve(args.anyharnessBin ?? join(REPO_ROOT, "target/release/anyharness"));
const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));
const desktopPackage = JSON.parse(readFileSync(join(REPO_ROOT, "desktop/package.json"), "utf8"));
const nodeTarget = inputs.node?.targets?.[target];

if (!nodeTarget) {
  throw new Error(`agent-seed.inputs.json has no Node entry for target ${target}`);
}

assertNativeTarget(target);
cleanOutputDir(outputDir);
mkdirSync(runtimeHome, { recursive: true });
installNode(runtimeHome, inputs.node, nodeTarget, target);
run(anyharnessBin, [
  "install-agents",
  "--runtime-home",
  runtimeHome,
  "--reinstall",
  "--agent",
  "claude",
  "--agent",
  "codex",
]);

const payloadDir = mkdtempSync(join(tmpdir(), `agent-seed-payload-${target}-`));
await copyPayload(runtimeHome, payloadDir, target);
const manifest = buildManifest(payloadDir, inputs, target);
writeFileSync(join(payloadDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const archivePath = join(outputDir, `agent-seed-${target}.tar.zst`);
createArchive(payloadDir, archivePath);
const archiveSha = sha256File(archivePath);
writeFileSync(join(outputDir, `agent-seed-${target}.sha256`), `${archiveSha}  ${basename(archivePath)}\n`);

console.log(`Wrote ${archivePath}`);
console.log(`SHA256 ${archiveSha}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function requireArg(value, flag) {
  if (!value) {
    throw new Error(`Missing required ${flag}`);
  }
  return value;
}

function hostTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  return `${process.arch}-${process.platform}`;
}

function assertNativeTarget(targetTriple) {
  const host = hostTarget();
  if (host !== targetTriple) {
    throw new Error(`Seed builds are native-only for v1: host=${host} target=${targetTriple}`);
  }
}

function cleanOutputDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    if (/^agent-seed-.*\.(tar\.zst|sha256)$/.test(entry)) {
      rmSync(join(dir, entry), { force: true });
    }
  }
}

function installNode(runtimeHome, nodeConfig, nodeTarget, targetTriple) {
  const archiveUrl = `${nodeConfig.baseUrl}/${nodeTarget.archive}`;
  const archivePath = join(tmpdir(), nodeTarget.archive);
  download(archiveUrl, archivePath);
  const actualSha = sha256File(archivePath);
  if (actualSha !== nodeTarget.sha256) {
    throw new Error(`Node archive checksum mismatch: expected ${nodeTarget.sha256}, got ${actualSha}`);
  }
  const extractDir = mkdtempSync(join(tmpdir(), `node-${targetTriple}-`));
  run("tar", ["-xzf", archivePath, "-C", extractDir]);
  const root = readdirSync(extractDir)
    .map((name) => join(extractDir, name))
    .find((path) => statSync(path).isDirectory());
  if (!root) {
    throw new Error(`Node archive ${archivePath} did not contain a root directory`);
  }
  const dest = join(runtimeHome, "node", targetTriple);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(root, dest, { recursive: true, dereference: false, preserveTimestamps: true });
  rewriteInternalSymlinks(dest, root, dest);
}

async function copyPayload(runtimeHome, payloadDir, targetTriple) {
  const copies = [
    ["agents/claude", "agents/claude"],
    ["agents/codex", "agents/codex"],
    [`node/${targetTriple}`, `node/${targetTriple}`],
  ];
  for (const [srcRel, destRel] of copies) {
    const src = join(runtimeHome, srcRel);
    if (!existsSync(src)) {
      throw new Error(`Expected seed source path missing: ${src}`);
    }
    await cp(src, join(payloadDir, destRel), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  }
  rewriteInternalSymlinks(payloadDir, runtimeHome, payloadDir);

  for (const launcher of [
    "agents/claude/agent_process/claude-launcher",
    "agents/codex/agent_process/codex-launcher",
  ]) {
    rmSync(join(payloadDir, launcher), { force: true });
  }
}

function buildManifest(payloadDir, inputs, targetTriple) {
  const artifacts = [];
  for (const relPath of walkFiles(payloadDir)) {
    if (relPath === "manifest.json" || relPath.endsWith(".install.lock")) {
      continue;
    }
    artifacts.push({
      path: relPath,
      kind: artifactKind(relPath),
      role: artifactRole(relPath),
      sha256: sha256File(join(payloadDir, relPath)),
      executable: isExecutable(join(payloadDir, relPath)),
    });
  }
  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schemaVersion: 1,
    seedVersion: seedVersion(inputs, targetTriple, artifacts),
    target: targetTriple,
    seededAgents: ["claude", "codex"],
    appVersion: desktopPackage.version,
    inputs,
    artifacts,
  };
}

function seedVersion(inputs, targetTriple, artifacts) {
  const raw = JSON.stringify({
    target: targetTriple,
    appVersion: desktopPackage.version,
    inputs,
    artifacts: artifacts.map(({ path, sha256 }) => ({ path, sha256 })),
  });
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${desktopPackage.version}-${digest}`;
}

function walkFiles(root, dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    const relPath = relative(root, fullPath).split(/[\\/]/).join("/");
    if (entry.isDirectory()) {
      out.push(...walkFiles(root, fullPath));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(relPath);
    }
  }
  return out;
}

function rewriteInternalSymlinks(root, sourceRoot, destRoot) {
  const realSourceRoot = realpathSync(sourceRoot);
  for (const relPath of walkFiles(root)) {
    const linkPath = join(root, relPath);
    if (!lstatSync(linkPath).isSymbolicLink()) {
      continue;
    }
    const target = readlinkSync(linkPath);
    if (!isAbsolute(target)) {
      continue;
    }
    let realTarget;
    try {
      realTarget = realpathSync(target);
    } catch (error) {
      throw new Error(`Cannot resolve symlink ${linkPath} -> ${target}: ${error.message}`);
    }
    const sourceRelativeTarget = relative(realSourceRoot, realTarget);
    if (sourceRelativeTarget.startsWith("..") || isAbsolute(sourceRelativeTarget)) {
      throw new Error(`Refusing to package absolute symlink outside payload: ${linkPath} -> ${target}`);
    }
    const mappedTarget = join(destRoot, sourceRelativeTarget);
    const relativeTarget = relative(dirname(linkPath), mappedTarget) || ".";
    rmSync(linkPath);
    symlinkSync(relativeTarget, linkPath);
  }
}

function artifactKind(path) {
  if (path.startsWith("agents/claude/")) return "claude";
  if (path.startsWith("agents/codex/")) return "codex";
  if (path.startsWith("node/")) return "node";
  return "unknown";
}

function artifactRole(path) {
  if (path.includes("/native/")) return "native";
  if (path.includes("/agent_process/")) return "agent_process";
  if (path.startsWith("node/")) return "node";
  return "unknown";
}

function isExecutable(path) {
  return (statSync(path).mode & 0o111) !== 0;
}

function createArchive(payloadDir, archivePath) {
  mkdirSync(dirname(archivePath), { recursive: true });
  const result = spawnSync("bash", ["-o", "pipefail", "-c", "tar -cf - . | zstd -q -19 -T0 -o \"$ARCHIVE_PATH\""], {
    cwd: payloadDir,
    env: { ...process.env, ARCHIVE_PATH: archivePath },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`tar/zstd archive creation failed with status ${result.status}`);
  }
}

function download(url, dest) {
  run("curl", ["-fsSL", url, "-o", dest]);
}

function sha256File(path) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    return createHash("sha256")
      .update("symlink:")
      .update(readlinkSync(path))
      .digest("hex");
  }
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function run(program, argv) {
  const result = spawnSync(program, argv, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${program} ${argv.join(" ")} failed with status ${result.status}`);
  }
}
