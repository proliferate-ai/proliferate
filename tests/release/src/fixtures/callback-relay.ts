import type { BoxExec } from "../worlds/managed-cloud/box-exec.js";
import {
  DEFAULT_RELAY_LISTEN_PORT,
  RELAY_DIRNAME,
  RELAY_MANIFEST_FILENAME,
  RELAY_SCRIPT_FILENAME,
  type RelayChannel,
} from "../worlds/managed-cloud/callback-relay-agent.js";
import type { ManagedCloudWorld } from "../worlds/managed-cloud/world.js";

/**
 * `callbackRelay` — the controller for the on-box signed-callback relay (spec
 * "signed qualification callback relay"; PR 6 fixture 2). The relay's DATA plane
 * (the single-file Python process + Caddy routes) is staged by
 * `ingress.ts`/`callback-relay-agent.ts` when the deploy's `callbackRelay`
 * option is present; this fixture is the CONTROL plane the reconciliation
 * journeys drive.
 *
 * It can only DELAY and REPLAY genuine provider deliveries — never synthesize
 * one. There is no `emit`/`synthesize` method here, and none in the data plane,
 * BY CONSTRUCTION: the relay forwards or spools the exact signed bytes+headers
 * and replays those exact bytes, so the HMAC signature the candidate Server
 * verifies stays intact end-to-end. The Server's own `webhook_receipts`
 * idempotency proves exactly-once across a hold→replay; the relay never dedupes.
 *
 * Controls (per channel: `stripe` | `e2b`):
 *   - `hold(channel)`            — switch the channel to hold: incoming
 *     deliveries are spooled verbatim (keyed by a generated deliveryId) and
 *     ack'd 2xx, not forwarded, until released/replayed.
 *   - `release(channel, opts)`   — switch back to pass-through; when
 *     `replayHeld` is set, first re-POST every still-held delivery verbatim.
 *   - `replay(deliveryId)`       — re-POST one held delivery's exact bytes.
 *   - `manifest(channel?)`       — read the bounded, secret-free capture manifest
 *     (a `CapturedDelivery[]`): deliveryId, channel, provider event id (or null),
 *     bytesSha256, receivedAt, state. `bytesSha256` witnesses byte-identity
 *     across hold→replay; RAW bodies and signatures NEVER appear in the manifest.
 *
 * Every control travels over the injected `CallbackRelayTransport` (BoxExec-
 * backed by default), so unit tests exercise the control surface offline with no
 * real box or relay process. The relay's spool + process are registered for
 * cleanup by the world under the `callback_relay_spool` / `callback_relay_process`
 * kinds (`relayStopped` evidence category).
 */

export interface CapturedDelivery {
  /** Relay-generated per-delivery id (safe token). */
  deliveryId: string;
  channel: RelayChannel;
  /** Provider event id (Stripe evt_… / E2B id) when parseable, else null. Never a body. */
  providerEventId: string | null;
  /** sha256 of the exact captured bytes — witnesses byte-identity across hold→replay. */
  bytesSha256: string;
  /** RFC3339 capture time. */
  receivedAt: string;
  /** `held` | `forwarded` | `replayed:<status>`. */
  state: string;
}

export interface CallbackRelayReleaseOptions {
  /** Re-POST every still-held delivery on this channel (verbatim) before switching to pass-through. */
  replayHeld?: boolean;
}

export interface CallbackRelay {
  /** Switch a channel to hold (spool verbatim, ack 2xx, do not forward). */
  hold(channel: RelayChannel): Promise<void>;
  /** Switch a channel back to pass-through, optionally replaying every held delivery first. */
  release(channel: RelayChannel, options?: CallbackRelayReleaseOptions): Promise<void>;
  /** Re-POST one held delivery's exact bytes+headers. */
  replay(deliveryId: string): Promise<void>;
  /** Read the bounded, secret-free capture manifest (optionally filtered to one channel). */
  manifest(channel?: RelayChannel): Promise<CapturedDelivery[]>;
}

/**
 * The control-plane seam, factored out so unit tests run offline. The default is
 * BoxExec-backed: `writeControl`/`triggerReplay` invoke the relay's one-shot
 * actions on the box, and `readManifest` reads the JSON-lines manifest file.
 */
