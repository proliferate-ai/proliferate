# Delivery specification — cull sweep, Track C: delete-sso (frozen)

Chain position: Track C of the approved cull sweep (merge order: E and G
anytime · A → B → C → F → D). Independent of the other tracks at authoring
time; rebases after A and B land are expected to be mechanical. Evidence of
record: the cull investigation (five parallel passes) and the approved
delivery-spec draft set; this document freezes the Track C deltas.

## Intent

Delete SSO end-to-end — server, client, tests, config, docs. SSO is culled
product surface: it is not part of the product's forward direction, and its
weight (~40 settings, 4 server packages, ~700 client lines, 36 test files)
taxes every auth change.

## Scope

- Server packages: `integrations/sso/`, `auth/sso/`, `server/accounts/sso/`,
  `server/organizations/sso/`; both router registrations plus the `main.py`
  ordering hack and its comment; `sso_*` settings in `config.py`;
  `db/store/auth_sso.py` + `db/store/auth_sso_records.py`; SSO models in
  `db/models/auth.py` and SSO references in organizations models/services.
- Scripts and build: `scripts/seed_sso.py`, Makefile `seed-sso` target.
- Client surfaces: `OrganizationSsoPane`, `OrganizationSsoSettingsSurface`,
  `CloudOrganizationSsoSettingsSurface`, LoginPage SSO branches, settings
  sidebar/registry entries, SSO hooks and domain files, `OrgSsoLoginLink`,
  web `SsoLoginEntryRoute` + auth-transport branches, desktop
  `proliferate-sso-auth.ts` + orchestration wiring.
- SDK: `cloud/sdk/src/client/sso.ts`, `cloud/sdk/src/types/sso.ts`,
  `cloud/sdk-react/src/hooks/sso.ts`, index/query-key exports; SDK regen.
- Tests: SSO server unit + integration files; intent specs + stack + mock-IdP
  wiring; release-scenario SSO references. Mixed-content tests are edited
  surgically, not deleted.
- Docs and ledgers: `specs/server/auth.md` SSO sections,
  `specs/developing/reference/env-vars.yaml` entries, SSO rows in
  `lints/server/*.toml`, TESTING/guides mentions.

## Non-goals

No auth-system redesign; non-SSO login flows (OAuth providers, email) are
preserved bit-for-bit. No route renames outside deletion. No migration
dropping SSO tables in this PR if other tracks own the alembic head at merge
time — table drop may ship as its own follow-up migration if head conflicts
demand it (default: include the drop here).

## Traps

- **Keep `python-jose`** — shared with core JWT (`auth/jwt.py`).
- Alembic history files (`b5c6d7e8f9a0_sso_connections.py`, merge revision)
  stay — history is immutable; only a new drop migration is added.
- `organization_member_auth_methods` store: SSO is one auth method among
  several — edit, don't delete.
- Grep hazard: `sso` is a substring of `processor`/`associated` — sweep with
  word-boundary/token-aware patterns only.

## Acceptance

- Login/auth suites green; full server suite green after test deletions.
- Server boots with every `sso_*` setting absent from the environment.
- No live `sso` references outside git history and alembic version files
  (allowed: CHANGELOG/ADR mentions).
- Docs checker (`python3 scripts/check_docs.py`) green.
- Client typechecks/builds.
