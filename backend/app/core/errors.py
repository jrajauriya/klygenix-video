from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import psycopg
from psycopg import errors as pg
from sqlalchemy.exc import DataError

CLIENT_VALUE_ERRORS = (pg.NumericValueOutOfRange, pg.StringDataRightTruncation, pg.InvalidTextRepresentation,
                       pg.InvalidDatetimeFormat, pg.DatetimeFieldOverflow)


async def data_error(request: Request, exc: DataError):
    orig = exc.orig
    if isinstance(orig, CLIENT_VALUE_ERRORS) or (isinstance(orig, psycopg.DataError) and orig.sqlstate is None):
        return JSONResponse(status_code=422, content={"detail": "A value in the request is out of range or not valid."})
    raise exc


def install(app: FastAPI) -> None:
    app.add_exception_handler(DataError, data_error)
