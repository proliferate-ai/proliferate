import type {
  AuthState,
  ProductAuthIssue,
  ProductAuthReadiness,
  ProductAuthUser,
  ProductHost,
} from "@proliferate/product-client/host/product-host";

import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { AuthMethod } from "@proliferate/product-domain/auth/model";

/**
 * Pure ProductHost fixtures — deliberately free of any import of
 * `ProductHostProvider` or `@testing-library`. Test files that mock the
 * `ProductHostProvider` module import their host builders from here so the mock
 * factory does not form a circular async import with the module it replaces.
 */

function mapTestAuthUser(user: AuthUser): ProductAuthUser {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: user.avatar_url ?? null,
    githubLogin: user.github_login ?? null,
  };
}

export interface TestAuthStateOptions {
  methods?: AuthMethod[];
  readiness?: ProductAuthReadiness;
  issue?: ProductAuthIssue;
}

/** Build a normalized {@link AuthState} for a test. */
export function testAuthState(
  status: AuthState["status"],
  user?: AuthUser | null,
  options?: TestAuthStateOptions,
): AuthState {
  if (status === "authenticated") {
    return {
      status: "authenticated",
      user: user ? mapTestAuthUser(user) : null,
      readiness: options?.readiness ?? { status: "ready" },
    };
  }
  if (status === "anonymous") {
    return options?.issue
      ? { status: "anonymous", methods: options.methods ?? [], issue: options.issue }
      : { status: "anonymous", methods: options?.methods ?? [] };
  }
  return { status: "loading" };
}

const asyncNoop = async () => {};

export interface TestProductHostOptions {
  authState?: AuthState;
  authRequired?: boolean;
  auth?: Partial<ProductHost["auth"]>;
  deployment?: Partial<ProductHost["deployment"]>;
  cloudClient?: ProductHost["cloud"]["client"];
  desktop?: ProductHost["desktop"];
  overrides?: Partial<ProductHost>;
}

/**
 * A minimal but complete ProductHost for tests. Every capability is a stub
 * unless overridden; `desktop` defaults to null (a non-Desktop host) so only
 * tests that need a bridge supply one.
 */
export function makeTestProductHost(options: TestProductHostOptions = {}): ProductHost {
  const {
    authState = testAuthState("anonymous"),
    authRequired = true,
    auth,
    deployment,
    cloudClient = null,
    desktop = null,
    overrides,
  } = options;
  return {
    surface: desktop ? "desktop" : "web",
    deployment: {
      apiBaseUrl: "https://api.example.test",
      ...deployment,
    },
    auth: {
      authRequired,
      state: authState,
      restoreSession: asyncNoop,
      startLogin: asyncNoop,
      finishLogin: asyncNoop,
      cancelLogin: asyncNoop,
      logout: asyncNoop,
      ...auth,
    },
    cloud: { client: cloudClient },
    storage: {
      getItem: async () => null,
      setItem: asyncNoop,
      removeItem: asyncNoop,
    },
    links: {
      openExternal: asyncNoop,
      buildReturnUrl: () => "",
      observeInboundEntries: () => () => {},
    },
    clipboard: { writeText: asyncNoop },
    telemetry: {
      track: () => {},
      captureException: () => {},
      setUser: () => {},
      setTag: () => {},
      routeChanged: () => {},
      getSupportContext: () => ({ clientReleaseId: "desktop@test" }),
    },
    desktop,
    ...overrides,
  };
}

/**
 * Bridge a legacy Desktop auth-store snapshot (status + user) into a test
 * ProductHost. Lets tests that still steer the auth store via `setState` keep
 * doing so: mock `useProductHost` to call this with the store selectors, and
 * the consuming component re-renders on `setState` because the selectors
 * subscribe it. `bootstrapping` maps to the shared `loading`.
 */
export function authStoreBridgedHost(
  status: "bootstrapping" | "anonymous" | "authenticated",
  user: AuthUser | null,
  options?: TestProductHostOptions,
): ProductHost {
  const authState =
    status === "bootstrapping"
      ? testAuthState("loading")
      : status === "authenticated"
        ? testAuthState("authenticated", user)
        : testAuthState("anonymous");
  return makeTestProductHost({ authState, ...options });
}
