#!/usr/bin/env python
"""一键启动契约化的 FastAPI 与离线 Vue 页面。"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import replace
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT / "backend_v2"))

from config.settings import Settings, settings  # noqa: E402
from main import create_app  # noqa: E402


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """解析兼容命令行参数；返回启动选项。"""
    parser = argparse.ArgumentParser(description="Pre-installed Manual 离线整合包")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--web-port", type=int, default=settings.web_port)
    parser.add_argument("--api-port", "--bridge-port", dest="api_port", type=int,
                        default=settings.port)
    parser.add_argument("--ledit-exe", type=Path, default=settings.ledit_exe)
    parser.add_argument("--output-root", type=Path, default=settings.output_root)
    parser.add_argument("--pipeline-python", type=Path, default=settings.pipeline_python)
    parser.add_argument("--llm-base-url", default=settings.llm_base_url)
    parser.add_argument("--llm-model", default=settings.llm_model)
    parser.add_argument("--llm-api-key", default=settings.llm_api_key)
    parser.add_argument("--llm-auth-type", default=settings.llm_auth_type)
    parser.add_argument("--llm-timeout", type=int, default=settings.llm_timeout)
    parser.add_argument("--llm-max-tokens", type=int, default=settings.llm_max_tokens)
    parser.add_argument("--llm-temperature", type=float, default=settings.llm_temperature)
    parser.add_argument("--force-refresh", action="store_true", default=settings.force_refresh)
    parser.add_argument("--use-bundled-vendor", action="store_true",
                        default=settings.use_bundled_vendor)
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args(argv)


def _ledit_candidate(path: Path) -> Path | None:
    """在给定安装目录下寻找 L-Edit；返回程序路径或空值。"""
    if path.is_file():
        return path.resolve()
    if not path.is_dir():
        return None
    for name in ("ledit64.exe", "ledit.exe", "ledit32.exe"):
        direct = path / name
        if direct.is_file():
            return direct.resolve()
    for name in ("ledit64.exe", "ledit.exe", "ledit32.exe"):
        for match in sorted(path.rglob(name)):
            if len(match.relative_to(path).parts) <= 6 and match.is_file():
                return match.resolve()
    return None


def find_ledit_executable(explicit: Path | None, config: Settings) -> Path | None:
    """按用户路径与配置的搜索目录寻找 L-Edit；返回程序路径。"""
    if explicit is not None:
        result = _ledit_candidate(explicit.expanduser())
        if result is None:
            raise SystemExit(f"[ERROR] 未找到 L-Edit：{explicit}")
        return result
    roots = list(config.ledit_search_roots)
    for key in ("ProgramFiles(x86)", "ProgramFiles"):
        value = os.environ.get(key)
        if value:
            roots.append(Path(value) / "Tanner EDA")
    for root in roots:
        result = _ledit_candidate(root)
        if result is not None:
            return result
    return None


def configure(args: argparse.Namespace) -> Settings:
    """合并环境设置与命令行覆盖；返回本次运行配置。"""
    if args.use_bundled_vendor and sys.version_info[:2] != (3, 12):
        raise SystemExit("[ERROR] 内置 vendor 仅供 Python 3.12 历史环境使用")
    dist_root = settings.frontend_root / "dist"
    if not (dist_root / "index.html").is_file():
        raise SystemExit("[ERROR] 缺少 frontend_v2/dist，请先构建前端")
    if not settings.pipeline_script.is_file():
        raise SystemExit("[ERROR] 缺少版图生成 pipeline")
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    ledit_exe = find_ledit_executable(args.ledit_exe, settings)
    os.environ["LAYOUT_USE_BUNDLED_VENDOR"] = "1" if args.use_bundled_vendor else "0"
    origins = set(settings.cors_origins)
    origins.add(f"http://{args.host}:{args.web_port}")
    origins.add(f"http://{settings.connect_host}:{args.web_port}")
    return replace(
        settings,
        host=args.host,
        web_port=args.web_port,
        port=args.api_port,
        cors_origins=tuple(sorted(origins)),
        pipeline_python=args.pipeline_python.resolve(),
        output_root=output_root,
        ledit_exe=ledit_exe,
        force_refresh=args.force_refresh,
        use_bundled_vendor=args.use_bundled_vendor,
        llm_base_url=args.llm_base_url,
        llm_model=args.llm_model,
        llm_api_key=args.llm_api_key,
        llm_auth_type=args.llm_auth_type,
        llm_timeout=args.llm_timeout,
        llm_max_tokens=args.llm_max_tokens,
        llm_temperature=args.llm_temperature,
    )


def _wait_for_port(host: str, port: int, timeout: float) -> bool:
    """等待 API 监听；返回是否成功。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def run(args: argparse.Namespace) -> None:
    """启动 API 和静态页面服务；结束时一并退出。"""
    config = configure(args)
    try:
        import uvicorn
    except ImportError as exc:
        raise SystemExit("[ERROR] 请先安装 requirements.txt") from exc

    api = uvicorn.Server(uvicorn.Config(create_app(config), host=config.host,
                                        port=config.port, log_level="info"))
    api_thread = threading.Thread(target=api.run, name="manual-fastapi", daemon=True)
    api_thread.start()
    if not _wait_for_port(config.connect_host, config.port, config.startup_timeout):
        api.should_exit = True
        raise SystemExit(f"[ERROR] FastAPI 未能在端口 {config.port} 启动")

    dist_root = config.frontend_root / "dist"
    api_base_url = f"http://{config.connect_host}:{config.port}"

    class FrontendHandler(SimpleHTTPRequestHandler):
        """提供构建后的页面，并将 /api 请求转发到 FastAPI。"""

        def __init__(self, *handler_args: object, **handler_kwargs: object) -> None:
            super().__init__(*handler_args, directory=str(dist_root), **handler_kwargs)

        def _proxy(self) -> None:
            request_length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(request_length) if request_length else None
            upstream = urllib.request.Request(
                api_base_url + self.path,
                data=body,
                headers={"Content-Type": self.headers.get("Content-Type", "")},
                method=self.command,
            )
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                response = opener.open(upstream, timeout=config.proxy_timeout)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                content = response.read()
                self.send_response(response.status)
                content_type = response.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        def do_GET(self) -> None:  # noqa: N802
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                self._proxy()
                return
            if path == "/config.js":
                content = (config.frontend_root / "public" / "config.js").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return
            if path != "/" and not (dist_root / path.lstrip("/")).is_file():
                self.path = "/index.html"
            super().do_GET()

        def do_POST(self) -> None:  # noqa: N802
            self._proxy()

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._proxy()

    frontend_url = f"http://{config.connect_host}:{config.web_port}/product-manual"
    print(f"[INFO] Frontend: {frontend_url}")
    print(f"[INFO] FastAPI: {api_base_url}/docs")
    print(f"[INFO] L-Edit: {config.ledit_exe or '未找到（仅版图生成受影响）'}")
    frontend = ThreadingHTTPServer((config.host, config.web_port), FrontendHandler)
    try:
        if not args.no_browser:
            webbrowser.open(frontend_url)
        frontend.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] 已停止")
    finally:
        frontend.server_close()
        api.should_exit = True
        api_thread.join(timeout=config.startup_timeout)


def main(argv: list[str] | None = None) -> None:
    """运行命令行启动器；不返回值。"""
    run(parse_args(argv))


if __name__ == "__main__":
    main()
