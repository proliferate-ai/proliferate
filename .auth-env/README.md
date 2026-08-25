# Local Auth Profiles

Ignored per-provider environment files for manual auth QA live here. Create
one file per provider:

```bash
.auth-env/.env.<auth-profile>
```

`make dev`/`make run` source the selected file when `AUTH_PROFILE` is set:

```bash
make dev PROFILE=main AUTH_PROFILE=<auth-profile>
```

Each file exports provider credentials (for example OAuth client id/secret
overrides) for the run. Never use a production/shared OAuth app for local
callback experiments, and do not commit `.auth-env` credentials.
