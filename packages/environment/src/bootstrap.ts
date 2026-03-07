import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Load .env files for non-Next.js contexts (worker, db migrations, scripts).
// Neither call uses `override`, so shell/CI/Next.js vars always win.
// Load .env.local first so its values take precedence over .env defaults.
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const envLocalPath = resolve(root, ".env.local");
const envPath = resolve(root, ".env");
if (existsSync(envLocalPath)) config({ path: envLocalPath });
if (existsSync(envPath)) config({ path: envPath });
