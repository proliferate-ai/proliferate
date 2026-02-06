#!/bin/bash
# Connect to Postgres database
# Usage: ./scripts/db.sh
#
# Requires DATABASE_URL environment variable or .env.local file

# Load .env.local if it exists
if [ -f .env.local ]; then
  export $(grep -E '^DATABASE_URL=' .env.local | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set"
  echo "Set DATABASE_URL in your environment or .env.local"
  exit 1
fi

psql "$DATABASE_URL"
