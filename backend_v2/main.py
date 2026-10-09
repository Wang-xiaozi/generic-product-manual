"""创建 FastAPI 应用并加载自动发现的功能路由。"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import register_routers
from common.exception_handler import install_exception_handlers
from config.settings import Settings, settings


def create_app(config: Settings | None = None) -> FastAPI:
    """创建配置化应用；返回 FastAPI 实例。"""
    resolved = config or settings
    app = FastAPI(title="Pre-installed Manual API", version="2.0.0", debug=resolved.debug)
    app.state.settings = resolved
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    install_exception_handlers(app)
    register_routers(app)
    return app


app = create_app()
