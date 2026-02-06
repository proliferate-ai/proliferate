# LLM Proxy - LiteLLM with JWT Auth
#
# Uses LiteLLM directly with built-in JWT authentication.
# No custom wrapper needed - all auth and spend tracking is handled by LiteLLM.

FROM ghcr.io/berriai/litellm:main-latest

WORKDIR /app

# Copy config only - no callbacks needed!
COPY litellm/config.yaml /app/config.yaml

EXPOSE 4000

CMD ["--config", "/app/config.yaml", "--port", "4000"]