export interface CallbackRelayTransport {
  /** Set a channel's mode by writing its control file (relay `set-mode`). */
  writeControl(box: BoxExec, relayDir: string, channel: RelayChannel, mode: "hold" | "pass-through"): Promise<void>;
  /** Trigger a replay of one deliveryId, or every held delivery on a channel. */
  triggerReplay(
    box: BoxExec,
    relayDir: string,
    target: { deliveryId: string } | { channel: RelayChannel },
  ): Promise<void>;
  /** Read the raw manifest lines (one JSON object per line). */
  readManifest(box: BoxExec, relayDir: string): Promise<string>;
}

export interface CallbackRelayOptions {
  /** Loopback port the relay binds on the box; must match the deploy option (default 8899). */
  listenPort?: number;
  /** Relay dir basename under the remote workdir (default `callback-relay`). */
  relayDirName?: string;
}

/**
 * Builds the relay controller against a constructed managed-cloud world. Throws
 * if the world exposes no box-exec seam (the relay lives on the candidate box).
 */
export function callbackRelay(
  world: ManagedCloudWorld,
  options: CallbackRelayOptions = {},
  transport: CallbackRelayTransport = defaultCallbackRelayTransport,
): CallbackRelay {
  if (!world.box) {
    throw new Error(
      "callbackRelay: the managed-cloud world exposes no box-exec seam; the signed-callback relay runs on the " +
        "candidate box (deploy with the callbackRelay option to stage it).",
    );
  }
  const box = world.box;
  const dir = relayDir(options.relayDirName ?? RELAY_DIRNAME);

  const readManifestRows = async (channel?: RelayChannel): Promise<CapturedDelivery[]> => {
    const rows = parseManifest(await transport.readManifest(box, dir));
    return channel ? rows.filter((row) => row.channel === channel) : rows;
  };

  // Builds a typed CallbackRelayReplayError from the manifest's `replay_failed:
  // <status>` rows (a non-2xx replay records this and leaves the delivery
  // RETRYABLE in held — it never terminalizes to `replayed:`), falling back to
  // the raw transport error when the manifest is unreadable. The most recent
  // failed status per delivery wins (a later successful replay records
  // `replayed:` and drops the delivery from the failed set).
  const replayError = async (
    channel: RelayChannel | undefined,
    cause: unknown,
  ): Promise<CallbackRelayReplayError> => {
    let failures: CallbackRelayReplayFailure[] = [];
    try {
      const rows = await readManifestRows(channel);
      const lastStatusById = new Map<string, { channel: RelayChannel; failedStatus: number | null }>();
      for (const row of rows) {
        const failed = parseReplayFailedStatus(row.state);
        const succeeded = parseReplayedStatus(row.state);
        if (failed !== null) {
          lastStatusById.set(row.deliveryId, { channel: row.channel, failedStatus: failed });
        } else if (succeeded !== null) {
          // A later success clears the retryable-failure state for this delivery.
          lastStatusById.set(row.deliveryId, { channel: row.channel, failedStatus: null });
        }
      }
      failures = [...lastStatusById.entries()]
        .filter(([, v]) => v.failedStatus !== null)
        .map(([deliveryId, v]) => ({ deliveryId, channel: v.channel, status: v.failedStatus as number }));
    } catch {
      // manifest unreadable — fall through to the raw cause below.
    }
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    return new CallbackRelayReplayError(
      failures.length > 0
        ? `callbackRelay: ${failures.length} held delivery/deliveries replayed to a non-2xx upstream and remain ` +
            `retryable (${failures.map((f) => `${f.deliveryId}=${f.status}`).join(", ")}).`
        : `callbackRelay: replay failed (${causeMessage}).`,
      failures,
    );
  };

  return {
    async hold(channel) {
      await transport.writeControl(box, dir, channel, "hold");
    },
    async release(channel, releaseOptions) {
      if (releaseOptions?.replayHeld) {
        // Replay every still-held delivery verbatim BEFORE re-opening the
        // channel, so a held delivery is never lost when switching back. A
        // non-2xx upstream on ANY held delivery makes the relay exit nonzero;
        // surface that as a typed failure carrying the per-delivery statuses,
        // and do NOT re-open the channel on a lost event.
        try {
          await transport.triggerReplay(box, dir, { channel });
        } catch (error) {
          throw await replayError(channel, error);
        }
      }
      await transport.writeControl(box, dir, channel, "pass-through");
    },
    async replay(deliveryId) {
      assertSafeDeliveryId(deliveryId);
      try {
        await transport.triggerReplay(box, dir, { deliveryId });
      } catch (error) {
        throw await replayError(undefined, error);
      }
    },
    async manifest(channel) {
      return readManifestRows(channel);
    },
  };
}

