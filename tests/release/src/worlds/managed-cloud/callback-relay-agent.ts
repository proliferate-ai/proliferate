/**
 * The on-box signed-callback relay's data plane (PR 6 fixture 2). Fronting the
 * candidate Server's two signed webhook endpoints —
 * `/v1/billing/webhooks/stripe` (HMAC over the exact raw bytes, Stripe-Signature
 * header) and `/v1/cloud/webhooks/e2b` (E2B signature over the raw bytes) — is a
 * single-file Python http process that must forward BYTE-IDENTICALLY: it never
 * re-encodes, re-orders headers, or re-signs, because any mutation of the body
 * or the signed headers breaks the signature the Server verifies. It has NO
 * emit/synthesize capability by construction (there is no code path that
 * fabricates a delivery); it can only spool a genuine delivery and re-POST those
 * exact bytes, so the fixture cannot manufacture a webhook the provider never
 * sent. The Server's own `webhook_receipts` idempotency proves exactly-once
 * across a hold→replay, so the relay never dedupes.
 *
 * Two per-channel modes, switched via a control file the controller writes over
 * SSH:
 *   - `pass-through` (default): forward the delivery to the upstream Server
 *     verbatim and return the upstream response — behaviourally invisible.
 *   - `hold`: spool the verbatim bytes+headers keyed by a generated deliveryId,
 *     ack the provider 2xx immediately, and forward only on an explicit replay.
 *
 * The long-running process is `relay.py serve`; the controller drives one-shot
 * actions (`set-mode`, `replay`, `replay-held`) as separate short invocations
 * over the same box, so no in-process control socket or watcher thread is
 * needed. Every manifest row is bounded and secret-free (a deliveryId, the
 * channel, an optional provider event id, the sha256 of the exact bytes, a
 * timestamp, and the state) — never a raw body or signature; `bytesSha256`
 * proves byte-identity across hold→replay.
 *
 * This module is data-plane only: it exports the script text, the fixed webhook
 * paths/channel map, and the on-box filename conventions. `ingress.ts` stages
 * and starts the process and wires the Caddy routes; `fixtures/callback-relay.ts`
 * is the controller. Neither the script nor this module ever reads a webhook
 * signing secret — the relay forwards the signed bytes untouched, so the Server
 * (which holds the secret) is the only verifier.
 *
 * Correctness properties enforced by the script (see the focused execution tests
 * in callback-relay-agent.test.ts):
 *   - a loopback `GET /__relay/health` (never forwarded) so ingress can prove the
 *     relay is live BEFORE Caddy routes signed callbacks through it;
 *   - ATOMIC control-file writes (tmp+rename) and FAIL-CLOSED reads: a control
 *     file that exists but is unreadable/corrupt is treated as `hold` (buffer,
 *     never forward), so a callback during hold activation can never bypass it;
 *   - TERMINAL delivery state: replay renames the spool files out of the held dir
 *     (atomic), and replay-held enumerates the held dir (not the append-only
 *     manifest), so a delivery is replayed exactly once and never re-selected;
 *   - NON-2xx PROPAGATION: a replay whose upstream returns non-2xx exits nonzero
 *     (and replay-held aggregates failures), so the controller surfaces the loss
 *     instead of silently reopening pass-through.
 */

/** The signed webhook channels the relay fronts. */
export type RelayChannel = "stripe" | "e2b";

/** Per-channel relay mode (pass-through is the default, behaviourally invisible). */
export type RelayMode = "pass-through" | "hold";

/**
 * The candidate Server's two signed webhook request paths, in the order Caddy
 * matches them. These are prefix-relative to the deployment origin (the
 * candidate Server mounts its routers at `/v1/...` with no api prefix, matching
 * `deployCandidateApi`'s local-prefix posture).
 */
export const RELAY_CHANNEL_PATHS: Readonly<Record<RelayChannel, string>> = {
  stripe: "/v1/billing/webhooks/stripe",
  e2b: "/v1/cloud/webhooks/e2b",
};

/** The two webhook paths Caddy routes through the relay (only when the option is present). */
export const RELAY_WEBHOOK_PATHS: readonly string[] = [
  RELAY_CHANNEL_PATHS.stripe,
  RELAY_CHANNEL_PATHS.e2b,
];

