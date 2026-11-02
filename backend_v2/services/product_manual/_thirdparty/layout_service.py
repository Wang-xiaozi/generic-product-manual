from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from config.process_nodes import (
    ProcessConfigError,
    load_process_config,
    select_process_node,
)
from config.settings import Settings as ApplicationSettings


class LayoutServiceError(Exception):
    def __init__(self, message: str, *, status_code: int = 500) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _image_to_data_url(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{payload}"


def _read_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise LayoutServiceError(f"生成的场景文件格式无效：{path.name}")
    return value


def _expected_output_paths(output_root: Path, model_id: str) -> dict[str, Path]:
    return {
        "dimension": output_root / "dimension_drawing_with_ground_numbered_dimensioned.png",
        "function_block": output_root / "function_block_diagram.png",
        "function_block_scene": output_root / "function_block_scene.json",
        "assembly": output_root / "assembly_drawing.png",
        "pad_csv": output_root / f"{model_id}_压点信息表.csv",
        "pad_xlsx": output_root / f"{model_id}_压点信息表.xlsx",
        "report": output_root / "pad_ground_report.json",
        "dimension_scene": output_root / "dimension_scene.json",
        "assembly_scene": output_root / "assembly_scene.json",
    }


class LayoutService:
    def __init__(self, settings: ApplicationSettings) -> None:
        self.settings = settings

    def list_process_nodes(self) -> dict[str, object]:
        try:
            config = load_process_config()
        except ProcessConfigError as exc:
            raise LayoutServiceError(str(exc), status_code=503) from exc
        return {
            "default_node": config["default_node"],
            "nodes": [{"id": key, **node} for key, node in config["nodes"].items()],
        }

    def generate(
        self, filename: str, payload: bytes, process_node: str | None = None
    ) -> dict[str, object]:
        safe_filename = Path(filename or "layout.tdb").name
        if Path(safe_filename).suffix.lower() != ".tdb":
            raise LayoutServiceError("仅支持 .tdb 文件", status_code=400)
        if not payload:
            raise LayoutServiceError("上传的 .tdb 文件为空", status_code=400)

        try:
            config = load_process_config()
        except ProcessConfigError as exc:
            raise LayoutServiceError(str(exc), status_code=503) from exc
        try:
            node = select_process_node(config, process_node)
        except ProcessConfigError as exc:
            raise LayoutServiceError(str(exc), status_code=400) from exc

        temporary_root = Path(tempfile.mkdtemp(prefix="preinstalled-manual-layout-"))
        temporary_tdb = temporary_root / safe_filename
        try:
            temporary_tdb.write_bytes(payload)
            model_output_root = (
                self.settings.output_root / node["id"] / temporary_tdb.stem / uuid.uuid4().hex
            )
            model_output_root.mkdir(parents=True, exist_ok=True)
            # 固定本次生成配置，避免生成期间修改配置文件造成节点与结果不一致。
            snapshot = model_output_root / "process_nodes.snapshot.json"
            snapshot.write_text(json.dumps({
                "default_node": node["id"],
                "nodes": {node["id"]: {"label": node["label"], "layers": node["layers"]}},
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            return self._run_pipeline(temporary_tdb, model_output_root, node, snapshot)
        finally:
            self._cleanup(temporary_root)

    def _run_pipeline(
        self, tdb_path: Path, output_root: Path, node: dict[str, object], config_path: Path
    ) -> dict[str, object]:
        command = [
            str(self.settings.pipeline_python),
            str(self.settings.pipeline_script),
            str(tdb_path),
            "--output-root",
            str(output_root),
            "--runner-python",
            str(self.settings.runner_python),
            "--process-node", str(node["id"]),
            "--process-config", str(config_path),
        ]
        if self.settings.ledit_exe is not None:
            command.extend(["--ledit-exe", str(self.settings.ledit_exe)])
        if self.settings.force_refresh:
            command.append("--force-refresh")

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                cwd=str(self.settings.project_root / "pipeline"),
            )
        except OSError as exc:
            raise LayoutServiceError(f"无法启动版图生成流程：{exc}") from exc
        if result.returncode != 0:
            detail = "\n".join(
                part for part in (result.stdout.strip(), result.stderr.strip()) if part
            ).strip()
            raise LayoutServiceError(detail or "版图生成流程执行失败")

        paths = _expected_output_paths(output_root, tdb_path.stem)
        missing = [path.name for path in paths.values() if not path.exists()]
        if missing:
            raise LayoutServiceError("生成结果不完整：" + "、".join(missing))

        return {
            "model_id": tdb_path.stem,
            "process_node": node["id"],
            "process_label": node["label"],
            "process_layers": node["layers"],
            "dimension_image_data_url": _image_to_data_url(paths["dimension"]),
            "function_block_image_data_url": _image_to_data_url(paths["function_block"]),
            "function_block_scene": _read_json(paths["function_block_scene"]),
            "assembly_image_data_url": _image_to_data_url(paths["assembly"]),
            "dimension_scene": _read_json(paths["dimension_scene"]),
            "assembly_scene": _read_json(paths["assembly_scene"]),
            "pad_table_csv_text": paths["pad_csv"].read_text(encoding="utf-8-sig"),
            "pad_table_xlsx_path": str(paths["pad_xlsx"]),
            "report_path": str(paths["report"]),
            "output_root": str(output_root),
            "stdout": result.stdout,
        }

    @staticmethod
    def _cleanup(path: Path) -> None:
        for delay in (0.0, 0.2, 0.5, 1.0):
            try:
                shutil.rmtree(path)
                return
            except FileNotFoundError:
                return
            except OSError:
                if delay:
                    time.sleep(delay)
