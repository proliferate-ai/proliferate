"""
Proliferate Modal Sandbox - Minimal Deploy Script

This builds the sandbox image and exposes a helper endpoint for the TypeScript provider.
All sandbox business logic is in packages/shared/src/sandbox/*.

Deploy: modal deploy deploy.py
"""

import os
from pathlib import Path

import modal

# Support per-developer deployments via MODAL_APP_SUFFIX env var
app_suffix = os.environ.get("MODAL_APP_SUFFIX", "")
app_name = f"proliferate-sandbox-{app_suffix}" if app_suffix else "proliferate-sandbox"

app = modal.App(app_name)

# Build image from Dockerfile
dockerfile_path = Path(__file__).parent / "Dockerfile"
BASE_IMAGE = modal.Image.from_dockerfile(dockerfile_path, force_build=True)


@app.function(image=BASE_IMAGE)
@modal.fastapi_endpoint(method="GET")
def get_image_id():
    """Return the base image ID for the TypeScript provider.

    The TS provider calls this once at startup to get the image ID,
    then uses it to create sandboxes via the Modal JS SDK.
    """
    # When this function runs, the image is hydrated and has an object_id
    return {"image_id": BASE_IMAGE.object_id}


@app.function(image=BASE_IMAGE)
@modal.fastapi_endpoint(method="GET")
def health():
    """Health check endpoint."""
    return {"status": "ok", "app": app_name}