/** The relay's on-box filename conventions (all relative to the run-scoped spool dir). */
export const RELAY_SCRIPT_FILENAME = "relay.py";
/** JSON-lines manifest the controller reads (one bounded, secret-free row per delivery). */
export const RELAY_MANIFEST_FILENAME = "manifest.jsonl";
/** Per-channel control file: `{"mode":"hold"|"pass-through"}`. */
export function relayControlFilename(channel: RelayChannel): string {
  return `control-${channel}.json`;
}

/** Default loopback port the relay http process binds on the box. */
export const DEFAULT_RELAY_LISTEN_PORT = 8899;
/** Default relay dir basename under the candidate box's remote workdir. */
export const RELAY_DIRNAME = "callback-relay";
/** Loopback readiness endpoint (never forwarded upstream); ingress polls it for 200 before routing Caddy. */
export const RELAY_HEALTH_PATH = "/__relay/health";

/**
 * The single-file relay process (stdlib only; no third-party deps on the box).
 *
 * `serve`             — run the forwarding http server on RELAY_PORT.
 * `set-mode C M`      — write channel C's control file to mode M.
 * `replay ID`         — re-POST the spooled bytes for deliveryId ID, verbatim.
 * `replay-held C`     — re-POST every still-held delivery for channel C, verbatim.
 *
 * Byte-identity guarantees, enforced structurally by this script:
 *   - the request body is read as exact bytes (Content-Length) and forwarded /
 *     spooled unchanged; replay reads the spooled bytes back and POSTs them as-is;
 *   - every request header except `Host` (which the http client sets per
 *     connection) is copied verbatim, so the provider signature header rides
 *     untouched;
 *   - there is NO method that constructs a body or a signature — only forward
 *     and replay of captured bytes exist.
 */
