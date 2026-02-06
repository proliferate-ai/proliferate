#!/bin/bash

set -euo pipefail

PARAM_NAME="${SSM_PARAM_NAME:-/proliferate/last-good-sha}"
SHA="${1:-${SHA:-}}"

if [ -z "$SHA" ]; then
	echo "Usage: ./scripts/set-last-good-sha.sh <sha>"
	echo "Or set SHA=..."
	exit 1
fi

aws ssm put-parameter \
	--name "$PARAM_NAME" \
	--value "$SHA" \
	--type String \
	--overwrite
