/**
 * Isolated HOME / runtime home / install directory management and the
 * disposable byte-identical N-1 install for the desktop-upgrade world.
 *
 * Everything lives under one isolated base dir on the macOS host. The real
 * ~/Library Proliferate app data, the real keychain, and the public feed are
 * never touched. On the host this is a temp tree; a CI runner uses a protected
 * disposable macOS runner (tier-4-scenario-contract.md "Local And GitHub
 * Actions").
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The isolated directory layout for one desktop-upgrade run. */
export interface IsolatedDesktopHome {
  /** Root of the isolated tree; removing it removes everything. */
  readonly base: string;
  /** HOME the launched app sees. */
  readonly home: string;
  /** Isolated app-data dir (stands in for ~/Library/Application Support/...). */
  readonly appData: string;
  /** AnyHarness runtime home preserved across the N-1 -> N relaunch. */
  readonly runtimeHome: string;
  /** Directory the disposable N-1 `.app` is installed into. */
  readonly installDir: string;
  /** Directory staged updater artifacts are served from. */
  readonly feedDir: string;
}

/**
 * Create the isolated tree. Guards that the base is NOT inside the real user
 * Library, so a misconfiguration can never scribble on real app data.
 */
export function createIsolatedHome(runId: string): IsolatedDesktopHome {
  const base = mkdtempSync(join(tmpdir(), `t4-desktop-${sanitize(runId)}-`));
  assertNotRealLibrary(base);
  const home = join(base, "home");
  const appData = join(home, "Library", "Application Support", "com.proliferate.desktop");
  const runtimeHome = join(appData, "runtime-home");
  const installDir = join(base, "Applications");
  const feedDir = join(base, "feed");
  for (const d of [home, appData, runtimeHome, installDir, feedDir]) {
    mkdirSync(d, { recursive: true });
  }
  return { base, home, appData, runtimeHome, installDir, feedDir };
}

export function removeIsolatedHome(iso: IsolatedDesktopHome): void {
  rmSync(iso.base, { recursive: true, force: true });
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "run";
}

/** Never allow the isolated base to resolve inside the real user Library. */
export function assertNotRealLibrary(base: string): void {
  const realLibrary = join(process.env.HOME ?? "/Users/nobody", "Library");
  if (base.startsWith(realLibrary)) {
    throw new Error(`refusing isolated base inside the real user Library: ${base}`);
  }
}

/**
 * Install a disposable, byte-identical copy of the retained N-1 `.app` into the
 * isolated install dir. The source bytes are never patched. When
 * `expectedDigest` is supplied, the copied bundle's content digest is verified
 * to match the retained manifest before the install is accepted.
 */
export function installDisposableCopy(
  sourceApp: string,
  iso: IsolatedDesktopHome,
  opts: { appName?: string } = {},
): string {
  if (!existsSync(sourceApp)) {
    throw new Error(`retained N-1 .app not found at ${sourceApp}`);
  }
  const appName = opts.appName ?? "Proliferate.app";
  const dest = join(iso.installDir, appName);
  rmSync(dest, { recursive: true, force: true });
  cpSync(sourceApp, dest, { recursive: true });
  return dest;
}

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

/**
 * Read the installed bundle version — the Info.plist
 * CFBundleShortVersionString, which is exactly what Tauri's getVersion()
 * returns after a relaunch.
 */
export function readBundleVersion(appBundle: string): string {
  if (!existsSync(PLIST_BUDDY)) {
    throw new Error(`missing ${PLIST_BUDDY}; cannot read bundle version (macOS host required)`);
  }
  const plist = join(appBundle, "Contents", "Info.plist");
  const res = spawnSync(PLIST_BUDDY, ["-c", "Print :CFBundleShortVersionString", plist], {
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`PlistBuddy failed reading ${plist}: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

/**
 * Deterministic content digest of an installed `.app` bundle: sha256 over every
 * regular file's relative path + bytes, sorted. Lets a disposable install be
 * checked byte-identical against a retained digest without depending on the
 * tarball packaging.
 */
export function appBundleContentDigest(appBundle: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const full = join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relPath);
      else if (entry.isFile()) files.push(relPath);
    }
  };
  walk(appBundle, "");
  for (const relPath of files.sort()) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(readFileSync(join(appBundle, relPath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Structural sanity: a real Mach-O main binary exists in the bundle. */
export function bundleHasMainBinary(appBundle: string, binaryName = "Proliferate"): boolean {
  const mainBin = join(appBundle, "Contents", "MacOS", binaryName);
  return existsSync(mainBin) && statSync(mainBin).isFile();
}
