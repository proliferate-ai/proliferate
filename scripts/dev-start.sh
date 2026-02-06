#!/bin/bash
# Start local development environment with LLM proxy exposed via ngrok
#
# Prerequisites:
#   - Docker installed
#   - ngrok CLI installed and authenticated
#   - .env.local with ANTHROPIC_API_KEY
#
# Usage:
#   ./scripts/dev-start.sh

set -e

echo "🚀 Starting Proliferate local development environment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed. Install from https://ngrok.com/download"
    exit 1
fi

# Load environment
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ ANTHROPIC_API_KEY not set. Add it to .env.local"
    exit 1
fi

# Start Docker services
echo -e "${YELLOW}Starting Docker services...${NC}"
docker compose up -d postgres redis

# Wait for postgres
echo -e "${YELLOW}Waiting for PostgreSQL...${NC}"
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 1
done

# Run migrations
echo -e "${YELLOW}Running migrations...${NC}"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@127.0.0.1:5432/proliferate" pnpm -C packages/db db:migrate

# Start LLM proxy
echo -e "${YELLOW}Starting LLM proxy...${NC}"
docker compose up -d llm-proxy

# Wait for LLM proxy
echo -e "${YELLOW}Waiting for LLM proxy to be ready...${NC}"
until curl -sf http://localhost:4000/health/liveliness > /dev/null 2>&1; do
    sleep 2
done

# Start ngrok tunnel to LLM proxy
echo -e "${YELLOW}Starting ngrok tunnel to LLM proxy...${NC}"
ngrok http 4000 > /dev/null 2>&1 &
NGROK_PID=$!
sleep 3

# Export the URL for other services
NGROK_API_URL="http://127.0.0.1:4040/api/tunnels"
LLM_PROXY_PUBLIC_URL="$(curl -sf "$NGROK_API_URL" | python3 - <<'PY'
import json
import sys

data = json.load(sys.stdin)
for tunnel in data.get("tunnels", []):
	url = tunnel.get("public_url", "")
	if url.startswith("https://"):
		print(url)
		break
PY
)"

if [ -z "$LLM_PROXY_PUBLIC_URL" ]; then
	echo "❌ Could not determine ngrok public URL. Is ngrok running (and is its local API on :4040 reachable)?"
	exit 1
fi

export LLM_PROXY_URL="$LLM_PROXY_PUBLIC_URL"

echo ""
echo -e "${GREEN}✅ Local development environment ready!${NC}"
echo ""
echo "Services:"
echo "  - PostgreSQL:  localhost:5432"
echo "  - Redis:       localhost:6379"
echo "  - LLM Proxy:   localhost:4000"
echo "  - LLM Proxy (ngrok): $LLM_PROXY_URL"
echo ""
echo "To start the web app:"
echo "  LLM_PROXY_URL=$LLM_PROXY_URL pnpm dev"
echo ""
echo "To stop everything:"
echo "  docker compose down && kill $NGROK_PID"
echo ""
