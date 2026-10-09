"""统一业务异常与参数校验异常。"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

LOGGER = logging.getLogger(__name__)


class CustomException(Exception):
    """保存业务错误说明、业务码及真实 HTTP 状态。"""

    def __init__(self, msg: str, code: int = 400, http_status: int = 400) -> None:
        """构造业务异常；参数依次是说明、业务码和 HTTP 状态。"""
        super().__init__(msg)
        self.msg = msg
        self.code = code
        self.http_status = http_status


def install_exception_handlers(app: FastAPI) -> None:
    """为应用安装异常处理器；不返回值。"""

    @app.exception_handler(CustomException)
    async def handle_custom(_request: Request, exc: CustomException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"code": exc.code, "msg": exc.msg, "data": None},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"code": 422, "msg": "请求参数错误", "data": None},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        LOGGER.error("未处理的服务异常", exc_info=(type(exc), exc, exc.__traceback__))
        return JSONResponse(
            status_code=500,
            content={"code": 500, "msg": "服务器内部错误", "data": None},
        )
