#!/bin/bash

set -euo pipefail

SECRET_ID="${SECRET_ID:-proliferate-env}"
SECRETS_FILE="${SECRETS_FILE:-secrets/prod.json}"
K8S_NAMESPACE="${K8S_NAMESPACE:-proliferate}"
K8S_SECRET_NAME="${K8S_SECRET_NAME:-proliferate-env}"
REFRESH_K8S="${REFRESH_K8S:-}"

if [ ! -f "$SECRETS_FILE" ]; then
	echo "Error: secrets file not found: $SECRETS_FILE"
	echo "Create it (e.g. secrets/prod.json) and try again."
	exit 1
fi

aws secretsmanager put-secret-value \
	--secret-id "$SECRET_ID" \
	--secret-string "file://$SECRETS_FILE"

if [ "$REFRESH_K8S" = "1" ] || [ "$REFRESH_K8S" = "true" ]; then
	kubectl -n "$K8S_NAMESPACE" delete secret "$K8S_SECRET_NAME"
fi
