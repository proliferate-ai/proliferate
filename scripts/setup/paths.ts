import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(SCRIPT_DIR, "..", "..");

export const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, ".env.example");
export const ENV_PROD_PATH = resolve(ROOT_DIR, ".env.prod");
export const ENV_SCHEMA_PATH = resolve(ROOT_DIR, "packages/environment/src/schema.ts");
export const PULUMI_DIR = resolve(ROOT_DIR, "infra/pulumi");
