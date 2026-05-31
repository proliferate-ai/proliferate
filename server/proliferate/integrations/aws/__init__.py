"""Public AWS integration API."""

from proliferate.integrations.aws.bedrock import validate_bedrock_assume_role_payload
from proliferate.integrations.aws.errors import AwsIntegrationError
from proliferate.integrations.aws.models import BedrockAssumeRoleValidation
from proliferate.integrations.aws.s3 import (
    get_json_object,
    head_object,
    presign_put_object,
    put_json_object,
)

__all__ = [
    "AwsIntegrationError",
    "BedrockAssumeRoleValidation",
    "get_json_object",
    "head_object",
    "presign_put_object",
    "put_json_object",
    "validate_bedrock_assume_role_payload",
]
