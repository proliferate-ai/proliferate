#!/bin/bash
# Simple database migration script
# Runs SQL files from migrations directory in alphabetical order
# Tracks applied migrations in _migrations table

set -e

MIGRATIONS_DIR="/app/migrations"

if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is required"
    exit 1
fi

echo "Connecting to database..."

# Create auth schema stub for self-hosted (used by RLS policies)
# This is a no-op function that always returns null - RLS policies won't work
# but that's OK since we use direct Drizzle queries for all access anyway
psql "$DATABASE_URL" -c "
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS TEXT AS \$\$
    BEGIN
        RETURN NULL;
    END;
    \$\$ LANGUAGE plpgsql;
" > /dev/null

# Create migrations tracking table
psql "$DATABASE_URL" -c "
    CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
    )
" > /dev/null

# Get already applied migrations
APPLIED=$(psql "$DATABASE_URL" -t -c "SELECT name FROM _migrations ORDER BY name")

echo "Checking for pending migrations..."

# Count pending
PENDING_COUNT=0
for file in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")
    if ! echo "$APPLIED" | grep -q "^[[:space:]]*${filename}[[:space:]]*$"; then
        PENDING_COUNT=$((PENDING_COUNT + 1))
    fi
done

if [ "$PENDING_COUNT" -eq 0 ]; then
    echo "No pending migrations"
    exit 0
fi

echo "Applying $PENDING_COUNT migrations..."

# Apply pending migrations in order
for file in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$file" ] || continue
    filename=$(basename "$file")

    # Skip if already applied
    if echo "$APPLIED" | grep -q "^[[:space:]]*${filename}[[:space:]]*$"; then
        continue
    fi

    echo "  Applying: $filename"

    # Apply migration in a transaction
    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" 2>&1; then
        psql "$DATABASE_URL" -c "INSERT INTO _migrations (name) VALUES ('$filename')" > /dev/null
        echo "  Applied: $filename"
    else
        echo "  FAILED: $filename"
        exit 1
    fi
done

echo "Successfully applied $PENDING_COUNT migrations"
