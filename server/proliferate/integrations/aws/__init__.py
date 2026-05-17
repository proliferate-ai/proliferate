"""Public AWS integration API."""

from proliferate.integrations.aws.bedrock import validate_bedrock_assume_role_payload
from proliferate.integrations.aws.errors import AwsIntegrationError
from proliferate.integrations.aws.models import BedrockAssumeRoleValidation

__all__ = [
    "AwsIntegrationError",
    "BedrockAssumeRoleValidation",
    "validate_bedrock_assume_role_payload",
]
