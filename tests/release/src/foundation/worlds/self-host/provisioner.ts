/**
 * SelfHostWorldProvisioner — implements the frozen `WorldProvisioner<SelfHostWorldHandle>`
 * contract (`../../contracts/world.ts`) for the self-host Tier 3 world
 * (specs/developing/testing/tier-3-scenario-contract.md "Self-Host World";
 * release-worlds-and-fixtures.md "Tier 3 Self-Host World").
 *
 * `prepare()` does exactly what the frozen contract says a self-host base
 * handle owns and nothing more:
 *   - reserves disposable EC2/network/DNS capacity (own instance, run-scoped,
 *     TTL-tagged, every resource ledgered before use — see `instance.ts`);
 *   - supplies the exact candidate self-host bundle/image handle (an
 *     immutable digest, never a rolling tag — see `dev-candidate-bundle.ts`);
 *   - provides a clean Desktop controller descriptor.
 * It does NOT install or claim the product — that is the composed journey's
 * job (`journey.ts`, `SH-INSTALL-CLAIM`).
 */

import { arch as hostArch } from "node:os";

import type { WorldContext, WorldProvisioner } from "../../contracts/world.js";
import type { SelfHostWorldHandle } from "../../contracts/world.js";
import type { WorldId } from "../../contracts/identity.js";

import { realExec, type ExecFn } from "./aws-cli.js";
import { reserveDisposableInstance, type DisposableInstance } from "./instance.js";
import { buildDevSelfHostBundle } from "./dev-candidate-bundle.js";
import { LocalFileLedger } from "./local-ledger.js";

export interface DesktopControllerDescriptor {
  /** "browser-web-port" (this slice) or "native-tauri" (required gap — see journey.ts). */
  readonly kind: "browser-web-port" | "native-tauri";
  readonly detail: string;
}

/** The concrete handle this provisioner returns, carrying fields the scenario needs beyond the frozen base shape. */
export interface PreparedSelfHostWorld {
  readonly handle: SelfHostWorldHandle;
  readonly instance: DisposableInstance;
  readonly desktopController: DesktopControllerDescriptor;
  readonly ledger: LocalFileLedger;
}

export interface SelfHostWorldProvisionerOptions {
  readonly exec?: ExecFn;
  readonly region?: string;
  readonly instanceType?: string;
  /** Repo root to build the dev self-host bundle from when the candidate manifest lacks the slot. */
  readonly repoRoot: string;
  /** Where this run's cleanup ledger persists (JSON file). */
  readonly ledgerPath: string;
  readonly log?: (line: string) => void;
  /** Test seam: skip the real SSH/docker readiness poll on the reserved instance. */
  readonly skipReadinessPoll?: boolean;
  /**
   * Test seam: overrides the local dev-bundle build (real `docker build` is
   * far too slow/expensive for a unit test). Only consulted when
   * `ctx.candidate.selfHostBundle` is unavailable.
   */
  readonly buildDevBundle?: typeof buildDevSelfHostBundle;
}

function detectArch(): "arm64" | "amd64" {
  return hostArch() === "arm64" ? "arm64" : "amd64";
}

export class SelfHostWorldProvisioner implements WorldProvisioner<SelfHostWorldHandle> {
  readonly world: WorldId = "self-host";
  private readonly options: SelfHostWorldProvisionerOptions;

  constructor(options: SelfHostWorldProvisionerOptions) {
    this.options = options;
  }

  /**
   * Full result including fields the frozen `SelfHostWorldHandle` does not
   * carry (the ledger and the extra instance/controller detail the journey
   * needs). Callers that only need the frozen shape can use `.handle`.
   */
  async prepareFull(ctx: WorldContext): Promise<PreparedSelfHostWorld> {
    const exec = this.options.exec ?? realExec;
    const log = this.options.log ?? (() => {});
    const ledger = new LocalFileLedger(this.options.ledgerPath);
    const arch = detectArch();

    // 1. Resolve the exact candidate self-host bundle. Prefer the shared
    //    candidate manifest's slot (future integration point, once the
    //    candidate-artifact pipeline populates it for this world); fall back
    //    to building it locally from the exact checked-out source tree so
    //    this world can be exercised end to end today. Either path yields an
    //    immutable digest — never "stable"/"latest".
    let bundleLocator: string;
    let bundleDigest: string;
    if (ctx.candidate.selfHostBundle.available) {
      bundleLocator = ctx.candidate.selfHostBundle.value.locator;
      bundleDigest = ctx.candidate.selfHostBundle.value.digest;
      log(`[self-host] using candidate-manifest selfHostBundle: ${bundleLocator} sha256:${bundleDigest.slice(0, 12)}…`);
    } else {
      log(
        `[self-host] candidate.selfHostBundle unavailable (${ctx.candidate.selfHostBundle.reason}); ` +
          "building a local dev bundle for this run instead",
      );
      const platform = arch === "arm64" ? ("linux/arm64" as const) : ("linux/amd64" as const);
      const build = this.options.buildDevBundle ?? buildDevSelfHostBundle;
      const bundle = await build({
        repoRoot: this.options.repoRoot,
        sourceSha: ctx.run.sourceSha,
        platform,
        log,
      });
      bundleLocator = bundle.locator.locator;
      bundleDigest = bundle.locator.digest;
    }

    const readiness = [
      {
        check: "selfhost-bundle-digest",
        ok: true,
        detail: `${bundleLocator} sha256:${bundleDigest.slice(0, 12)}…`,
        observedAt: new Date().toISOString(),
      },
    ];

    // 2. Reserve disposable EC2/network/DNS capacity. Every AWS resource is
    //    ledgered the instant it is created (instance.ts), before this
    //    function hands the box to anything else.
    const { instance, readiness: instanceReadiness } = await reserveDisposableInstance({
      exec,
      ledger,
      owningWorld: "self-host",
      runId: ctx.run.runId,
      shardId: ctx.shard.shardId,
      region: this.options.region,
      arch,
      instanceType: this.options.instanceType,
      skipReadinessPoll: this.options.skipReadinessPoll,
    });
    readiness.push(...instanceReadiness);

    // 3. A clean packaged-Desktop controller descriptor. Native Tauri
    //    automation is not built in this worktree (see journey.ts's
    //    documented gap); this slice's controller drives the same auth
    //    surface Desktop uses via the desktop-web browser port.
    const desktopController: DesktopControllerDescriptor = {
      kind: "browser-web-port",
      detail:
        "Desktop web-port browser session pointed at the disposable instance's public URL. Native Tauri " +
        "connect/relaunch/keychain automation is a required, recorded gap (see journey.ts header).",
    };

    const handle: SelfHostWorldHandle = {
      world: "self-host",
      run: ctx.run,
      shard: ctx.shard,
      readiness,
      instanceId: instance.instanceId,
      dnsName: instance.dnsName,
      bundleLocator,
      bundleDigest,
      control: `ssh:${instance.sshUser}@${instance.publicIp}`,
    };

    await ctx.evidence.append({
      event: "self-host-world-prepared",
      runId: ctx.run.runId,
      instanceId: instance.instanceId,
      dnsName: instance.dnsName,
      bundleDigest,
    });

    return { handle, instance, desktopController, ledger };
  }

  async prepare(ctx: WorldContext): Promise<SelfHostWorldHandle> {
    return (await this.prepareFull(ctx)).handle;
  }
}
