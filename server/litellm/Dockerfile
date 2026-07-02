# LiteLLM proxy image for the Proliferate agent gateway.
#
# Layers the checked-in gateway config onto the upstream LiteLLM image so the
# deployed ECS task runs the exact model list reviewed in this repo.
#
# Build context: repo root (matches server/Dockerfile convention):
#   docker build -f server/litellm/Dockerfile .
FROM ghcr.io/berriai/litellm:main-stable

COPY server/litellm/config.yaml /app/proliferate-litellm-config.yaml

# Same entrypoint as upstream; pin the config and port.
CMD ["--config", "/app/proliferate-litellm-config.yaml", "--port", "4000"]
