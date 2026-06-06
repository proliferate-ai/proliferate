# Server Lib

Status: authoritative for reusable cross-domain logic under `server/proliferate/lib/**`.

`lib/**` is reusable cross-domain logic — the product concerns, integration capabilities, and generic machinery that more than one domain needs, that no single domain owns, that are not raw vendor clients, and that own no durable state and no product policy. It is the smallest layer: almost everything has a more specific home, so `lib/` is the last resort, not the default.

## Placement

Route by this. If nothing fits cleanly, it does not belong in `lib/`:

```text
raw third-party SDK/API access                   -> integrations/
generic, dumb (no product, no vendor, no DB)     -> lib/infra/
cross-domain PURE product logic (no I/O)         -> lib/product/
cross-domain orchestration over a vendor (I/O)   -> lib/capabilities/
single-domain pure logic                         -> server/<domain>/domain/
owns durable state or product policy             -> a domain (its service.py / db/store)
```

Two axes route everything: **product-aware?** (no → `infra`) and **does I/O?** (no → `product`, yes via a vendor → `capabilities`). Single-domain logic stays with its domain; cross-domain logic lives in `lib/`.

## Sub-areas

Each sub-area is defined by its import boundary.

| Sub-area | Product-aware? | Does I/O? | May import | Owns |
| --- | --- | --- | --- | --- |
| `lib/infra/` | no | no | low-level/generic libraries only | ids, time, batching, safe parsing, generic string utils |
| `lib/product/` | yes | no | `lib/infra`, `constants`, `config`, other `lib/product` | message/prompt building, product-aware formatting, shared validation, vocabulary, projections |
| `lib/capabilities/` | yes | yes | `integrations/`, `lib/product`, `lib/infra`, `constants`, `config` | reusable orchestration over a vendor (`llm_providers`, embeddings) |

## Boundaries

1. A concern belongs in `lib/` only when two or more domains share it. Single-consumer logic lives in `server/<domain>/domain/` and moves into `lib/` on the second consumer.
2. `lib/` owns no durable product state and no product policy. No `lib/` file imports `db/store`. `lib/` provides the reusable *how*; domains own the *what, when, and persist*.
3. `lib/` never imports `server/<domain>/**`. `lib/product/` additionally never imports `integrations/`.
4. Each concern is a folder with a narrow public API (`__init__.py`) and owns one noun-able concern. No loose files at any sub-area root. Generic helpers live in `lib/infra/`; there is no `utils/`, `helpers/`, `common/`, or `misc/` bucket.
5. A concern that grows durable state or product policy becomes a domain (`server/<domain>/`). A concern used by only one domain belongs in that domain's `domain/`.

## Shape

```text
server/proliferate/lib/
  infra/
    <technical-concern>/
      <helper>.py
  product/
    <concern>/
      __init__.py        # narrow public surface domains import
      <core>.py
      models.py          # concern-owned types, not product/db records
      <concern>.py
  capabilities/
    <capability>/
      __init__.py        # narrow public surface
      <core>.py          # orchestration over the integration
      selection.py       # provider/strategy selection when applicable
      models.py
```

## `lib/infra/`

Generic technical machinery with no product vocabulary and no vendor.

- Owns: ids and stable keys, time, scheduling, batching, safe JSON parsing, generic string and number formatting, measurement plumbing.
- Does not own: any product concept (sessions, workspaces, billing) — that is `product`.
- Imports: low-level and generic libraries only. Never `integrations/`, `db/store`, or `server/<domain>`.

A function that knows the product belongs in `product`; a vendor SDK belongs in `integrations`.

## `lib/product/`

Cross-domain pure product logic — product-aware, no I/O.

- Owns: message and prompt construction, product-aware formatting such as status-to-display copy, shared validation and vocabulary, cross-domain projections and view models.
- Does not own: durable state or product policy. Performs no I/O.
- Imports: `lib/infra`, `constants`, `config`, other `lib/product`. Never `integrations/`, `db/store`, network clients, or `server/<domain>`.

Pure functions: data in, decision, string, or model out. Single-domain pure logic stays in `server/<domain>/domain/`; only the shared part lives here.

## `lib/capabilities/`

Cross-domain capabilities that orchestrate integrations — product-aware, does I/O.

- Owns: the reusable operation over a vendor — provider and strategy selection, request building, retries, async offload — plus capability-owned types. `lib/capabilities/llm_providers` exposes `prompt(provider, messages)`.
- Does not own: durable product state or product policy. Not a raw vendor client — that is `integrations/`.
- Imports: `integrations/`, `lib/product`, `lib/infra`, `constants`, `config`. Never `db/store` or `server/<domain>`.

Stateless and dependency-injected: take the client, config, and data as arguments. No hidden module-level singletons. Blocking SDK calls run off the event loop.

## Example

The title-generation feature across the layers:

```text
integrations/llm_providers/        raw OpenAI/Anthropic clients, vendor models and errors
lib/capabilities/llm_providers/    prompt(provider, messages): selection, retries, async
lib/product/titles/                build_title_prompt(), normalize_title()
server/ai_magic/service.py         generate_and_save_title(): builds the prompt, calls the
                                   capability to generate, calls the store to save
```

`integrations` is the raw client; `lib/capabilities` is the reusable I/O operation over it; `lib/product` is the pure prompt and formatting logic; the domain composes them, persists, and decides. Nothing in `lib/` touches the database or decides product policy.

## Rules

- `lib/` is the last resort: default domain-local, and a concern enters only at two or more consumers.
- No `lib/` file imports `db/store` or `server/<domain>/**`. No durable state or product policy in `lib/`.
- `lib/product/` is pure: it does not import `integrations/` or perform I/O.
- Each concern is a folder with a public `__init__.py`. Generic helpers live in `lib/infra/`; there is no `utils/`, `helpers/`, `common/`, or `misc/` bucket.
- `lib/capabilities/` is stateless and dependency-injected; no hidden singletons; blocking work runs off the event loop.

## Smells

- a `lib/` file imports `db/store` or writes product rows → it is a domain
- a `lib/` file decides who-can, when, or billing → product policy → a domain
- a concern is used by only one domain → it belongs in that domain's `domain/`
- a `lib/product/**` file imports `integrations/` → it is not pure; it is a capability
- a `helpers.py` or `utils.py` appears → name the concern, or it is `infra`
- `lib/` imports a domain service → invert it and pass data or dependencies in