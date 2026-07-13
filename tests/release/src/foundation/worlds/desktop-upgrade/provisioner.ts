/**
 * DesktopUpgradeWorldProvisioner — implements the frozen WorldProvisioner /
 * DesktopUpgradeWorldHandle contract (contracts/world.ts) for T4-DESKTOP-1.
 *
 * prepare():
 *   1. guard macOS host + PlistBuddy;
 *   2. resolve the retained N-1 identity from the passed RetainedProductionManifest
 *      (never inferred, never rebuilt) and its updater trust identity;
 *   3. create an isolated HOME / runtime home / install dir / feed dir and
 *      register it in the cleanup ledger IMMEDIATELY;
 *   4. resolve the retained N-1 `.app` bytes from a locally-cached retained copy
 *      (verified against the retained manifest digest when available) and install
 *      a disposable BYTE-IDENTICAL copy — the source bytes are never patched;
 *   5. stand up the isolated local updater feed, INITIALLY advertising nothing
 *      newer than N-1, register it in the ledger, and probe readiness;
 *   6. observe readiness (installed bundle version == N-1, feed 200, isolated
 *      home writable) and return the typed handle — or throw WorldReadinessError.
 *
 * It never returns a handle for an unhealthy / identity-mismatched world, and it
 * never moves, mirrors, or writes the public production stable feed.
 */

import { accessSync, constants as fsConstants } from "node:fs";

import type { WorldId } from "../../contracts/identity.js";
import type {
  DesktopUpgradeWorldHandle,
  ReadinessObservation,
  WorldContext,
  WorldProvisioner,
} from "../../contracts/world.js";
import { WorldReadinessError } from "../../contracts/world.js";
import type { RetainedProductionManifest } from "../../contracts/artifacts.js";

import { IsolatedUpdaterFeed } from "./feed.js";
import {
  appBundleContentDigest,
  bundleHasMainBinary,
  createIsolatedHome,
  installDisposableCopy,
  readBundleVersion,
  removeIsolatedHome,
  type IsolatedDesktopHome,
} from "./install.js";
import { verifyArtifactDigest } from "./retained-manifest.js";

/** Which trust chain the mechanism run uses. Only "production" can qualify. */
export type TrustChain = "production" | "throwaway";

export interface DesktopUpgradeProvisionerConfig {
  /**
   * Absolute path to a locally-cached retained N-1 production `.app` bundle.
   * On CI this is materialized from the retained manifest on a protected runner.
   * When absent, prepare() fails readiness with the exact gap enumerated rather
   * than fabricating an app.
   */
  readonly retainedAppPath?: string;
  /**
   * Trust chain of the candidate the run will drive. "production" is required
   * for qualification; "throwaway" produces updater-mechanism evidence only.
   */
  readonly trustChain: TrustChain;
}

/**
 * Live controls the scenario needs beyond the frozen handle: the running feed
 * and the isolated home layout. The provisioner both implements the contract
 * and exposes these controls.
 */
export interface DesktopUpgradeControls {
  readonly feed: IsolatedUpdaterFeed;
  readonly isolatedHome: IsolatedDesktopHome;
  readonly installedAppPath: string;
  readonly retained: RetainedProductionManifest;
  readonly trustChain: TrustChain;
}

