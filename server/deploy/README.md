# Proliferate Self-Hosted Deployment

This directory contains the production deployment bundle for self-hosted Proliferate instances.

## Installation

### Quick Install (Recommended)

Download and extract the latest release using the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/proliferate-ai/proliferate/main/scripts/self-host/install.sh | sh
```

This will:
- Download the latest versioned release from GitHub
- Verify the checksum (if available)
- Extract to `./proliferate/`
- Display next steps

### Manual Installation

If you prefer to download manually:

1. Visit the [releases page](https://github.com/proliferate-ai/proliferate/releases)
2. Download the latest `proliferate-selfhost-<version>.tar.gz` tarball
3. Optionally download the matching `.sha256` file to verify integrity:
   ```bash
   shasum -a 256 -c proliferate-selfhost-<version>.tar.gz.sha256
   ```
4. Extract the tarball:
   ```bash
   mkdir proliferate
   tar xzf proliferate-selfhost-<version>.tar.gz -C proliferate --strip-components=1
   ```

## Configuration

After installation, configure your instance:

```bash
cd proliferate
cp .env.production.example .env.static
```

Edit `.env.static` with your settings. At minimum, set:

- `SITE_ADDRESS` - Your domain (e.g., `proliferate.corp.example.com`)
- `API_BASE_URL` - Full HTTPS URL (e.g., `https://proliferate.corp.example.com`)
- `PROLIFERATE_TELEMETRY_MODE=self_managed`
- `PROLIFERATE_SERVER_IMAGE_TAG` - Pin to a specific version or use `stable`

Secrets (`JWT_SECRET`, `CLOUD_SECRET_KEY`, `POSTGRES_PASSWORD`) are generated automatically by the bootstrap script.

## Bootstrap

Start your instance:

```bash
./bootstrap.sh
```

This will:
- Generate required secrets
- Start the Docker Compose stack (Caddy, PostgreSQL, API)
- Run database migrations
- Wait for health checks
- Print a setup token for first-run claim

## First-Run Claim

After bootstrap completes, visit the URL shown to claim your instance and create the admin account.

## Updating

To update to a new version:

```bash
# Edit .env.static to change PROLIFERATE_SERVER_IMAGE_TAG
./update.sh
```

## Additional Resources

- Full deployment documentation: https://docs.proliferate.com/deployment/self-hosted
- AWS CloudFormation template: `proliferate-self-hosted-aws-template.yaml` (included in releases)
- Runtime binaries for self-managed targets: `anyharness-{arch}.tar.gz` (included in releases)

## Files in This Bundle

- `bootstrap.sh` - First-time setup script
- `update.sh` - Update script for new versions
- `ensure-secrets.sh` - Secret generation and environment merging
- `install-runtime.sh` - Install runtime binaries on the host
- `wait-for-health.sh` - Health check polling script
- `docker-compose.production.yml` - Production Docker Compose configuration
- `Caddyfile` - Caddy reverse proxy and automatic HTTPS configuration
- `.env.production.example` - Environment variable template
- `VERSION` - Bundled version number

## Support

For issues and support: https://github.com/proliferate-ai/proliferate/issues
