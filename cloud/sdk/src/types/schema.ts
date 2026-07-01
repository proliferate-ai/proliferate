import type { components } from "../generated/openapi.js";

export type LegacyCloudSchema = any;

export type Schema<Name extends string> =
  Name extends keyof components["schemas"]
    ? components["schemas"][Name]
    : LegacyCloudSchema;
