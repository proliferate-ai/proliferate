/**
 * Prints THIS run's deterministic self-host API base URL
 * (`https://<runSubdomainLabel>.<QUALIFICATION_ZONE>`) for a `<runId> <shardId>`
 * pair, so `make qualification-selfhost` can bake it into the web renderer as
 * VITE_PROLIFERATE_API_BASE_URL (the plain web build cannot be repointed at
 * runtime; see build-selfhost-qualification-candidates.mjs). Single source of
 * truth: `runSubdomainLabel` + `QUALIFICATION_ZONE` from the DNS world module —
 * the same values the world uses to upsert the Route53 record and derive the
 * running instance's API origin, so the baked URL always matches the box.
 */
import { QUALIFICATION_ZONE, runSubdomainLabel } from "../worlds/selfhost/dns.js";

const [runId, shardId] = process.argv.slice(2);
if (!runId || !shardId) {
  process.stderr.write("usage: print-selfhost-run-api-base-url <runId> <shardId>\n");
  process.exit(2);
}

process.stdout.write(`https://${runSubdomainLabel(runId, shardId)}.${QUALIFICATION_ZONE}`);
