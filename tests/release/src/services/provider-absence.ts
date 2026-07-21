/**
 * Controller-only provider-absence observers for SH-BASE-TURN.
 *
 * LiteLLM is observed through its authenticated transaction ledger, scoped to
 * the exact self-host actor. E2B is observed at the candidate API process's
 * network boundary, so failed/rejected calls are visible even though the base
 * profile has no E2B credential and therefore cannot create a provider event.
 * Configuration remains a separate defense-in-depth assertion; neither
 * observer credential/capture artifact reaches the candidate or persisted
 * evidence.
 */

import { createHash } from "node:crypto";

import { SELFHOST_PROVIDER_ABSENCE_SETTLE_MS } from "../evidence/schema.js";
import { SELFHOST_DEPLOY_DIR } from "../worlds/selfhost/install.js";

export const PROVIDER_ABSENCE_SETTLE_MS = SELFHOST_PROVIDER_ABSENCE_SETTLE_MS;
const ADMIN_REQUEST_TIMEOUT_MS = 30_000;
const COMPOSE = `sudo docker compose --env-file ${SELFHOST_DEPLOY_DIR}/.env.runtime -f ${SELFHOST_DEPLOY_DIR}/docker-compose.production.yml`;
const E2B_HOSTNAME = "api.e2b.app";
const CANARY_HOSTNAME = "proliferate-e2b-observer.invalid";

export interface ProviderAbsenceConfig {
  litellmAdminBaseUrl: string;
  litellmMasterKey: string;
}

export interface ProviderAbsenceSsh {
  run(command: string, options?: { timeoutMs?: number }): Promise<string>;
}

export interface ProviderAbsenceBaseline {
  takenAt: string;
  actorUserId: string;
  litellmActorRequestIds: readonly string[];
  apiContainerId: string;
  apiPid: string;
  apiNetnsInode: string;
  captureId: string;
  capturePcapPath: string;
  capturePidPath: string;
  captureLogPath: string;
  e2bDnsCanarySeen: true;
  e2bTlsCanarySeen: true;
}

export interface ProviderAbsenceObservation {
  windowStartedAt: string;
  windowFinishedAt: string;
  observedAt: string;
  litellmSettleMs: number;
  litellmSpendRows: 0;
  e2bTrafficMatches: 0;
  e2bDnsCanarySeen: true;
  e2bTlsCanarySeen: true;
}

export interface ProviderAbsenceHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ProviderAbsenceFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<ProviderAbsenceHttpResponse>;

export interface ProviderAbsenceDeps {
  fetch?: ProviderAbsenceFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  settleMs?: number;
}

interface LiteLlmSpendRow {
  requestId: string;
  startedAt: string | null;
  user: string | null;
  metadataUserId: string | null;
}

export class ProviderAbsenceObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderAbsenceObservationError";
  }
}

export class QualificationProviderAbsenceObserver {
  private readonly fetch: ProviderAbsenceFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly settleMs: number;

  constructor(
    private readonly config: ProviderAbsenceConfig,
    deps: ProviderAbsenceDeps = {},
  ) {
    this.fetch = deps.fetch ?? defaultFetch;
    this.sleep = deps.sleep ?? sleepMs;
    this.now = deps.now ?? (() => new Date());
    this.settleMs = deps.settleMs ?? PROVIDER_ABSENCE_SETTLE_MS;
  }

