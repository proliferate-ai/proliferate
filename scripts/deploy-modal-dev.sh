#!/bin/bash
#
# Deploy Modal sandbox for development/testing
#
# Usage:
#   ./scripts/deploy-modal-dev.sh [suffix]
#
# Examples:
#   ./scripts/deploy-modal-dev.sh         # Uses your username as suffix
#   ./scripts/deploy-modal-dev.sh pablo   # Deploys as proliferate-sandbox-pablo
#
# After deployment, add to .env.local:
#   MODAL_APP_SUFFIX={suffix}
#
# Requirements:
#   - Modal CLI installed and authenticated

set -e

# Get suffix (default to username)
SUFFIX="${1:-$(whoami)}"

echo "======================================"
echo "Deploying Modal Sandbox"
echo "======================================"
echo ""
echo "Suffix: $SUFFIX"
echo "App name: proliferate-sandbox-$SUFFIX"
echo ""

# Change to modal-sandbox directory
cd "$(dirname "$0")/../packages/modal-sandbox"

# Set environment variables for deployment
export MODAL_APP_SUFFIX="$SUFFIX"

# Deploy
echo "Running: modal deploy deploy.py"
echo ""
modal deploy deploy.py

echo ""
echo "======================================"
echo "Deployment complete!"
echo "======================================"
echo ""
echo "Your Modal app is now deployed."
echo "The public URL depends on your Modal workspace."
echo "Find it in the output above or in the Modal dashboard."
echo ""
echo "To use this Modal instance, add to your .env.local:"
echo ""
echo "  MODAL_APP_SUFFIX=${SUFFIX}"
echo ""
echo "Health check (replace <MODAL_APP_URL>):"
echo "  curl <MODAL_APP_URL>/health"
echo ""
