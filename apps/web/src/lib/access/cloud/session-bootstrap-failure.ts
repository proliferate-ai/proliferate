import { ProliferateClientError } from "@proliferate/cloud-sdk";

export function isApiUnreachableError(error: unknown): boolean {
  // An HTTP error response proves the API answered; anything else — connection
  // refused, DNS failure, timeout abort — means it never did.
  return !(error instanceof ProliferateClientError);
}
