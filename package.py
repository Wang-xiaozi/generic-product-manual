"""检查必备文件并生成带预构建网页的通用版公开发布包。"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
REQUIRED = (
    "run.py",
    "requirements.txt",
    "backend_v2/main.py",
    "backend_v2/api/product_manual/product_manual_api.py",
    "backend_v2/services/product_manual/product_manual_service.py",
    "backend_v2/models/product_manual_schemas.py",
    "backend_v2/config/config.yaml",
    "backend_v2/.env.example",
    "backend_v2/templates/数据指标模板.xlsx",
    "frontend_v2/dist/index.html",
    "frontend_v2/public/config.js",
    "pipeline/prepare_manual_tool_assets_from_ledit.py",
)
SKIP_DIRS = {".git", "__pycache__", ".pytest_cache", ".ruff_cache", ".venv", "node_modules",
             "generated_layout_assets", "offline_environment", "local_backups", ".npm", ".codex-tmp"}


def should_include(path: Path) -> bool:
    """判断文件是否属于交付包；返回布尔值。"""
    relative = path.relative_to(PROJECT_ROOT)
    if any(part in SKIP_DIRS for part in relative.parts):
        return False
    if relative.parts[:2] in {("pipeline", "vendor"), ("tools", "ledit")}:
        return False
    if relative.name.startswith(".env.") and relative.name not in {
        ".env.example", ".env.development", ".env.production"
    }:
        return False
    if relative.suffix.lower() in {".zip", ".7z", ".log", ".pem", ".key", ".exe", ".dll", ".tdb"}:
        return False
    if relative.name in {".env", "ui-smoke.png"} or relative.suffix in {".pyc", ".pyo"}:
        return False
    return True


def package(output: Path) -> tuple[int, int]:
    """生成归档；返回文件数及归档字节数。"""
    missing = [name for name in REQUIRED if not (PROJECT_ROOT / name).is_file()]
    if missing:
        raise SystemExit("缺少交付文件：" + "、".join(missing))
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Prune ignored directories before walking: Windows dependency junctions can be cyclic.
    import os
    files = []
    for folder, dirs, names in os.walk(PROJECT_ROOT, followlinks=False):
        dirs[:] = [name for name in dirs if should_include(Path(folder) / name)
                   and not (Path(folder) / name).is_junction()
                   and not (Path(folder) / name).is_symlink()]
        files.extend(path for name in names if (path := Path(folder) / name).is_file()
                     and should_include(path) and path.resolve() != output)
    files.sort()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=True) as archive:
        for path in files:
            archive.write(path, f"{PROJECT_ROOT.name}/{path.relative_to(PROJECT_ROOT).as_posix()}")
    with zipfile.ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise SystemExit(f"归档校验失败：{bad}")
    return len(files), output.stat().st_size


def main() -> None:
    """读取目标路径并生成压缩包；不返回值。"""
    parser = argparse.ArgumentParser(description="打包通用手册公开发布版")
    parser.add_argument("output", nargs="?", type=Path,
                        default=PROJECT_ROOT.parent / f"{PROJECT_ROOT.name}.zip")
    args = parser.parse_args()
    count, size = package(args.output)
    print(f"已生成：{args.output.resolve()}（{count} 个文件，{size / 1024 / 1024:.1f} MB）")


if __name__ == "__main__":
    main()
