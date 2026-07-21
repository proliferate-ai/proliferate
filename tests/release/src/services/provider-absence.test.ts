import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  QualificationProviderAbsenceObserver,
  type ProviderAbsenceFetch,
  type ProviderAbsenceHttpResponse,
  type ProviderAbsenceSsh,
} from "./provider-absence.js";

const CONFIG = {
  litellmAdminBaseUrl: "https://litellm.example.com",
  litellmMasterKey: "master-secret",
};
const ACTOR_ID = "018f8f87-02c4-7d24-a869-3f1eb24f1791";
const BASELINE_AT = "2026-07-20T12:00:00.000Z";
const WINDOW_START = "2026-07-20T12:00:01.000Z";
const WINDOW_FINISH = "2026-07-20T12:00:05.000Z";

function response(payload: unknown, status = 200): ProviderAbsenceHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function fixtureFetch(params: { baseline?: unknown[]; observed?: unknown[]; status?: number } = {}): ProviderAbsenceFetch {
  let calls = 0;
  return async () => {
    calls += 1;
    return response(calls === 1 ? (params.baseline ?? []) : (params.observed ?? []), params.status ?? 200);
  };
}

class FakeSsh implements ProviderAbsenceSsh {
  readonly scripts: string[] = [];

  constructor(private readonly e2bMatches = 0) {}

  async run(command: string): Promise<string> {
    const encoded = command.match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
    assert.ok(encoded, "expected a base64-encoded remote script");
    const script = Buffer.from(encoded, "base64").toString("utf8");
    this.scripts.push(script);
    if (script.includes("PROVIDER_OBSERVER_READY")) {
      return `PROVIDER_OBSERVER_READY\t${"a".repeat(64)}\t4242\t9001\n`;
    }
    return script.includes("matches=") ? `${this.e2bMatches}\n` : "";
  }
}

function observer(fetch: ProviderAbsenceFetch): QualificationProviderAbsenceObserver {
  let nowCalls = 0;
  return new QualificationProviderAbsenceObserver(CONFIG, {
    fetch,
    sleep: async () => undefined,
    settleMs: 0,
    now: () => new Date(nowCalls++ === 0 ? BASELINE_AT : "2026-07-20T12:01:10.000Z"),
  });
}

async function baseline(subject: QualificationProviderAbsenceObserver, ssh: ProviderAbsenceSsh) {
  return subject.preflightAndStart({ ssh, actorUserId: ACTOR_ID });
}

test("provider absence observer accepts zero actor spend and zero candidate E2B egress", async () => {
  const existingActorRow = {
    request_id: "old-request",
    startTime: "2026-07-20T11:00:00.000Z",
    user: `user-${ACTOR_ID}`,
    metadata: { proliferate_user_id: ACTOR_ID },
  };
  const ssh = new FakeSsh();
  const subject = observer(fixtureFetch({ baseline: [existingActorRow], observed: [existingActorRow] }));
  const before = await baseline(subject, ssh);
  const result = await subject.observeAbsent({
    ssh,
    baseline: before,
    windowStartedAt: WINDOW_START,
    windowFinishedAt: WINDOW_FINISH,
  });

  assert.deepEqual(result, {
    windowStartedAt: WINDOW_START,
    windowFinishedAt: WINDOW_FINISH,
    observedAt: "2026-07-20T12:01:10.000Z",
    litellmSettleMs: 0,
    litellmSpendRows: 0,
    e2bTrafficMatches: 0,
    e2bDnsCanarySeen: true,
    e2bTlsCanarySeen: true,
  });
  await subject.close({ ssh, baseline: before });
  assert.equal(ssh.scripts.length, 3);
});

test("provider absence observer fails on a new actor-attributed LiteLLM transaction", async () => {
  const ssh = new FakeSsh();
  const subject = observer(
    fixtureFetch({
      observed: [
        {
          request_id: "new-request",
          startTime: "2026-07-20T12:00:03.000Z",
          user: `user-${ACTOR_ID}`,
          metadata: { proliferate_user_id: ACTOR_ID },
        },
      ],
    }),
  );
  const before = await baseline(subject, ssh);
  await assert.rejects(
    subject.observeAbsent({ ssh, baseline: before, windowStartedAt: WINDOW_START, windowFinishedAt: WINDOW_FINISH }),
    /LiteLLM recorded 1 actor spend row\(s\)/,
  );
});

test("provider absence observer ignores unrelated shared-proxy spend", async () => {
  const ssh = new FakeSsh();
  const subject = observer(
    fixtureFetch({
      observed: [
        {
          request_id: "another-world",
          startTime: "2026-07-20T12:00:03.000Z",
          user: "user-someone-else",
          metadata: { proliferate_user_id: "someone-else" },
        },
      ],
    }),
  );
  const before = await baseline(subject, ssh);
  const result = await subject.observeAbsent({
    ssh,
    baseline: before,
    windowStartedAt: WINDOW_START,
    windowFinishedAt: WINDOW_FINISH,
  });
  assert.equal(result.litellmSpendRows, 0);
});

