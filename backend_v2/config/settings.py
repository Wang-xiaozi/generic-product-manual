"""从 APP_ 环境变量、.env 和业务配置加载手册服务设置。"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent


def _load_env_file() -> dict[str, str]:
    """读取环境配置；返回键值映射。"""
    path = PROJECT_ROOT / ".env"
    if not path.is_file():
        path = BACKEND_ROOT / ".env.example"
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _path(value: str, fallback: Path) -> Path:
    """将配置路径解析为绝对路径；空值使用项目相对路径。"""
    return Path(value).expanduser().resolve() if value else fallback.resolve()


@dataclass(frozen=True)
class Settings:
    """保存环境设置与业务配置，供启动器及服务层读取。"""

    project_root: Path
    frontend_root: Path
    host: str
    web_port: int
    port: int
    connect_host: str
    startup_timeout: float
    proxy_timeout: float
    cors_origins: tuple[str, ...]
    debug: bool
    runner_python: Path
    pipeline_python: Path
    pipeline_script: Path
    output_root: Path
    ledit_exe: Path | None
    ledit_search_roots: tuple[Path, ...]
    force_refresh: bool
    use_bundled_vendor: bool
    llm_base_url: str
    llm_model: str
    llm_api_key: str
    llm_auth_type: str
    llm_temperature: float
    llm_max_tokens: int
    llm_timeout: int
    business: dict[str, Any]

    @classmethod
    def load(cls) -> Settings:
        """读取项目配置；返回完整设置对象。"""
        source = _load_env_file()

        def get(name: str) -> str:
            return os.environ.get(name, source.get(name, ""))

        def flag(name: str) -> bool:
            return get(name).lower() in {"1", "true", "yes", "on"}

        runner_python = Path(sys.executable).resolve()
        business = json.loads((BACKEND_ROOT / "config" / "config.yaml").read_text(encoding="utf-8"))
        return cls(
            project_root=PROJECT_ROOT,
            frontend_root=PROJECT_ROOT / "frontend_v2",
            host=get("APP_HOST"),
            web_port=int(get("APP_WEB_PORT")),
            port=int(get("APP_PORT")),
            connect_host=get("APP_CONNECT_HOST"),
            startup_timeout=float(get("APP_STARTUP_TIMEOUT")),
            proxy_timeout=float(get("APP_PROXY_TIMEOUT")),
            cors_origins=tuple(
                item.strip() for item in get("APP_CORS_ORIGINS").split(",") if item.strip()
            ),
            debug=flag("APP_DEBUG"),
            runner_python=runner_python,
            pipeline_python=_path(get("APP_PIPELINE_PYTHON"), runner_python),
            pipeline_script=_path(
                get("APP_PIPELINE_SCRIPT"),
                PROJECT_ROOT / "pipeline" / "prepare_manual_tool_assets_from_ledit.py",
            ),
            output_root=_path(get("APP_OUTPUT_ROOT"), PROJECT_ROOT / "generated_layout_assets"),
            ledit_exe=_path(get("APP_LEDIT_EXE"), PROJECT_ROOT) if get("APP_LEDIT_EXE") else None,
            ledit_search_roots=tuple(
                Path(item).expanduser()
                for item in get("APP_LEDIT_SEARCH_ROOTS").split(";")
                if item.strip()
            ),
            force_refresh=flag("APP_FORCE_REFRESH"),
            use_bundled_vendor=flag("APP_USE_BUNDLED_VENDOR"),
            llm_base_url=get("APP_LLM_BASE_URL"),
            llm_model=get("APP_LLM_MODEL"),
            llm_api_key=get("APP_LLM_API_KEY"),
            llm_auth_type=get("APP_LLM_AUTH_TYPE"),
            llm_temperature=float(get("APP_LLM_TEMPERATURE")),
            llm_max_tokens=int(get("APP_LLM_MAX_TOKENS")),
            llm_timeout=int(get("APP_LLM_TIMEOUT")),
            business=business,
        )


settings = Settings.load()