  /**
   * Authenticate/snapshot the actor-scoped LiteLLM ledger, prove the remote
   * packet observer with independent DNS and TLS-SNI canaries, then start the
   * measured capture before the caller timestamps the turn window.
   */
  async preflightAndStart(params: {
    ssh: ProviderAbsenceSsh;
    actorUserId: string;
  }): Promise<ProviderAbsenceBaseline> {
    this.requireConfig();
    if (!params.actorUserId.trim()) {
      throw new ProviderAbsenceObservationError("Provider absence observer requires an actor user id.");
    }
    const takenAt = this.now().toISOString();
    const rows = await this.listLiteLlmSpendRows(takenAt, takenAt);
    const actorRows = this.actorRows(rows, params.actorUserId);
    const captureId = createHash("sha256")
      .update(`${params.actorUserId}:${takenAt}`)
      .digest("hex")
      .slice(0, 20);
    const paths = capturePaths(captureId);
    let captureIdentity: Pick<ProviderAbsenceBaseline, "apiContainerId" | "apiPid" | "apiNetnsInode">;
    try {
      const ready = await params.ssh.run(encodedBash(startCaptureScript(captureId, paths)), {
        timeoutMs: 5 * 60_000,
      });
      captureIdentity = parseCaptureIdentity(ready);
    } catch (error) {
      // The capture id/path are controller-derived before the remote start. If
      // SSH times out or its success receipt is lost after tcpdump launches,
      // perform an exact-path process sweep rather than losing cleanup custody.
      try {
        await params.ssh.run(encodedBash(closeCaptureScript(paths)), { timeoutMs: 60_000 });
      } catch (cleanupError) {
        throw new ProviderAbsenceObservationError(
          `Provider observer start failed and exact capture cleanup also failed: ${boundedError(cleanupError)}`,
        );
      }
      throw error;
    }
    return {
      takenAt,
      actorUserId: params.actorUserId,
      litellmActorRequestIds: uniqueSorted(actorRows.map((row) => row.requestId)),
      ...captureIdentity,
      captureId,
      ...paths,
      e2bDnsCanarySeen: true,
      e2bTlsCanarySeen: true,
    };
  }

  /**
   * Stop and inspect the network capture immediately after the measured window,
   * then wait for LiteLLM's asynchronous ledger ingestion and require zero new
   * actor-attributed in-window rows.
   */
  async observeAbsent(params: {
    ssh: ProviderAbsenceSsh;
    baseline: ProviderAbsenceBaseline;
    windowStartedAt: string;
    windowFinishedAt: string;
  }): Promise<ProviderAbsenceObservation> {
    this.requireConfig();
    const baselineAt = parseTimestamp("provider baseline", params.baseline.takenAt);
    const windowStart = parseTimestamp("provider window start", params.windowStartedAt);
    const windowEnd = parseTimestamp("provider window finish", params.windowFinishedAt);
    if (windowEnd < windowStart) {
      throw new ProviderAbsenceObservationError("Provider observation window finishes before it starts.");
    }
    if (baselineAt > windowStart) {
      throw new ProviderAbsenceObservationError("Provider baseline was captured after the observation window started.");
    }

    const rawTrafficMatches = (
      await params.ssh.run(encodedBash(stopAndInspectCaptureScript(params.baseline)), { timeoutMs: 60_000 })
    ).trim();
    if (!/^\d+$/.test(rawTrafficMatches)) {
      throw new ProviderAbsenceObservationError("E2B egress observer returned a malformed match count.");
    }
    const e2bTrafficMatches = Number(rawTrafficMatches);
    if (e2bTrafficMatches !== 0) {
      throw new ProviderAbsenceObservationError(
        `Candidate API egress recorded ${e2bTrafficMatches} E2B hostname match(es) inside the BYOK turn window.`,
      );
    }

    await this.sleep(this.settleMs);
    const rows = await this.listLiteLlmSpendRows(params.windowStartedAt, params.windowFinishedAt);
    const actorRows = this.actorRows(rows, params.baseline.actorUserId);
    const baselineRequestIds = new Set(params.baseline.litellmActorRequestIds);
    const newActorRows = actorRows.filter((row) => !baselineRequestIds.has(row.requestId));
    const ambiguousRows = newActorRows.filter((row) => row.startedAt === null);
    if (ambiguousRows.length > 0) {
      throw new ProviderAbsenceObservationError(
        `LiteLLM returned ${ambiguousRows.length} new actor spend row(s) without a provider timestamp; absence is ambiguous.`,
      );
    }
    const inWindowRows = actorRows.filter((row) => {
      if (row.startedAt === null) return false;
      const at = Date.parse(row.startedAt);
      return Number.isFinite(at) && at >= windowStart && at <= windowEnd;
    });
    if (inWindowRows.length > 0) {
      throw new ProviderAbsenceObservationError(
        `LiteLLM recorded ${inWindowRows.length} actor spend row(s) inside the BYOK turn window.`,
      );
    }

    return {
      windowStartedAt: params.windowStartedAt,
      windowFinishedAt: params.windowFinishedAt,
      observedAt: this.now().toISOString(),
      litellmSettleMs: this.settleMs,
      litellmSpendRows: 0,
      e2bTrafficMatches: 0,
      e2bDnsCanarySeen: params.baseline.e2bDnsCanarySeen,
      e2bTlsCanarySeen: params.baseline.e2bTlsCanarySeen,
    };
  }

