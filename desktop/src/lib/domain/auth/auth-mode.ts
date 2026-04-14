import type { StoredAuthSession } from "@/platform/tauri/auth";

const DEV_BYPASS_TOKEN = "proliferate-dev-auth-bypass";

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return !["0", "false", "off", "no"].includes(normalized);
}

export interface ProductAuthRequirementInput {
  viteDev: boolean;
  viteRequireAuth?: string;
  proliferateEnvironment?: string;
}

export function resolveProductAuthRequired(input: ProductAuthRequirementInput): boolean {
  const environment = input.proliferateEnvironment?.trim().toLowerCase();
  const defaultValue = !input.viteDev && environment === "production";

  return envFlagEnabled(input.viteRequireAuth, defaultValue);
}

export function isDevAuthBypassed(): boolean {
  return import.meta.env.DEV && envFlagEnabled(import.meta.env.VITE_DEV_DISABLE_AUTH, false);
}

export function isProductAuthRequired(): boolean {
  return resolveProductAuthRequired({
    viteDev: import.meta.env.DEV,
    viteRequireAuth: import.meta.env.VITE_REQUIRE_AUTH,
    proliferateEnvironment: import.meta.env.VITE_PROLIFERATE_ENVIRONMENT,
  });
}

export function createDevBypassSession(): StoredAuthSession {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  return {
    access_token: DEV_BYPASS_TOKEN,
    refresh_token: DEV_BYPASS_TOKEN,
    expires_at: expiresAt,
    user_id: "local-dev-user",
    email: "dev@proliferate.local",
    display_name: "Local Developer",
  };
}
