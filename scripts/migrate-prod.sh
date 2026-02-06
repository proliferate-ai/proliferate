#!/bin/bash
# Run migrations against production database
# Usage: ./scripts/migrate-prod.sh [migration-file]

set -e

# Load production env vars
if [ -f .env.prod ]; then
  source .env.prod
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not found. Make sure .env.prod exists."
  exit 1
fi

# If specific migration file provided, run it
if [ -n "$1" ]; then
  echo "Running migration: $1"
  psql "$DATABASE_URL" -f "$1"
  echo "Migration complete!"
else
  # Otherwise, show available migrations
  echo "Available migrations:"
  ls -la packages/db/drizzle/
  echo ""
  echo "Usage: ./scripts/migrate-prod.sh packages/db/drizzle/XXX_migration.sql"
fi
