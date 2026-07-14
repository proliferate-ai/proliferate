# Security Policy

We take the security of Proliferate seriously. Thank you for helping keep
Proliferate and its users safe.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, use one of the following private channels:

1. **GitHub Private Vulnerability Reporting (preferred)** — open a report via the
   repository's **Security → Report a vulnerability** tab
   ([advisories/new](https://github.com/proliferate-ai/proliferate/security/advisories/new)). This keeps the discussion
   private until a fix is released.
2. **Email** — `security@proliferate.com`

Please include as much of the following as you can:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof-of-concept
- Affected component(s) and version(s) (desktop, web, server/control plane,
  AnyHarness runtime, SDK)
- Any relevant logs or configuration (redact secrets)

## What to Expect

- **Acknowledgement** within 3 business days.
- **Assessment & triage** with an initial severity estimate shortly after.
- **Progress updates** as we work on a fix.
- **Coordinated disclosure** — we'll agree on a disclosure timeline with you and
  credit you (if you wish) once a fix is available.

Please give us a reasonable opportunity to address the issue before any public
disclosure.

## Supported Versions

Proliferate ships frequently. Security fixes target the **latest released
version** on the default branch. Self-hosters should track the latest release;
see [self-hosted-deploy.md](./specs/developing/deploying/self-hosted-deploy.md)
for the update flow.

## Scope Notes

- **Proliferate Cloud** and **self-hosting the control plane** are in **beta** —
  we especially welcome reports against these surfaces.
- When self-hosting, your keys, OAuth apps, and sandbox provider credentials are
  your responsibility; never commit them. See
  [`server/deploy/.env.production.example`](./server/deploy/.env.production.example).
