"""Public AWS integration API."""

from proliferate.integrations.aws.errors import AwsIntegrationError
from proliferate.integrations.aws.s3 import (
    get_json_object,
    head_object,
    presign_put_object,
    put_json_object,
)

__all__ = [
    "AwsIntegrationError",
    "get_json_object",
    "head_object",
    "presign_put_object",
    "put_json_object",
]
