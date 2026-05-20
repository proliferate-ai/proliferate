"""AWS Bedrock credential validation helpers."""

from __future__ import annotations

import re

from proliferate.integrations.aws.errors import AwsIntegrationError
from proliferate.integrations.aws.models import BedrockAssumeRoleValidation

_ROLE_ARN_RE = re.compile(
    r"^arn:(?P<partition>aws|aws-us-gov|aws-cn):iam::(?P<account_id>\d{12}):role\/[A-Za-z0-9+=,.@_\-/]+$"
)
_REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-\d$")


def validate_bedrock_assume_role_payload(
    *,
    role_arn: str,
    external_id: str,
    region: str,
) -> BedrockAssumeRoleValidation:
    """Validate the V1 Bedrock role payload without performing network I/O.

    Phase 1 stores and validates provider credential shape. The live STS assume-role
    check belongs to deploy-time operator setup once server AWS credentials exist.
    """

    role_arn = role_arn.strip()
    external_id = external_id.strip()
    region = region.strip()
    match = _ROLE_ARN_RE.match(role_arn)
    if match is None:
        raise AwsIntegrationError(
            "Bedrock role ARN must be an IAM role ARN.", code="invalid_role_arn"
        )
    if not external_id:
        raise AwsIntegrationError("Bedrock external ID is required.", code="missing_external_id")
    if not _REGION_RE.match(region):
        raise AwsIntegrationError("Bedrock region is invalid.", code="invalid_region")
    return BedrockAssumeRoleValidation(
        role_arn=role_arn,
        region=region,
        external_id=external_id,
        account_id=match.group("account_id"),
    )
