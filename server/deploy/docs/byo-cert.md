# Bring-Your-Own Certificate (Internal CA)

## When to use this

Use the BYO-cert configuration when:

- Your organization requires TLS certificates from an internal certificate authority (CA) rather than public ACME providers like Let's Encrypt
- You operate in an environment where ACME validation (DNS or HTTP challenge) is not feasible
- Corporate policy mandates certificates issued by your PKI infrastructure

If you have access to public DNS and can use ACME, the standard `docker-compose.production.yml` with automatic Let's Encrypt certificates is simpler and requires no certificate management.

## Setup

### 1. Obtain your certificate

Work with your infrastructure team to obtain a TLS certificate for your instance's hostname (the `SITE_ADDRESS` value in your `.env.static` file). You need:

- **Certificate file** (`server.crt`): PEM-encoded, may be a single certificate or a full chain including intermediates
- **Private key** (`server.key`): PEM-encoded, unencrypted or encrypted (Caddy supports encrypted keys)

### 2. Place certificates on the host

Create a directory on the deployment host and copy your certificate files:

```bash
sudo mkdir -p /opt/proliferate/certs
sudo cp server.crt /opt/proliferate/certs/
sudo cp server.key /opt/proliferate/certs/
sudo chmod 644 /opt/proliferate/certs/server.crt
sudo chmod 600 /opt/proliferate/certs/server.key
sudo chown 1000:1000 /opt/proliferate/certs/*
```

The caddy container runs as UID 1000 by default, so the files must be readable by that user. The read-only mount in the compose file prevents modification.

If you prefer a different host path, set `PROLIFERATE_HOST_CERT_DIR` in your `.env.local`:

```bash
PROLIFERATE_HOST_CERT_DIR=/var/ssl/proliferate
```

### 3. Use the BYO-cert compose override

The BYO-cert setup uses Docker Compose's [multiple-file override](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/) mechanism. When you run `bootstrap.sh` or operational commands, specify both compose files:

```bash
# First-time setup
docker compose -f docker-compose.production.yml -f docker-compose.byo-cert.yml up -d

# Updates (after pulling new server images)
docker compose -f docker-compose.production.yml -f docker-compose.byo-cert.yml up -d

# Stop services
docker compose -f docker-compose.production.yml -f docker-compose.byo-cert.yml down
```

The override file switches Caddy to the `Caddyfile.byo-cert` variant and mounts your certificate directory.

**Note on bootstrap.sh:** The `bootstrap.sh` script does not currently support the BYO-cert override automatically. For initial setup, run the individual commands manually:

```bash
cd server/deploy
export PROLIFERATE_STATIC_ENV_FILE=.env.static
export PROLIFERATE_ENV_FILE=.env.runtime
./ensure-secrets.sh
./registry-login.sh
./install-runtime.sh

COMPOSE_ARGS="--env-file .env.runtime -f docker-compose.production.yml -f docker-compose.byo-cert.yml"
docker compose $COMPOSE_ARGS up -d db
docker compose $COMPOSE_ARGS run --rm migrate
docker compose $COMPOSE_ARGS up -d api caddy
./wait-for-health.sh
```

### 4. Trust the internal CA

**Critical:** Every machine connecting to your self-hosted instance must trust your internal CA's root certificate. This includes:

- Developer desktops running the Proliferate desktop app
- Any cloud sandbox environments (E2B templates must include the CA certificate in their trust store)
- CI/CD systems or automation that calls the API

Without the root CA in the system trust store, connections will fail with certificate verification errors. Consult your organization's IT documentation for how to add the CA certificate to macOS Keychain, Windows Certificate Store, or Linux trust anchors.

## Certificate renewal

When your certificate approaches expiration:

1. Obtain a renewed certificate from your CA
2. Replace the files in `/opt/proliferate/certs/` (or your custom path)
3. Reload Caddy:
   ```bash
   docker compose -f docker-compose.production.yml -f docker-compose.byo-cert.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

Caddy reloads gracefully without dropping connections.

## Quick test with a self-signed certificate

For development or proof-of-concept testing (not production), you can generate a self-signed certificate:

```bash
sudo mkdir -p /opt/proliferate/certs
cd /opt/proliferate/certs

# Generate a 2048-bit RSA key and self-signed cert valid for 365 days
sudo openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server.key \
  -out server.crt \
  -days 365 \
  -subj "/CN=$(hostname -f)"

sudo chmod 644 server.crt
sudo chmod 600 server.key
sudo chown 1000:1000 server.*
```

Then proceed with step 3 above. Remember that clients will show certificate warnings and must explicitly trust the self-signed certificate.

## Troubleshooting

**"certificate verify failed" errors from desktop app:**
- Verify the internal CA root certificate is installed in the system trust store
- On macOS: Keychain Access → System keychain → add CA cert → mark "Always Trust"
- On Linux: copy CA cert to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates`

**Caddy fails to start with "permission denied" reading certificates:**
- Check file ownership: `ls -l /opt/proliferate/certs`
- Ensure UID 1000 can read: `sudo chown 1000:1000 /opt/proliferate/certs/*`

**"tls: failed to parse private key" error:**
- Verify the key is PEM-encoded (begins with `-----BEGIN PRIVATE KEY-----` or similar)
- If the key is encrypted, Caddy will prompt for the passphrase — this is not supported in the container; decrypt it first with `openssl rsa -in encrypted.key -out server.key`