  /** Idempotent cleanup for every early-return/failure path after capture start. */
  async close(params: { ssh: ProviderAbsenceSsh; baseline: ProviderAbsenceBaseline }): Promise<void> {
    await params.ssh.run(encodedBash(closeCaptureScript(params.baseline)), { timeoutMs: 60_000 });
  }

  private requireConfig(): void {
    for (const [name, value] of [
      ["litellmAdminBaseUrl", this.config.litellmAdminBaseUrl],
      ["litellmMasterKey", this.config.litellmMasterKey],
    ] as const) {
      if (!value.trim()) {
        throw new ProviderAbsenceObservationError(`Provider absence observer is missing "${name}".`);
      }
    }
    if (!/^https:\/\//i.test(this.config.litellmAdminBaseUrl)) {
      throw new ProviderAbsenceObservationError("Provider absence observer requires an HTTPS LiteLLM admin URL.");
    }
  }

  private actorRows(rows: readonly LiteLlmSpendRow[], actorUserId: string): LiteLlmSpendRow[] {
    const expectedUser = `user-${actorUserId}`;
    return rows.filter((row, index) => {
      const userMatches = row.user === expectedUser;
      const metadataMatches = row.metadataUserId === actorUserId;
      if (!userMatches && !metadataMatches) return false;
      if ((row.user !== null && !userMatches) || (row.metadataUserId !== null && !metadataMatches)) {
        throw new ProviderAbsenceObservationError(
          `LiteLLM actor spend row ${index} carried conflicting user attribution; absence is ambiguous.`,
        );
      }
      return true;
    });
  }

