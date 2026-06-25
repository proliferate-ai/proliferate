export function canFallbackToStandardInviteSignIn(error: unknown): boolean {
  return (
    error instanceof Error
    && (
      error.message === "SSO is not configured for this environment."
      || error.message === "SSO is not available for this environment."
    )
  );
}
