"""统一成功响应信封。"""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Result(BaseModel, Generic[T]):
    """承载接口状态与原有业务数据。"""

    code: int
    msg: str
    data: T

    @classmethod
    def success(cls, data: T, msg: str = "ok") -> Result[T]:
        """包装成功数据；返回 code 为零的信封。"""
        return cls(code=0, msg=msg, data=data)
