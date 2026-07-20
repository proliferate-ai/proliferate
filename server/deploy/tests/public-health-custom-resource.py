#!/usr/bin/env python3

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch


def load_handler(path: Path):
    spec = importlib.util.spec_from_file_location("public_health_handler", path)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load extracted public-health handler")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Response:
    def __init__(self, status: int = 200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b""


def event(request_type: str, health_url: str = "https://public.test/health") -> dict:
    return {
        "RequestType": request_type,
        "ResponseURL": "https://response.test/callback",
        "StackId": "stack-id",
        "RequestId": "request-id",
        "LogicalResourceId": "ProliferatePublicHealth",
        "ResourceProperties": {"HealthUrl": health_url},
    }


def response_body(request) -> dict:
    return json.loads(request.data.decode("utf-8"))


def main() -> None:
    module = load_handler(Path(sys.argv[1]))

    requests = []
    health_attempts = 0

    def recover_after_cold_tls(request, timeout):
        nonlocal health_attempts
        requests.append(request)
        if request.full_url == "https://response.test/callback":
            return Response()
        health_attempts += 1
        if health_attempts < 3:
            raise OSError("synthetic TLS not ready")
        return Response(200)

    with patch.object(module.urllib.request, "urlopen", side_effect=recover_after_cold_tls), patch.object(
        module.time, "sleep", return_value=None
    ):
        module.handler(event("Create"), None)
    callback = requests[-1]
    assert callback.full_url == "https://response.test/callback"
    assert response_body(callback)["Status"] == "SUCCESS"
    assert health_attempts == 3

    requests.clear()
    with patch.object(module.urllib.request, "urlopen", side_effect=lambda request, timeout: (requests.append(request), Response())[1]):
        module.handler(event("Delete"), None)
    assert len(requests) == 1
    assert response_body(requests[0])["Status"] == "SUCCESS"

    requests.clear()
    with patch.object(module.urllib.request, "urlopen", side_effect=lambda request, timeout: (requests.append(request), Response())[1]):
        module.handler(event("Update", "http://private.test/health"), None)
    invalid = response_body(requests[0])
    assert invalid["Status"] == "FAILED"
    assert invalid["Reason"] == "Public health URL contract is invalid."
    assert "private.test" not in json.dumps(invalid)

    requests.clear()
    monotonic_values = iter([0, 421])

    def always_unhealthy(request, timeout):
        requests.append(request)
        if request.full_url == "https://response.test/callback":
            return Response()
        raise OSError("synthetic provider detail must not survive")

    with patch.object(module.urllib.request, "urlopen", side_effect=always_unhealthy), patch.object(
        module.time, "monotonic", side_effect=lambda: next(monotonic_values)
    ):
        module.handler(event("Update"), None)
    failed = response_body(requests[-1])
    assert failed["Status"] == "FAILED"
    assert failed["Reason"] == "Public HTTPS health did not become ready inside the bounded window."
    assert "provider detail" not in json.dumps(failed)


if __name__ == "__main__":
    main()
