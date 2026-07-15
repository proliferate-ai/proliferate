import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type { ProfileUpdateRequest, UserRead } from "../types/index.js";

export type { ProfileUpdateRequest, UserRead };

/** Fetch the authenticated user's own profile (`GET /users/me`). */
export async function getCurrentUser(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<UserRead> {
  return (await client.GET("/users/me")).data!;
}

/**
 * Update editable fields on the authenticated user's own profile
 * (`PATCH /users/me`). Sending `outreach_email: null` or an empty/whitespace
 * string clears the override; a non-empty value must validate as an email
 * (the server returns 422 otherwise).
 */
export async function updateCurrentUser(
  input: ProfileUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<UserRead> {
  return (await client.PATCH("/users/me", { body: input })).data!;
}
