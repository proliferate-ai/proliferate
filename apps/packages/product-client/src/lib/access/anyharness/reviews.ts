import { getAnyHarnessClient, type AnyHarnessClientConnection } from "@anyharness/sdk-react";

type AnyHarnessClient = ReturnType<typeof getAnyHarnessClient>;
type ListSessionReviewsOptions =
  Parameters<AnyHarnessClient["reviews"]["listForSession"]>[1];

export function listSessionReviews(
  connection: AnyHarnessClientConnection,
  sessionId: string,
  options?: ListSessionReviewsOptions,
) {
  return getAnyHarnessClient(connection).reviews.listForSession(sessionId, options);
}
