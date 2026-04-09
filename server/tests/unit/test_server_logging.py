from __future__ import annotations

import logging

from proliferate.utils.logging import configure_server_logging


def _reset_logger(logger_name: str) -> logging.Logger:
    logger = logging.getLogger(logger_name)
    logger.handlers.clear()
    logger.setLevel(logging.NOTSET)
    logger.propagate = True
    if hasattr(logger, "_proliferate_configured"):
        delattr(logger, "_proliferate_configured")
    return logger


def test_configure_server_logging_reuses_uvicorn_error_handlers() -> None:
    app_logger = _reset_logger("proliferate")
    uvicorn_logger = _reset_logger("uvicorn.error")
    handler = logging.StreamHandler()
    uvicorn_logger.addHandler(handler)

    configure_server_logging()

    assert app_logger.level == logging.INFO
    assert app_logger.handlers == [handler]
    assert app_logger.propagate is False


def test_configure_server_logging_falls_back_to_stream_handler_without_uvicorn() -> None:
    app_logger = _reset_logger("proliferate")
    _reset_logger("uvicorn.error")

    configure_server_logging()

    assert app_logger.level == logging.INFO
    assert len(app_logger.handlers) == 1
    assert isinstance(app_logger.handlers[0], logging.StreamHandler)
    assert app_logger.propagate is False
