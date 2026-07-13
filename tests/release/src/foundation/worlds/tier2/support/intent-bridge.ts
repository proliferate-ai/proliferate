/**
 * Runtime bridge into `tests/intent/stack/*.ts` (boot, seed, billing helpers).
 *
 * Deliberately uses dynamic `import()` with a computed (non-literal) path
 * instead of a static `import ... from "../../../../../../intent/stack/x.ts"`
 * for two independent reasons:
 *
 *   1. tests/intent's `.ts` files are authored for Playwright's own esbuild-
 *      based transform, not for `tsc`, and do not currently type-check under
 *      `tsc --noEmit` (confirmed: no typecheck script exists there, and
 *      running one surfaces pre-existing, unrelated errors — a `window`
 *      global without the DOM lib in spec files, a `Blob`/`Uint8Array` lib
 *      mismatch in seed.ts, etc.). A static import would silently drag all of
 *      that into `tests/release`'s own `pnpm run typecheck`, which is
 *      currently clean, and would make an unrelated fix in tests/intent a
 *      prerequisite for this workstream's typecheck to pass.
 *   2. Those files use literal `.ts` import specifiers themselves (their own
 *      convention), which `tsc`'s `moduleResolution: "bundler"` rejects
 *      without `allowImportingTsExtensions` — again, not this workstream's
 *      surface to change.
 *
 * A dynamic `import()` whose argument is not a string literal is treated as
 * `any` by `tsc` (it never attempts to resolve or type-check the target), so
 * this file is the one deliberate seam where "do not rewrite the intent
 * suite" and "own tests/release/.../worlds/tier2/" meet: the actual boot/seed/
 * billing CODE still runs unmodified at runtime (tsx resolves the absolute
 * `.ts` path exactly like it resolves any other), it is just not part of the
 * statically type-checked graph. Every exported function here re-declares the
 * narrow shape this workstream actually uses, by hand, from having read the
 * source (specs/developing/testing/README.md's "read the relevant spec
 * first" extended to reading the relevant fixture first).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// support/ -> tier2/ -> worlds/ -> foundation/ -> src/ -> release/ -> tests/
const INTENT_STACK_DIR = path.resolve(here, "..", "..", "..", "..", "..", "..", "intent", "stack");

function intentModulePath(fileName: string): string {
  // path.join collapses to a plain string the way `import()` needs; kept out
  // of the import expression itself so tsc never sees a literal specifier.
  return path.join(INTENT_STACK_DIR, fileName);
}

export interface StripeBillingEnvLike {
  secretKey: string;
  webhookSecret: string;
  proMonthlyPriceId: string;
  overagePriceId: string;
  refillPriceId: string;
  meterId: string;
  billingMode: string;
}

export interface BootedStackLike {
  profile: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  anyharnessBaseUrl: string;
  databaseUrl: string;
  setupTokenFile: string;
  teardown: () => Promise<void>;
}

export interface BootOptionsLike {
  profile?: string;
  stripe?: StripeBillingEnvLike;
  skipFrontend?: boolean;
  extraServerEnv?: NodeJS.ProcessEnv;
}

interface BootModule {
  bootStack: (options?: BootOptionsLike) => Promise<BootedStackLike>;
  REPO_ROOT: string;
}

export async function loadBootModule(): Promise<BootModule> {
  return (await import(intentModulePath("boot.ts"))) as unknown as BootModule;
}

export interface DesktopTokensLike {
  access_token: string;
  refresh_token: string;
}

interface SeedModule {
  ADMIN_EMAIL: string;
  ADMIN_PASSWORD: string;
  ADMIN_ORG_NAME: string;
  ensureInstanceClaimed: () => Promise<void>;
  passwordLogin: (email: string, password: string) => Promise<DesktopTokensLike>;
  apiRequest: <T = unknown>(
    urlPath: string,
    options?: { method?: string; token?: string; body?: unknown },
  ) => Promise<{ status: number; body: T }>;
}

export async function loadSeedModule(): Promise<SeedModule> {
  return (await import(intentModulePath("seed.ts"))) as unknown as SeedModule;
}

export interface GrantRowLike {
  id: string;
  grant_type: string;
  hours_granted: number;
  remaining_seconds: number;
  effective_at: string;
  expires_at: string | null;
  source_ref: string | null;
}

export interface SeededSubjectLike {
  id: string;
  kind: "personal" | "organization";
  stripeCustomerId: string | null;
}

interface BillingModule {
  ensureProductReady: (userId: string, email: string) => Promise<void>;
  ensurePersonalSubject: (userId: string, stripeCustomerId?: string) => Promise<SeededSubjectLike>;
  createTestClock: (frozenTime?: Date) => { id: string };
  createCustomer: (opts: { clockId: string; billingSubjectId: string; email: string }) => { id: string };
  createProSubscription: (opts: { customerId: string; seats: number; overage?: boolean }) => { id: string; status: string };
  retrieveSubscription: (subscriptionId: string) => any;
  stripeCli: <T = unknown>(args: string[]) => T;
  deliverEvent: (opts: {
    type: string;
    object: Record<string, any>;
    eventId?: string;
    timestamp?: number;
  }) => Promise<{ status: number; body: unknown; eventId: string }>;
  listGrants: (subjectId: string) => Promise<GrantRowLike[]>;
}

export async function loadBillingModule(): Promise<BillingModule> {
  // billing.ts re-exports billing-env.ts and billing-seed.ts, so this one
  // dynamic import is enough to reach every helper this workstream needs.
  return (await import(intentModulePath("billing.ts"))) as unknown as BillingModule;
}