test("provider absence observer fails on any E2B hostname traffic from the candidate API namespace", async () => {
  const ssh = new FakeSsh(2);
  const subject = observer(fixtureFetch());
  const before = await baseline(subject, ssh);
  await assert.rejects(
    subject.observeAbsent({ ssh, baseline: before, windowStartedAt: WINDOW_START, windowFinishedAt: WINDOW_FINISH }),
    /recorded 2 E2B hostname match\(es\)/,
  );
});

test("provider absence observer fails closed on conflicting actor attribution", async () => {
  const subject = observer(
    fixtureFetch({
      observed: [
        {
          request_id: "conflicted",
          startTime: "2026-07-20T12:00:03.000Z",
          user: `user-${ACTOR_ID}`,
          metadata: { proliferate_user_id: "someone-else" },
        },
      ],
    }),
  );
  const ssh = new FakeSsh();
  const before = await baseline(subject, ssh);
  await assert.rejects(
    subject.observeAbsent({ ssh, baseline: before, windowStartedAt: WINDOW_START, windowFinishedAt: WINDOW_FINISH }),
    /conflicting user attribution; absence is ambiguous/,
  );
});

test("provider absence observer fails before capture when LiteLLM admin is unavailable", async () => {
  const ssh = new FakeSsh();
  await assert.rejects(baseline(observer(fixtureFetch({ status: 503 })), ssh), /HTTP 503/);
  assert.equal(ssh.scripts.length, 0);
});

test("remote observer proves capture with a canary and measures api.e2b.app inside the API network namespace", async () => {
  const ssh = new FakeSsh();
  const subject = observer(fixtureFetch());
  const before = await baseline(subject, ssh);
  await subject.observeAbsent({ ssh, baseline: before, windowStartedAt: WINDOW_START, windowFinishedAt: WINDOW_FINISH });
  await subject.close({ ssh, baseline: before });

  const startScript = ssh.scripts[0];
  assert.match(startScript, /nsenter -t '\$api_pid' -n tcpdump/);
  assert.match(startScript, /\/opt\/proliferate\/server\/deploy\/docker-compose\.production\.yml/);
  assert.match(startScript, /docker exec "\$container" python -c/);
  assert.match(startScript, /[a-f0-9]{20}\.proliferate-e2b-observer\.invalid/);
  assert.match(startScript, /socket\.create_connection\(\('1\.1\.1\.1', 443\), 5\)/);
  assert.match(startScript, /capture_matches/);
  assert.match(startScript, /startup_complete=0/);
  assert.match(startScript, /trap cleanup_partial EXIT/);
  assert.doesNotMatch(startScript, /trap cleanup_partial ERR/);
  assert.match(startScript, /if test "\$startup_complete" -ne 1 && test "\$rc" -eq 0; then rc=1; fi/);
  assert.match(startScript, /exit "\$rc"/);
  assert.match(startScript, /capture_owned "\$capture_pid" "\$pcap"/);
  assert.match(startScript, /sudo test -s "\$pcap"/);
  assert.match(startScript, /PROVIDER_OBSERVER_READY/);
  assert.match(startScript, /docker inspect --format '\{\{\.State\.Pid\}\}'/);
  assert.match(ssh.scripts[1], /api\.e2b\.app/);
  assert.match(ssh.scripts[1], new RegExp("a".repeat(64)));
  assert.match(ssh.scripts[1], /test "\$api_pid" = '4242'/);
  assert.match(ssh.scripts[1], /test "\$api_netns_inode" = '9001'/);
  assert.match(ssh.scripts[1], /if ! sudo tcpdump/);
  assert.doesNotMatch(ssh.scripts[1], /tcpdump[^\n]+\|[^\n]+\|\| true/);
  assert.match(ssh.scripts[2], /for signal in INT TERM KILL/);
  assert.match(ssh.scripts[2], /capture_owned/);
  for (const script of ssh.scripts) {
    const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test("a lost or malformed start receipt triggers exact-path cleanup before failing", async () => {
  class LostReceiptSsh implements ProviderAbsenceSsh {
    readonly scripts: string[] = [];

    async run(command: string): Promise<string> {
      const encoded = command.match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
      assert.ok(encoded);
      const script = Buffer.from(encoded, "base64").toString("utf8");
      this.scripts.push(script);
      return this.scripts.length === 1 ? "receipt-lost" : "";
    }
  }

  const ssh = new LostReceiptSsh();
  await assert.rejects(baseline(observer(fixtureFetch()), ssh), /malformed API network identity receipt/);
  assert.equal(ssh.scripts.length, 2);
  assert.match(ssh.scripts[1]!, /cleanup_capture/);
  assert.match(ssh.scripts[1]!, /capture_pids_for_pcap/);
});

test("LiteLLM credential is carried only in the authorization header", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch: ProviderAbsenceFetch = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    return response([]);
  };
  await baseline(observer(fetch), new FakeSsh());
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]!.url.includes("master-secret"));
  assert.equal(calls[0]!.headers.authorization, "Bearer master-secret");
});
