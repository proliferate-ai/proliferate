"""First-run claim transport: the server-rendered /setup page.

Only mounted in single-org mode (see ``create_app``); hosted deployments never
expose these routes. Once any user exists the routes respond 404 permanently.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse

from proliferate.db.engine import AsyncSessionDep
from proliferate.server.setup import service
from proliferate.server.setup.errors import FirstRunSetupError
from proliferate.server.setup.pages import (
    render_setup_form,
    render_setup_not_found,
    render_setup_success,
)

router = APIRouter()


@router.get("/setup", response_class=HTMLResponse, include_in_schema=False)
async def first_run_setup_page(db: AsyncSessionDep) -> HTMLResponse:
    if not await service.is_setup_open(db):
        return HTMLResponse(render_setup_not_found(), status_code=404)
    return HTMLResponse(render_setup_form())


@router.post("/setup", response_class=HTMLResponse, include_in_schema=False)
async def first_run_setup_claim(
    db: AsyncSessionDep,
    email: Annotated[str, Form()] = "",
    password: Annotated[str, Form()] = "",
    setup_token: Annotated[str, Form()] = "",
) -> HTMLResponse:
    try:
        claim = await service.claim_first_run(
            db,
            email=email,
            password=password,
            setup_token=setup_token,
        )
    except FirstRunSetupError as error:
        if error.status_code == 404:
            return HTMLResponse(render_setup_not_found(), status_code=404)
        return HTMLResponse(
            render_setup_form(error=error.message, email=email),
            status_code=error.status_code,
        )
    return HTMLResponse(render_setup_success(claim.email))
