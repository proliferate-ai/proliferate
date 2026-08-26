# Identity

Plane: server · Status: current · Grade: B

Identity is who acts: **accounts** (a person becomes a `User`: sign-in, linked
identities, session and token minting) and **organizations** (the tenant:
membership, roles, invitations, service subjects). One system because every
authorization question resolves through the pair (user, organization), and
service subjects — the org-owned identity headless runs execute as — sit
exactly on the join.

Sections:

- [accounts.md](accounts.md) — the accounts half (users, sign-in, identities, tokens).
- [organizations.md](organizations.md) — the organizations half (tenancy, membership, roles, service subjects).
- [invitations.md](invitations.md) — invitation flows.
- [auth-surface.md](auth-surface.md) — the server auth surface rules (JWT, middleware, route classes).

Fences: what a subject may spend is billing's; which model credential a user
launches with is agent_auth's.
