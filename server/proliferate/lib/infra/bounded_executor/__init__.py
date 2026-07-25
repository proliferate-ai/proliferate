"""Cancellation-safe bounded admission for blocking callables.

``ThreadPoolExecutor`` has an unbounded submission queue. This wrapper admits at
most ``max_workers`` callables total, fails closed instead of queueing beyond
that bound, and retains a slot until the underlying callable has actually
finished. Cancelling an awaiting coroutine therefore does not create hidden
unbounded work behind the event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import Future as ConcurrentFuture
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from threading import BoundedSemaphore, Event
from typing import ParamSpec, TypeVar

_P = ParamSpec("_P")
_R = TypeVar("_R")


class BoundedExecutorCapacityError(RuntimeError):
    """Raised before submission when every bounded worker slot is occupied."""


def _observe_async_completion(future: asyncio.Future[object]) -> None:
    """Retrieve detached failures after caller cancellation.

    ``run`` shields the completion future so cancellation cannot release the
    worker slot early. If the caller goes away, this callback still retrieves a
    later exception and prevents an unobserved-future warning.
    """

    if not future.cancelled():
        future.exception()


class BoundedExecutor:
    """A dedicated thread pool with a hard running-plus-queued work bound."""

    def __init__(self, *, max_workers: int, thread_name_prefix: str) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be positive")
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix=thread_name_prefix,
        )
        # Admission equals worker count: no user work can accumulate in the
        # executor's otherwise-unbounded queue.
        self._slots = BoundedSemaphore(max_workers)

    async def run(
        self,
        callback: Callable[_P, _R],
        /,
        *args: _P.args,
        **kwargs: _P.kwargs,
    ) -> _R:
        if not self._slots.acquire(blocking=False):
            raise BoundedExecutorCapacityError("bounded executor is at capacity")

        loop = asyncio.get_running_loop()
        completion: asyncio.Future[_R] = loop.create_future()
        completion.add_done_callback(_observe_async_completion)
        waiter_detached = Event()
        try:
            submitted = self._executor.submit(callback, *args, **kwargs)
        except BaseException:
            self._slots.release()
            raise

        def finish(source: ConcurrentFuture[_R]) -> None:
            value: _R | None = None
            error: BaseException | None = None
            try:
                value = source.result()
            except BaseException as caught:
                # ``source.result`` observes the concurrent future's exception;
                # only this safe scalar reference crosses back to the event loop.
                error = caught

            def deliver() -> None:
                if completion.done():
                    return
                if waiter_detached.is_set():
                    # The underlying concurrent exception was already observed
                    # by ``source.result``. Do not install it on an orphaned
                    # asyncio Future after the waiter has been cancelled.
                    completion.cancel()
                    return
                if error is not None:
                    completion.set_exception(error)
                else:
                    completion.set_result(value)  # type: ignore[arg-type]

            # The callable is now finished, so admission may reopen even if the
            # original waiter was cancelled. Never release on coroutine cancel.
            self._slots.release()
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(deliver)

        submitted.add_done_callback(finish)
        # Shield only the completion future. Cancelling the caller remains
        # prompt, while the slot stays owned until ``finish`` runs.
        try:
            return await asyncio.shield(completion)
        except asyncio.CancelledError:
            waiter_detached.set()
            if completion.done() and not completion.cancelled():
                completion.exception()
            raise

    def shutdown(self, *, wait: bool = True) -> None:
        """Stop test/injected pools without cancelling admitted work."""

        self._executor.shutdown(wait=wait, cancel_futures=False)


__all__ = ["BoundedExecutor", "BoundedExecutorCapacityError"]