/** One held delivery whose replay hit a non-2xx upstream. */
export interface CallbackRelayReplayFailure {
  deliveryId: string;
  channel: RelayChannel;
  /** The non-2xx HTTP status the candidate Server returned for the replayed bytes. */
  status: number;
}

/** Thrown by `release({replayHeld})`/`replay` when a replayed delivery hit a non-2xx upstream. */
export class CallbackRelayReplayError extends Error {
  constructor(
    message: string,
    readonly failures: readonly CallbackRelayReplayFailure[],
  ) {
    super(message);
    this.name = "CallbackRelayReplayError";
  }
}

/** Parses `replayed:<status>` → the numeric status, else null (a terminal 2xx replay row). */
export function parseReplayedStatus(state: string): number | null {
  const match = /^replayed:(\d+)$/.exec(state);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Parses `replay_failed:<status>` → the numeric status, else null (a non-2xx, still-retryable replay row). */
export function parseReplayFailedStatus(state: string): number | null {
  const match = /^replay_failed:(\d+)$/.exec(state);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** deliveryId is interpolated into an argv; keep it a bounded safe token. */
function assertSafeDeliveryId(deliveryId: string): void {
  if (!/^[0-9a-f]{8,64}$/i.test(deliveryId)) {
    throw new Error(`callbackRelay.replay: refusing to use a non-hex deliveryId ("${deliveryId}").`);
  }
}

/** Parses the JSON-lines manifest into bounded CapturedDelivery rows (skips malformed lines). */
export function parseManifest(raw: string): CapturedDelivery[] {
  const rows: CapturedDelivery[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      typeof parsed.deliveryId === "string" &&
      (parsed.channel === "stripe" || parsed.channel === "e2b") &&
      typeof parsed.bytesSha256 === "string" &&
      typeof parsed.receivedAt === "string" &&
      typeof parsed.state === "string"
    ) {
      rows.push({
        deliveryId: parsed.deliveryId,
        channel: parsed.channel,
        providerEventId: typeof parsed.providerEventId === "string" ? parsed.providerEventId : null,
        bytesSha256: parsed.bytesSha256,
        receivedAt: parsed.receivedAt,
        state: parsed.state,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Default transport — the relay's one-shot actions over BoxExec
// ---------------------------------------------------------------------------

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * BoxExec-backed control plane. Every action runs `python3 relay.py <action>`
 * under the run-scoped relay dir with `RELAY_SPOOL_DIR` set, matching how the
 * data-plane process reads its spool. No secret ever rides these argv — the
 * relay never touches signing secrets.
 */
export const defaultCallbackRelayTransport: CallbackRelayTransport = {
  async writeControl(box, dir, channel, mode) {
    await runRelayAction(box, dir, ["set-mode", channel, mode]);
  },
  async triggerReplay(box, dir, target) {
    if ("deliveryId" in target) {
      await runRelayAction(box, dir, ["replay", target.deliveryId]);
    } else {
      await runRelayAction(box, dir, ["replay-held", target.channel]);
    }
  },
  async readManifest(box, dir) {
    const manifestPath = `${dir}/${RELAY_MANIFEST_FILENAME}`;
    // A missing manifest (no delivery yet) reads as empty, not an error.
    const { stdout } = await box.exec(`cat ${shellSingleQuote(manifestPath)} 2>/dev/null || true`);
    return stdout;
  },
};

/** Absolute relay dir on the box (mirrors ingress.ts's REMOTE_RELAY_DIR). */
function relayDir(dirName: string = RELAY_DIRNAME): string {
  return `/home/ubuntu/candidate/${dirName}`;
}

async function runRelayAction(box: BoxExec, dir: string, args: readonly string[]): Promise<void> {
  const scriptPath = `${dir}/${RELAY_SCRIPT_FILENAME}`;
  const quoted = args.map(shellSingleQuote).join(" ");
  await box.exec(
    `RELAY_SPOOL_DIR=${shellSingleQuote(dir)} python3 ${shellSingleQuote(scriptPath)} ${quoted}`,
  );
}

/** The relay listen port a controller must agree with the deploy on (default). */
export const CALLBACK_RELAY_DEFAULT_PORT = DEFAULT_RELAY_LISTEN_PORT;