  private async listLiteLlmSpendRows(startedAt: string, finishedAt: string): Promise<LiteLlmSpendRow[]> {
    const startDate = startedAt.slice(0, 10);
    const endDate = utcDatePlusDays(finishedAt, 1);
    const url =
      `${trimTrailingSlash(this.config.litellmAdminBaseUrl)}/spend/logs` +
      `?summarize=false&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    const response = await this.fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${this.config.litellmMasterKey}` },
      signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProviderAbsenceObservationError(`LiteLLM spend observer failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new ProviderAbsenceObservationError("LiteLLM spend observer returned a non-array payload.");
    }
    return payload.map((value, index) => {
      const row = asRecord(value);
      const requestId = typeof row.request_id === "string" ? row.request_id : "";
      if (!requestId) {
        throw new ProviderAbsenceObservationError(`LiteLLM spend row ${index} omitted its request identity.`);
      }
      const started =
        typeof row.startTime === "string"
          ? row.startTime
          : typeof row.start_time === "string"
            ? row.start_time
            : null;
      if (started !== null && !Number.isFinite(Date.parse(started))) {
        throw new ProviderAbsenceObservationError(`LiteLLM spend row ${index} carried an invalid timestamp.`);
      }
      const metadata = asRecord(row.metadata);
      return {
        requestId,
        startedAt: started,
        user: typeof row.user === "string" ? row.user : null,
        metadataUserId:
          typeof metadata.proliferate_user_id === "string" ? metadata.proliferate_user_id : null,
      };
    });
  }
}

interface CapturePaths {
  capturePcapPath: string;
  capturePidPath: string;
  captureLogPath: string;
}

function capturePaths(captureId: string): CapturePaths {
  const prefix = `/tmp/proliferate-e2b-observer-${captureId}`;
  return {
    capturePcapPath: `${prefix}.pcap`,
    capturePidPath: `${prefix}.pid`,
    captureLogPath: `${prefix}.log`,
  };
}

function startCaptureScript(captureId: string, paths: CapturePaths): string {
  const dnsCanary = capturePaths(`${captureId}-dns-canary`);
  const tlsCanary = capturePaths(`${captureId}-tls-canary`);
  const canaryHostname = `${captureId}.${CANARY_HOSTNAME}`;
  return `
set -Eeuo pipefail
if ! command -v tcpdump >/dev/null 2>&1; then
  sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tcpdump >/dev/null
fi
container="$(${COMPOSE} ps -q api)"
test -n "$container"
api_pid="$(sudo docker inspect --format '{{.State.Pid}}' "$container")"
test "$api_pid" -gt 0
api_netns_inode="$(sudo stat -Lc '%i' "/proc/$api_pid/ns/net")"
case "$container" in ''|*[!a-f0-9]*) exit 1 ;; esac
case "$api_netns_inode" in ''|*[!0-9]*) exit 1 ;; esac
${captureShellHelpers()}
startup_complete=0
cleanup_partial() {
  rc=$?
  trap - EXIT
  set +e
  cleanup_rc=0
  cleanup_capture '${dnsCanary.capturePidPath}' '${dnsCanary.capturePcapPath}' '${dnsCanary.captureLogPath}' || cleanup_rc=1
  cleanup_capture '${tlsCanary.capturePidPath}' '${tlsCanary.capturePcapPath}' '${tlsCanary.captureLogPath}' || cleanup_rc=1
  cleanup_capture '${paths.capturePidPath}' '${paths.capturePcapPath}' '${paths.captureLogPath}' || cleanup_rc=1
  if test "$startup_complete" -ne 1 && test "$rc" -eq 0; then rc=1; fi
  if test "$cleanup_rc" -ne 0; then rc=1; fi
  exit "$rc"
}
trap cleanup_partial EXIT
start_capture() {
  pcap="$1"; pidfile="$2"; logfile="$3"
  sudo rm -f "$pcap" "$pidfile" "$logfile"
  sudo sh -c "nohup nsenter -t '$api_pid' -n tcpdump -Z root -i any -U -s 0 -w '$pcap' '(udp port 53 or tcp port 53 or tcp port 443)' >'$logfile' 2>&1 & echo \\$! >'$pidfile'"
  for _ in $(seq 1 20); do
    capture_pid="$(sudo cat "$pidfile" 2>/dev/null || true)"
    if test -n "$capture_pid" &&
      sudo kill -0 "$capture_pid" 2>/dev/null &&
      capture_owned "$capture_pid" "$pcap" &&
      sudo test -s "$pcap"; then
      return 0
    fi
    sleep 0.25
  done
  sudo tail -n 20 "$logfile" >&2 || true
  return 1
}
stop_capture() {
  pidfile="$1"; pcap="$2"
  capture_pid="$(sudo cat "$pidfile" 2>/dev/null || true)"
  test -n "$capture_pid"
  capture_owned "$capture_pid" "$pcap"
  sudo kill -INT "$capture_pid"
  for _ in $(seq 1 20); do
    if ! sudo kill -0 "$capture_pid" 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}
