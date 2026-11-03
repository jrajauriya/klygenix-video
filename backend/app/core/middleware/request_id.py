"""Assign a request id, and hand it back on the response."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging_config import set_request_id
from app.core.services import error_tracking

HEADER = "X-Request-Id"


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Honour an upstream id so a trace survives nginx and any caller that sets one.
        rid = set_request_id(request.headers.get(HEADER))
        request.state.request_id = rid
        error_tracking.begin_request()
        error_tracking.tag("request_id", rid)
        response = await call_next(request)
        response.headers[HEADER] = rid
        return response
