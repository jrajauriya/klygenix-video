"""Hand the rate-limit budget back on every keyed response.

The counter is claimed inside `get_current_user`, which cannot set response headers — a
dependency has no response to write to. This reads what it left on the request and puts it
on the way out, so an integrator can pace itself rather than discovering the cap by being
refused.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class RateLimitHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        budget = getattr(request.state, "rate_limit", None)
        if budget is not None:
            limit, remaining, reset = budget
            response.headers["X-RateLimit-Limit"] = str(limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(reset)
        return response
