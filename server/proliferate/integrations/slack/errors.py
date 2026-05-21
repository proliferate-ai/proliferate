class SlackWebhookError(RuntimeError):
    pass


class SlackApiError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "slack_api_error",
        status_code: int | None = None,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds
