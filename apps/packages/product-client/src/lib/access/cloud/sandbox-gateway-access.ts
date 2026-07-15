/**
 * Product-owned indirection for the Cloud sandbox-gateway access token
 * (WDU slice 04, round-3 ruling G4). The plain gateway-connection builders in
 * `cloud-sandbox-gateway.ts` run deep in product code without a React host
 * handle, so — exactly like the R1 measurement port — the host arms a single
 * provider once at mount and the builders read it here. The provider is the
 * host's `host.cloud.getSandboxGatewayAccessToken` capability; Desktop arms it
 * with its retained token transport, Web supplies its own later. No token is
 * minted or cached here; this is a pure swappable pointer.
 */
export type SandboxGatewayAccessTokenProvider = () => Promise<string>;

let provider: SandboxGatewayAccessTokenProvider | null = null;

/**
 * Arm (or, with `null`, disarm) the sandbox-gateway token provider. The host
 * calls this once before any product code renders, passing its
 * `host.cloud.getSandboxGatewayAccessToken`.
 */
export function setSandboxGatewayAccessTokenProvider(
  next: SandboxGatewayAccessTokenProvider | null,
): void {
  provider = next;
}

/**
 * Mint a fresh sandbox-gateway access token through the armed provider. Throws
 * if no host has armed one (a host misconfiguration, never a normal runtime
 * state on a host that supplies the capability). The underlying provider itself
 * rejects when there is no signed-in session, preserving the prior transport's
 * "must sign in" rejection exactly.
 */
export function getSandboxGatewayAccessToken(): Promise<string> {
  if (!provider) {
    throw new Error(
      "Cloud sandbox-gateway access token provider is not armed by the host.",
    );
  }
  return provider();
}
