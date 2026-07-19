# LiteLLM proxy image for the Proliferate agent gateway.
#
# Layers the checked-in gateway config onto the upstream LiteLLM image so the
# deployed ECS task runs the exact model list reviewed in this repo. Keep the
# official release tag and OCI index digest together: the digest makes builds
# reproducible while the tag keeps the reviewed upstream version visible.
#
# Build context: repo root (matches server/Dockerfile convention):
#   docker build -f server/litellm/Dockerfile .
FROM ghcr.io/berriai/litellm:v1.93.0@sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e

COPY server/litellm/config.yaml /app/proliferate-litellm-config.yaml

# Same entrypoint as upstream; pin the config and port.
CMD ["--config", "/app/proliferate-litellm-config.yaml", "--port", "4000"]
