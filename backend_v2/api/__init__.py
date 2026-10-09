"""递归发现、初始化并注册所有定义 router 的功能模块。"""

from __future__ import annotations

import importlib
import pkgutil

from fastapi import FastAPI
from fastapi.routing import APIRouter


def register_routers(app: FastAPI) -> None:
    """扫描 API 包并执行可选功能初始化；将路由挂载到 /api。"""
    modules = sorted(
        pkgutil.walk_packages(__path__, prefix=f"{__name__}."), key=lambda item: item.name
    )
    for module_info in modules:
        if module_info.ispkg:
            continue
        module = importlib.import_module(module_info.name)
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            setup_feature = getattr(module, "setup_feature", None)
            if callable(setup_feature):
                setup_feature(app)
            app.include_router(router, prefix="/api")