export const CALLBACK_RELAY_SCRIPT = `#!/usr/bin/env python3
"""On-box signed-callback relay (qualification fixture; forwards byte-identically)."""
import hashlib
import json
import os
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

# Signed callback bodies + header sidecars are replay-capable credential
# material, so nothing this process writes may be group/other-readable. Set a
# restrictive umask at startup (belt); every dir is created 0700 and every file
# opened 0600 (suspenders).
os.umask(0o077)

SPOOL_DIR = os.environ["RELAY_SPOOL_DIR"]
UPSTREAM = os.environ.get("RELAY_UPSTREAM", "http://127.0.0.1:8000")
PORT = int(os.environ.get("RELAY_PORT", "8899"))
HELD_DIR = os.path.join(SPOOL_DIR, "held")
REPLAYED_DIR = os.path.join(SPOOL_DIR, "replayed")
MANIFEST = os.path.join(SPOOL_DIR, "manifest.jsonl")
HEALTH_PATH = "/__relay/health"

CHANNEL_PATHS = {
    "stripe": "/v1/billing/webhooks/stripe",
    "e2b": "/v1/cloud/webhooks/e2b",
}
PATH_CHANNELS = {path: channel for channel, path in CHANNEL_PATHS.items()}

# The relay NEVER re-signs and NEVER synthesizes: only forward and replay of
# captured bytes exist. The Host header is the sole header the http client owns
# per connection; every other header (including the provider signature) is
# copied verbatim so the signed bytes+headers reach the Server unchanged.
_SKIP_FORWARD_HEADERS = {"host"}


def _ensure_dirs():
    # Owner-only spool dirs (0700), enforced with an explicit chmod (makedirs mode
    # is masked by umask, and an existing dir keeps its mode without one).
    for d in (SPOOL_DIR, HELD_DIR, REPLAYED_DIR):
        os.makedirs(d, mode=0o700, exist_ok=True)
        os.chmod(d, 0o700)


def _write_bytes_0600(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)


def _write_text_0600(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text)


def _control_path(channel):
    return os.path.join(SPOOL_DIR, "control-%s.json" % channel)


def _mode_for(channel):
    # FAIL-CLOSED during hold: a control file that does NOT exist means the
    # channel was never put into hold (default pass-through). But a control file
    # that DOES exist yet is unreadable/unparseable is an UNKNOWN state that may
    # be an in-flight hold — buffer it, never forward. We cannot silently
    # pass-through an unknown state or a callback could bypass a configured hold.
    path = _control_path(channel)
    if not os.path.exists(path):
        return "pass-through"
    try:
        with open(path, "r") as handle:
            data = json.load(handle)
        mode = (data or {}).get("mode", "pass-through")
        return mode if mode in ("hold", "pass-through") else "hold"
    except (OSError, ValueError):
        # Control file present but unreadable/corrupt → fail closed (hold).
        return "hold"


def _atomic_write_json(path, obj):
    # tmp + rename (0600) so a reader never sees a half-written control file (the
    # race a non-atomic overwrite would open during hold activation).
    tmp = path + ".tmp-" + uuid.uuid4().hex
    _write_text_0600(tmp, json.dumps(obj))
    os.replace(tmp, path)


def _provider_event_id(channel, body):
    # Best-effort: the provider event id is a bounded, non-secret identifier
    # (Stripe evt_…, E2B event id). Only the id is ever extracted; the raw body
    # is never recorded in the manifest.
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(parsed, dict):
        return None
    candidate = parsed.get("id") or parsed.get("event_id")
    return candidate if isinstance(candidate, str) else None


def _append_manifest(row):
    # Open 0600 (only affects a first create; subsequent appends keep the mode).
    fd = os.open(MANIFEST, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\\n")


def _forward(method, path, headers, body):
    fwd = urlrequest.Request(UPSTREAM + path, data=body, method=method)
    for name, value in headers:
        if name.lower() in _SKIP_FORWARD_HEADERS:
            continue
        fwd.add_header(name, value)
    try:
        with urlrequest.urlopen(fwd, timeout=30) as resp:
            return resp.status, resp.read()
    except HTTPError as err:
        return err.code, err.read()
    except URLError as err:
        return 502, ("relay upstream error: %s" % err).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def _respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Loopback readiness probe (ingress waits for 200 before routing Caddy
        # through the relay). Never forwarded upstream.
        if self.path == HEALTH_PATH:
            self._respond(200, b'{"relay":"ok"}')
            return
        self._respond(404, b'{"relay":"not-found"}')

    def do_POST(self):
        channel = PATH_CHANNELS.get(self.path)
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        if channel is None:
            # Unmatched path: forward verbatim so the relay is transparent to
            # anything Caddy routed here by mistake.
            status, resp = _forward("POST", self.path, self.headers.items(), body)
            self._respond(status, resp)
            return
        delivery_id = uuid.uuid4().hex
        digest = hashlib.sha256(body).hexdigest()
        provider_event_id = _provider_event_id(channel, body)
        mode = _mode_for(channel)
        if mode == "hold":
            # Spool the verbatim bytes + headers under a per-delivery pair, then
            # record the channel/path in a sidecar so replay never has to scan
            # the manifest to recover them (which the terminal-state rename could
            # otherwise race). All three land BEFORE the 2xx ack.
            _write_bytes_0600(os.path.join(HELD_DIR, delivery_id + ".bin"), body)
            _write_text_0600(
                os.path.join(HELD_DIR, delivery_id + ".headers.json"),
                json.dumps([[k, v] for k, v in self.headers.items()]),
            )
            _write_text_0600(
                os.path.join(HELD_DIR, delivery_id + ".meta.json"),
                json.dumps({"channel": channel, "path": self.path}),
            )
            _append_manifest({
                "deliveryId": delivery_id,
                "channel": channel,
                "providerEventId": provider_event_id,
                "bytesSha256": digest,
                "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "state": "held",
            })
            # Ack the provider 2xx so it does not retry while the delivery is held.
            self._respond(200, b'{"relay":"held"}')
            return
        status, resp = _forward("POST", self.path, self.headers.items(), body)
        _append_manifest({
            "deliveryId": delivery_id,
            "channel": channel,
            "providerEventId": provider_event_id,
            "bytesSha256": digest,
            "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "state": "forwarded",
        })
        self._respond(status, resp)


def _read_held(delivery_id):
    with open(os.path.join(HELD_DIR, delivery_id + ".bin"), "rb") as handle:
        body = handle.read()
    with open(os.path.join(HELD_DIR, delivery_id + ".headers.json"), "r") as handle:
        headers = json.load(handle)
    with open(os.path.join(HELD_DIR, delivery_id + ".meta.json"), "r") as handle:
        meta = json.load(handle)
    return body, headers, meta


def _mark_replayed(delivery_id):
    # TERMINAL state via atomic rename: move the spool files out of HELD_DIR so a
    # subsequent replay-held never re-selects an already-replayed delivery. Once
    # the .meta.json is moved the delivery is no longer "held" by construction
    # (_held_delivery_ids enumerates .meta.json). Also sweep the retryable
    # last_status sidecar a prior failed attempt may have left behind.
    for suffix in (".bin", ".headers.json", ".meta.json"):
        src = os.path.join(HELD_DIR, delivery_id + suffix)
        if os.path.exists(src):
            os.replace(src, os.path.join(REPLAYED_DIR, delivery_id + suffix))
    stale = os.path.join(HELD_DIR, delivery_id + ".last_status.json")
    if os.path.exists(stale):
        os.replace(stale, os.path.join(REPLAYED_DIR, delivery_id + ".last_status.json"))


def _replay(delivery_id):
    body, headers, meta = _read_held(delivery_id)
    path = meta.get("path") or CHANNEL_PATHS.get(meta.get("channel"))
    channel = meta.get("channel")
    if path is None:
        raise SystemExit("relay replay: unknown channel/path for delivery %s" % delivery_id)
    status, _resp = _forward("POST", path, headers, body)
    if 200 <= status < 300:
        # ONLY terminalize on a 2xx: the delivery is now durably accepted, so move
        # it out of held (atomic rename) — replay-held will never re-select it.
        _mark_replayed(delivery_id)
        _append_manifest({
            "deliveryId": delivery_id,
            "channel": channel,
            "providerEventId": None,
            "bytesSha256": hashlib.sha256(body).hexdigest(),
            "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "state": "replayed:%d" % status,
        })
        return
    # NON-2xx: the provider was already ack'd 2xx and will not resend, so the
    # delivery must remain RETRYABLE — leave it in HELD (do NOT terminalize),
    # record the last status in a sidecar for diagnostics, and exit nonzero so
    # the controller surfaces the failure (and does not reopen pass-through). A
    # later replay after the upstream recovers will then succeed and terminalize.
    _write_text_0600(
        os.path.join(HELD_DIR, delivery_id + ".last_status.json"),
        json.dumps({"last_status": status, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}),
    )
    _append_manifest({
        "deliveryId": delivery_id,
        "channel": channel,
        "providerEventId": None,
        "bytesSha256": hashlib.sha256(body).hexdigest(),
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "state": "replay_failed:%d" % status,
    })
    raise SystemExit("relay replay: delivery %s upstream returned %d (left retryable in held)" % (delivery_id, status))


def _held_delivery_ids(channel):
    # Source of truth is the HELD_DIR contents (terminal rename removes replayed
    # ones), NOT the append-only manifest — so replay-held is one-shot.
    ids = []
    try:
        names = sorted(os.listdir(HELD_DIR))
    except OSError:
        return []
    for name in names:
        if not name.endswith(".meta.json"):
            continue
        delivery_id = name[: -len(".meta.json")]
        try:
            with open(os.path.join(HELD_DIR, name), "r") as handle:
                meta = json.load(handle)
        except (OSError, ValueError):
            continue
        if meta.get("channel") == channel:
            ids.append(delivery_id)
    return ids


def main():
    _ensure_dirs()
    if len(sys.argv) < 2 or sys.argv[1] == "serve":
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
        return
    action = sys.argv[1]
    if action == "set-mode":
        channel, mode = sys.argv[2], sys.argv[3]
        _atomic_write_json(_control_path(channel), {"mode": mode})
    elif action == "replay":
        _replay(sys.argv[2])
    elif action == "replay-held":
        failures = []
        for delivery_id in _held_delivery_ids(sys.argv[2]):
            try:
                _replay(delivery_id)
            except SystemExit as exc:
                failures.append(str(exc))
        if failures:
            raise SystemExit("relay replay-held: %d failure(s): %s" % (len(failures), "; ".join(failures)))
    else:
        raise SystemExit("relay: unknown action %r" % action)


if __name__ == "__main__":
    main()
`;