start_capture '${dnsCanary.capturePcapPath}' '${dnsCanary.capturePidPath}' '${dnsCanary.captureLogPath}'
sudo docker exec "$container" python -c "import socket; socket.getaddrinfo('${canaryHostname}', 443)" >/dev/null 2>&1 || true
sleep 1
stop_capture '${dnsCanary.capturePidPath}' '${dnsCanary.capturePcapPath}'
dns_matches="$(capture_matches '${dnsCanary.capturePcapPath}' '${canaryHostname}')"
test "$dns_matches" -gt 0
sudo rm -f '${dnsCanary.capturePcapPath}' '${dnsCanary.capturePidPath}' '${dnsCanary.captureLogPath}'

start_capture '${tlsCanary.capturePcapPath}' '${tlsCanary.capturePidPath}' '${tlsCanary.captureLogPath}'
sudo docker exec "$container" python -c "import socket, ssl; raw = socket.create_connection(('1.1.1.1', 443), 5); ssl.create_default_context().wrap_socket(raw, server_hostname='${canaryHostname}')" >/dev/null 2>&1 || true
sleep 1
stop_capture '${tlsCanary.capturePidPath}' '${tlsCanary.capturePcapPath}'
tls_matches="$(capture_matches '${tlsCanary.capturePcapPath}' '${canaryHostname}')"
test "$tls_matches" -gt 0
sudo rm -f '${tlsCanary.capturePcapPath}' '${tlsCanary.capturePidPath}' '${tlsCanary.captureLogPath}'

start_capture '${paths.capturePcapPath}' '${paths.capturePidPath}' '${paths.captureLogPath}'
printf 'PROVIDER_OBSERVER_READY\t%s\t%s\t%s\n' "$container" "$api_pid" "$api_netns_inode"
startup_complete=1
trap - EXIT
`;
}

function stopAndInspectCaptureScript(baseline: ProviderAbsenceBaseline): string {
  return `
set -euo pipefail
${captureShellHelpers()}
container="$(${COMPOSE} ps -q api)"
test "$container" = '${baseline.apiContainerId}'
api_pid="$(sudo docker inspect --format '{{.State.Pid}}' "$container")"
test "$api_pid" = '${baseline.apiPid}'
api_netns_inode="$(sudo stat -Lc '%i' "/proc/$api_pid/ns/net")"
test "$api_netns_inode" = '${baseline.apiNetnsInode}'
capture_pid="$(sudo cat '${baseline.capturePidPath}' 2>/dev/null || true)"
test -n "$capture_pid"
sudo kill -0 "$capture_pid"
capture_owned "$capture_pid" '${baseline.capturePcapPath}'
sudo kill -INT "$capture_pid"
for _ in $(seq 1 20); do
  if ! sudo kill -0 "$capture_pid" 2>/dev/null; then break; fi
  sleep 0.25
done
if sudo kill -0 "$capture_pid" 2>/dev/null; then exit 1; fi
matches="$(capture_matches '${baseline.capturePcapPath}' '${E2B_HOSTNAME}')"
case "$matches" in ''|*[!0-9]*) exit 1 ;; esac
printf '%s\n' "$matches"
`;
}

function closeCaptureScript(baseline: CapturePaths): string {
  return `
set -euo pipefail
${captureShellHelpers()}
cleanup_capture '${baseline.capturePidPath}' '${baseline.capturePcapPath}' '${baseline.captureLogPath}'
`;
}

function captureShellHelpers(): string {
  return `
capture_owned() {
  capture_pid="$1"; pcap="$2"
  case "$capture_pid" in ''|*[!0-9]*) return 1 ;; esac
  cmdline="$(sudo cat "/proc/$capture_pid/cmdline" 2>/dev/null | tr '\\0' ' ' || true)"
  printf '%s' "$cmdline" | grep -F 'tcpdump' >/dev/null
  printf '%s' "$cmdline" | grep -F -- "$pcap" >/dev/null
}
capture_pids_for_pcap() {
  pcap="$1"
  sudo ps -eo pid=,comm=,args= | awk -v needle="$pcap" '$2 == "tcpdump" && index($0, needle) { print $1 }'
}
wait_capture_exit() {
  capture_pid="$1"
  for _ in $(seq 1 20); do
    if ! sudo kill -0 "$capture_pid" 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}
