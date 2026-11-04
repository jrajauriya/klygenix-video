from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import psycopg
from psycopg import errors as pg
from sqlalchemy.exc import DataError
from starlette.exceptions import HTTPException as StarletteHTTPException

CLIENT_VALUE_ERRORS = (pg.NumericValueOutOfRange, pg.StringDataRightTruncation, pg.InvalidTextRepresentation,
                       pg.InvalidDatetimeFormat, pg.DatetimeFieldOverflow)


async def data_error(request: Request, exc: DataError):
    orig = exc.orig
    if isinstance(orig, CLIENT_VALUE_ERRORS) or (isinstance(orig, psycopg.DataError) and orig.sqlstate is None):
        return JSONResponse(status_code=422, content={"detail": "A value in the request is out of range or not valid."})
    raise exc


async def http_error(request: Request, exc: StarletteHTTPException):
    from fastapi.exception_handlers import http_exception_handler

    response = await http_exception_handler(request, exc)
    code = (exc.headers or {}).get("X-Error-Code")
    if code and isinstance(response, JSONResponse):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": code}, headers=exc.headers)
    return response


def install(app: FastAPI) -> None:
    app.add_exception_handler(DataError, data_error)
    app.add_exception_handler(StarletteHTTPException, http_error)