export class DesktopUpgradeWorldProvisioner
  implements WorldProvisioner<DesktopUpgradeWorldHandle>, DesktopUpgradeControls
{
  readonly world: WorldId = "desktop-upgrade";
  private readonly config: DesktopUpgradeProvisionerConfig;

  // Populated by prepare(); read by the scenario and by cleanup.
  private _feed: IsolatedUpdaterFeed | null = null;
  private _iso: IsolatedDesktopHome | null = null;
  private _installedAppPath: string | null = null;
  private _retained: RetainedProductionManifest | null = null;

  constructor(config: DesktopUpgradeProvisionerConfig) {
    this.config = config;
  }

  get feed(): IsolatedUpdaterFeed {
    if (!this._feed) throw new Error("world not prepared: feed unavailable");
    return this._feed;
  }
  get isolatedHome(): IsolatedDesktopHome {
    if (!this._iso) throw new Error("world not prepared: isolated home unavailable");
    return this._iso;
  }
  get installedAppPath(): string {
    if (!this._installedAppPath) throw new Error("world not prepared: install path unavailable");
    return this._installedAppPath;
  }
  get retained(): RetainedProductionManifest {
    if (!this._retained) throw new Error("world not prepared: retained manifest unavailable");
    return this._retained;
  }
  get trustChain(): TrustChain {
    return this.config.trustChain;
  }

  async prepare(ctx: WorldContext): Promise<DesktopUpgradeWorldHandle> {
    const observations: ReadinessObservation[] = [];
    const fail = (message: string): never => {
      throw new WorldReadinessError("desktop-upgrade", message, observations);
    };

    // (1) Host guard — desktop Tier 4 runs on a macOS runner only.
    if (process.platform !== "darwin") {
      fail(`desktop-upgrade requires a macOS host; this host is ${process.platform}`);
    }

    // (2) Retained N-1 identity, from the passed receipt only.
    const retained = ctx.retained;
    if (!retained || retained.kind !== "retained-production") {
      fail("desktop-upgrade requires a RetainedProductionManifest in the world context");
    }
    this._retained = retained as RetainedProductionManifest;
    const n1Version = this._retained.productVersion;
    if (!this._retained.desktopUpdaterTrustIdentity.available) {
      fail("retained manifest is missing the Desktop updater trust identity");
    }
    observations.push(obs("retained-n1-identity", true, `N-1 = ${n1Version}, trust preserved`));

    // (3) Isolated home — register in the ledger immediately.
    const iso = createIsolatedHome(ctx.run.runId);
    this._iso = iso;
    await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "local-fs",
      resourceType: "isolated-desktop-home",
      resourceId: iso.base,
      owningWorld: "desktop-upgrade",
    });
    try {
      accessSync(iso.runtimeHome, fsConstants.W_OK);
      observations.push(obs("isolated-home-writable", true, `runtime home ${iso.runtimeHome}`));
    } catch {
      cleanupIso(iso);
      fail(`isolated runtime home not writable: ${iso.runtimeHome}`);
    }

    // (4) Resolve retained N-1 `.app` bytes and install a disposable copy.
    const retainedAppPath = this.config.retainedAppPath;
    if (!retainedAppPath) {
      cleanupIso(iso);
      // Direct throw (not fail()) so TS narrows retainedAppPath to string below.
      throw new WorldReadinessError(
        "desktop-upgrade",
        "no locally-cached retained N-1 .app supplied (config.retainedAppPath). The exact retained " +
          "production artifact must be materialized on the disposable macOS runner; the provisioner " +
          "will not fabricate an N-1 app. Provide the cached retained bundle or capture it via the " +
          "retained-manifest capture script's --download mode on a protected runner.",
        observations,
      );
    }
    let installedAppPath: string;
    try {
      installedAppPath = installDisposableCopy(retainedAppPath, iso);
    } catch (err) {
      cleanupIso(iso);
      fail(`failed to install disposable N-1 copy: ${(err as Error).message}`);
      return undefined as never;
    }
    this._installedAppPath = installedAppPath;
    await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "local-fs",
      resourceType: "disposable-n1-install",
      resourceId: installedAppPath,
      owningWorld: "desktop-upgrade",
    });

    // Verify the disposable copy against the retained manifest digest when the
    // receipt carries one; a mismatch is a hard readiness failure.
    if (this._retained.desktopApp.available) {
      const digest = appBundleContentDigest(installedAppPath);
      try {
        verifyArtifactDigest(this._retained.desktopApp.value.digest, digest);
        observations.push(obs("retained-app-digest", true, "disposable copy matches retained digest"));
      } catch (err) {
        cleanupIso(iso);
        fail(`retained N-1 digest verification failed: ${(err as Error).message}`);
      }
    } else {
      observations.push(
        obs(
          "retained-app-digest",
          true,
          "retained manifest has no byte digest slot (tarball not hashed); install verified structurally only",
        ),
      );
    }

    // Installed bundle version must equal N-1.
    let installedVersion: string;
    try {
      installedVersion = readBundleVersion(installedAppPath);
    } catch (err) {
      cleanupIso(iso);
      fail(`could not read installed bundle version: ${(err as Error).message}`);
      return undefined as never;
    }
    const versionOk = installedVersion === n1Version;
    observations.push(
      obs("installed-n1-version", versionOk, `installed bundle version ${installedVersion} (expected ${n1Version})`),
    );
    if (!versionOk) {
      cleanupIso(iso);
      fail(`installed disposable bundle reports ${installedVersion}, retained N-1 is ${n1Version}`);
    }
    observations.push(
      obs("installed-main-binary", bundleHasMainBinary(installedAppPath), "Mach-O main binary present"),
    );

    // (5) Isolated feed advertising nothing newer than N-1.
    const feed = new IsolatedUpdaterFeed(n1Version);
    this._feed = feed;
    let feedUrl: string;
    try {
      await feed.start();
      feedUrl = feed.feedUrl();
    } catch (err) {
      cleanupIso(iso);
      fail(`isolated feed failed to start: ${(err as Error).message}`);
      return undefined as never;
    }
    await ctx.ledger.register({
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      provider: "local-process",
      resourceType: "isolated-updater-feed",
      resourceId: feedUrl,
      owningWorld: "desktop-upgrade",
    });
    const feedProbe = await feed.probe();
    observations.push(feedProbe);
    if (!feedProbe.ok) {
      await feed.close();
      cleanupIso(iso);
      fail(`isolated feed not ready: ${feedProbe.detail}`);
    }

    // (6) Return the typed handle. Record observed artifacts for evidence.
    return {
      world: "desktop-upgrade",
      run: ctx.run,
      shard: ctx.shard,
      readiness: observations,
      installedAppPath,
      isolatedHome: iso.base,
      updaterFeedUrl: feedUrl,
      retained: this._retained,
    };
  }

  /** Close the feed and remove the isolated tree. Idempotent. */
  async teardown(): Promise<void> {
    if (this._feed) {
      await this._feed.close();
      this._feed = null;
    }
    if (this._iso) {
      removeIsolatedHome(this._iso);
      this._iso = null;
    }
  }
}

function obs(check: string, ok: boolean, detail: string): ReadinessObservation {
  return { check, ok, detail, observedAt: new Date().toISOString() };
}

function cleanupIso(iso: IsolatedDesktopHome): void {
  try {
    removeIsolatedHome(iso);
  } catch {
    /* best effort on the failure path */
  }
}
