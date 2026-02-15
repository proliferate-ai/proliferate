# Context
You are implementing the "Virtual Key Generation & Budgeting" and "Synchronous Revocation" updates as defined in `docs/specs/llm-proxy.md`. Follow all rules in `CLAUDE.md`.

# Strict File Boundaries (Only touch these files)
- `packages/services/src/sessions/sandbox-env.ts`
- `packages/shared/src/llm-proxy.ts`
- The centralized session termination file (e.g., `packages/services/src/sessions/lifecycle.ts` or `terminate.ts` where `provider.terminate()` lives)

# Instructions
1. **Dynamic Max Budget:**
   - Modify `buildSandboxEnvVars` in `packages/services/src/sessions/sandbox-env.ts`.
   - If billing is enabled, fetch the org's current `shadow_balance`. Calculate `maxBudget = Math.max(0, shadow_balance * 0.01)`.
   - Update `packages/shared/src/llm-proxy.ts` -> `generateSessionAPIKey` and `generateVirtualKey` to accept this `maxBudget` and pass it to LiteLLM's `POST /key/generate`.
   - **Crucial:** Ensure the payload includes `key_alias: sessionId`.

2. **Synchronous Key Revocation:**
   - Implement `revokeVirtualKey(sessionId: string)` in `packages/shared/src/llm-proxy.ts` using LiteLLM's `POST /key/delete` endpoint with payload `{ key_aliases: [sessionId] }`. Catch and swallow 404s (treat as success).
   - Centralize this revocation. Find the core termination logic where `provider.terminate()` is called. Ensure a best-effort, fire-and-forget call to `revokeVirtualKey(sessionId)` is executed the moment a session is terminated, paused, or exhausted.

# Validation
Run `pnpm typecheck`. Ensure no master keys are accidentally exposed to the sandbox in `sandbox-env.ts`.