terminate_capture_pid() {
  capture_pid="$1"; pcap="$2"
  capture_owned "$capture_pid" "$pcap"
  for signal in INT TERM KILL; do
    if ! sudo kill -0 "$capture_pid" 2>/dev/null; then return 0; fi
    # tcpdump may exit and its PID may be reused during a bounded wait. Never
    # escalate to a process that no longer carries the exact capture identity.
    if ! capture_owned "$capture_pid" "$pcap"; then return 0; fi
    sudo kill -"$signal" "$capture_pid"
    if wait_capture_exit "$capture_pid"; then return 0; fi
  done
  ! sudo kill -0 "$capture_pid" 2>/dev/null
}
cleanup_capture() {
  pidfile="$1"; pcap="$2"; logfile="$3"
  cleanup_rc=0
  capture_pid="$(sudo cat "$pidfile" 2>/dev/null || true)"
  if test -n "$capture_pid"; then
    case "$capture_pid" in ''|*[!0-9]*) ;;
      *)
        if sudo kill -0 "$capture_pid" 2>/dev/null; then
          if capture_owned "$capture_pid" "$pcap"; then
            terminate_capture_pid "$capture_pid" "$pcap" || cleanup_rc=1
          fi
        fi
        ;;
    esac
  fi
  owned_pids="$(capture_pids_for_pcap "$pcap")" || return 1
  for owned_pid in $owned_pids; do
    terminate_capture_pid "$owned_pid" "$pcap" || cleanup_rc=1
  done
  survivors="$(capture_pids_for_pcap "$pcap")" || return 1
  if test -n "$survivors"; then
    return 1
  fi
  sudo rm -f "$pcap" "$pidfile" "$logfile"
  return "$cleanup_rc"
}
capture_matches() {
  pcap="$1"; hostname="$2"
  test -s "$pcap"
  decoded="$(mktemp)"; parse_errors="$(mktemp)"
  if ! sudo tcpdump -nn -A -r "$pcap" >"$decoded" 2>"$parse_errors"; then
    tail -n 20 "$parse_errors" >&2 || true
    rm -f "$decoded" "$parse_errors"
    return 1
  fi
  set +e
  matches="$(grep -cF -- "$hostname" "$decoded")"
  grep_status=$?
  set -e
  rm -f "$decoded" "$parse_errors"
  case "$grep_status" in 0|1) ;; *) return 1 ;; esac
  case "$matches" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$matches"
}
`;
}

function encodedBash(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return `printf '%s' '${encoded}' | base64 -d | bash`;
}

function parseTimestamp(label: string, value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ProviderAbsenceObservationError(`${label} is not a valid timestamp.`);
  }
  return parsed;
}

function parseCaptureIdentity(
  value: string,
): Pick<ProviderAbsenceBaseline, "apiContainerId" | "apiPid" | "apiNetnsInode"> {
  const match = value.trim().match(/^PROVIDER_OBSERVER_READY\t([a-f0-9]{12,64})\t([1-9]\d*)\t([1-9]\d*)$/);
  if (!match) {
    throw new ProviderAbsenceObservationError("Provider observer returned a malformed API network identity receipt.");
  }
  return { apiContainerId: match[1]!, apiPid: match[2]!, apiNetnsInode: match[3]! };
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 240);
}

function utcDatePlusDays(isoTimestamp: string, days: number): string {
  const base = new Date(isoTimestamp);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultFetch: ProviderAbsenceFetch = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<ProviderAbsenceHttpResponse>;
