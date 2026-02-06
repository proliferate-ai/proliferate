#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")

STATE_BUCKET="${PULUMI_STATE_BUCKET:-proliferate-pulumi-${ACCOUNT_ID}-${REGION}}"
LOCK_TABLE="${PULUMI_LOCK_TABLE:-pulumi-locks-${ACCOUNT_ID}-${REGION}}"
STATE_PREFIX="${PULUMI_STATE_PREFIX:-prod}"

if ! aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
	if [ "$REGION" = "us-east-1" ]; then
		aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION"
	else
		aws s3api create-bucket --bucket "$STATE_BUCKET" --region "$REGION" \
			--create-bucket-configuration LocationConstraint="$REGION"
	fi

	aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" \
		--versioning-configuration Status=Enabled
	aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
		--server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
	aws s3api put-public-access-block --bucket "$STATE_BUCKET" \
		--public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

if ! aws dynamodb describe-table --table-name "$LOCK_TABLE" --region "$REGION" >/dev/null 2>&1; then
	aws dynamodb create-table \
		--table-name "$LOCK_TABLE" \
		--attribute-definitions AttributeName=LockID,AttributeType=S \
		--key-schema AttributeName=LockID,KeyType=HASH \
		--billing-mode PAY_PER_REQUEST \
		--region "$REGION" >/dev/null
	aws dynamodb wait table-exists --table-name "$LOCK_TABLE" --region "$REGION"
fi

echo "Pulumi backend ready."
echo "Run: pulumi login 's3://${STATE_BUCKET}/${STATE_PREFIX}?region=${REGION}&dynamodb_table=${LOCK_TABLE}'"
