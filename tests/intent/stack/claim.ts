import { readFileSync } from "node:fs";
import type { BootedStack } from "./boot.ts";
import type { OwnedEphemeralProfile } from "./ephemeral-profile.ts";

interface ClaimInputs {
  stack: BootedStack;
  ownedProfile: OwnedEphemeralProfile;
  email: string;
  password: string;
  organizationName: string;
  fetchImpl?: typeof fetch;
  readToken?: (tokenFile: string) => string;
  visibilityAttempts?: number;
  visibilityIntervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

async function responseText(response: Response): Promise<string> {
  return (await response.text()).slice(0, 300);
}

export async function claimOwnedInstance(inputs: ClaimInputs): Promise<string> {
  const fetchImpl = inputs.fetchImpl ?? fetch;
  const readToken = inputs.readToken ?? ((tokenFile) => readFileSync(tokenFile, "utf8"));
  const delay = inputs.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (
    inputs.stack.profile !== inputs.ownedProfile.profile
    || inputs.stack.setupTokenFile !== inputs.ownedProfile.setupTokenFile
  ) {
    throw new Error("Owned setup-token custody does not match the booted stack.");
  }

  const initialProbe = await fetchImpl(`${inputs.stack.apiBaseUrl}/setup`);
  if (initialProbe.status !== 200) {
    throw new Error(`Owned ephemeral profile was not fresh (setup returned ${initialProbe.status}).`);
  }

  let setupToken: string;
  try {
    setupToken = readToken(inputs.ownedProfile.setupTokenFile).trim();
  } catch {
    throw new Error("Owned setup token is missing; refusing to claim without custody.");
  }
  if (!setupToken) {
    throw new Error("Owned setup token is empty; refusing to claim without custody.");
  }

  const claim = await fetchImpl(`${inputs.stack.apiBaseUrl}/setup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: inputs.email,
      password: inputs.password,
      setup_token: setupToken,
      organization_name: inputs.organizationName,
    }).toString(),
  });
  if (claim.status !== 200) {
    throw new Error(`Owned instance claim failed (${claim.status}): ${await responseText(claim)}`);
  }

  const attempts = inputs.visibilityAttempts ?? 80;
  const intervalMs = inputs.visibilityIntervalMs ?? 25;
  let claimVisible = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const probe = await fetchImpl(`${inputs.stack.apiBaseUrl}/setup`);
    if (probe.status === 404) {
      claimVisible = true;
      break;
    }
    if (probe.status !== 200) {
      throw new Error(`Setup visibility probe failed (${probe.status}).`);
    }
    await delay(intervalMs);
  }
  if (!claimVisible) {
    throw new Error("Owned instance claim did not become durably visible.");
  }

  const login = await fetchImpl(`${inputs.stack.apiBaseUrl}/auth/desktop/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: inputs.email, password: inputs.password }),
  });
  const body = (await login.json()) as { access_token?: string };
  if (login.status !== 200 || !body.access_token) {
    throw new Error(`Owned instance login failed (${login.status}); login is not retried.`);
  }
  return body.access_token;
}
