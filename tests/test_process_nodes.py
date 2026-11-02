"""验证节点配置、层名映射、接口传参及生成目录隔离。"""

import asyncio
import json
import sys
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import ezdxf
import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend_v2"))
sys.path.insert(0, str(ROOT / "pipeline"))

from config.process_nodes import ProcessConfigError, load_process_config, select_process_node
from config.settings import settings
from main import create_app
from analyze_ledit_pad_ground import analyze_dxf
from services.product_manual._thirdparty.layout_service import LayoutService


def request(app, method, path, **kwargs):
    async def perform():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(perform())


def test_config_changes_are_loaded_without_restart():
    with TemporaryDirectory() as directory:
        path = Path(directory) / "nodes.json"
        config = load_process_config()
        path.write_text(json.dumps(config), encoding="utf-8")
        assert select_process_node(load_process_config(path))["layers"]["pad"] == "pad"
        config["nodes"]["legacy"]["layers"]["pad"] = "CUSTOM_PAD"
        path.write_text(json.dumps(config), encoding="utf-8")
        assert select_process_node(load_process_config(path))["layers"]["pad"] == "CUSTOM_PAD"
        config["nodes"]["legacy"]["layers"]["metal"] = ""
        path.write_text(json.dumps(config), encoding="utf-8")
        with pytest.raises(ProcessConfigError, match="metal"):
            load_process_config(path)


def test_api_lists_nodes_and_rejects_unknown_node_before_launch():
    app = create_app()
    listed = request(app, "GET", "/api/product-manual/layout/process-nodes")
    assert listed.status_code == 200
    assert listed.json()["data"]["default_node"] == "legacy"
    with patch("services.product_manual._thirdparty.layout_service.subprocess.run") as launch:
        response = request(
            app, "POST", "/api/product-manual/layout/generate-layout-assets",
            data={"process_node": "unknown"}, files={"tdb_file": ("chip.tdb", b"test")},
        )
    assert response.status_code == 400
    assert "未知工艺节点" in response.json()["msg"]
    launch.assert_not_called()


def test_api_passes_selected_node_and_reports_invalid_configuration():
    app = create_app()
    service = app.state.product_manual_service
    with patch.object(service, "generate_layout_upload", side_effect=RuntimeError("captured")) as call:
        with pytest.raises(RuntimeError, match="captured"):
            request(app, "POST", "/api/product-manual/layout/generate-layout-assets",
                    data={"process_node": "node_b"}, files={"tdb_file": ("chip.tdb", b"test")})
        assert call.call_args.args[2] == "node_b"
    with patch("services.product_manual._thirdparty.layout_service.load_process_config",
               side_effect=ProcessConfigError("invalid config")):
        response = request(app, "GET", "/api/product-manual/layout/process-nodes")
    assert response.status_code == 503


def test_snapshot_and_output_directories_are_independent():
    with TemporaryDirectory() as directory:
        service = LayoutService(replace(settings, output_root=Path(directory)))
        captured = []

        def pipeline(tdb, output, node, snapshot):
            assert tdb.read_bytes() == b"test"
            frozen = select_process_node(load_process_config(snapshot))
            assert frozen == node
            captured.append((output, snapshot, tdb))
            return {"process_node": node["id"]}

        with patch.object(service, "_run_pipeline", side_effect=pipeline):
            service.generate("chip.tdb", b"test", "legacy")
            service.generate("chip.tdb", b"test", "legacy")
        assert captured[0][0] != captured[1][0]
        assert all(path.parent.parent.name == "legacy" for path, _, _ in captured)
        assert all(snapshot.is_file() and not tdb.exists() for _, snapshot, tdb in captured)


def test_pipeline_command_contains_node_and_snapshot():
    service = LayoutService(settings)
    node = select_process_node(load_process_config())
    with patch("services.product_manual._thirdparty.layout_service.subprocess.run",
               side_effect=OSError("capture command")) as launch:
        with pytest.raises(Exception, match="capture command"):
            service._run_pipeline(Path("chip.tdb"), Path("out"), node, Path("snapshot.json"))
    command = launch.call_args.args[0]
    assert command[command.index("--process-node") + 1] == "legacy"
    assert command[command.index("--process-config") + 1] == "snapshot.json"


def test_renamed_layers_preserve_geometry_and_ground_classification():
    mapping = {"pad": "CUSTOM_PAD", "M0": "CUSTOM_METAL",
               "via0": "CUSTOM_GROUND", "via2": "CUSTOM_DIRECTION"}
    node = {"id": "node_b", "label": "测试节点", "layers": {
        "pad": mapping["pad"], "metal": mapping["M0"],
        "ground_via": mapping["via0"], "io_marker": mapping["via2"],
    }}
    with TemporaryDirectory() as directory:
        # Synthetic geometry keeps this regression independent of private chip files.
        source = Path(directory) / "synthetic.dxf"
        sample = ezdxf.new()
        for layer in mapping:
            sample.layers.new(layer)

        def rectangle(layer, x, y, width, height):
            sample.modelspace().add_polyline2d(
                [(x, y), (x + width, y), (x + width, y + height), (x, y + height)],
                close=True, dxfattribs={"layer": layer},
            )

        for bounds in [(0, 0, 1000, 20), (0, 580, 1000, 20),
                       (0, 0, 20, 600), (980, 0, 20, 600),
                       (40, 100, 80, 80), (40, 300, 80, 80),
                       (880, 300, 80, 80), (450, 50, 80, 80)]:
            rectangle("pad", *bounds)
        rectangle("M0", 35, 95, 105, 90)
        rectangle("via0", 60, 120, 5, 5)
        for x, y in [(150, 200), (820, 220), (820, 260)]:
            rectangle("via2", x, y, 5, 5)
        sample.saveas(source)
        original = analyze_dxf(source)
        assert original["dimension_frame"] is not None
        assert {port["is_ground"] for port in original["ports"]} == {True, False}
        doc = ezdxf.readfile(source)
        for entity in doc.modelspace():
            if entity.dxf.layer in mapping:
                entity.dxf.layer = mapping[entity.dxf.layer]
        path = Path(directory) / "renamed.dxf"
        doc.saveas(path)
        renamed = analyze_dxf(path, node)
        for key in ("ports", "physical_ports", "dimension_frame", "port_roles"):
            assert renamed[key] == original[key]
        assert renamed["process_layers"] == node["layers"]
        with pytest.raises(ValueError, match="缺少配置层"):
            analyze_dxf(path)


def test_cli_rejects_unknown_node_before_starting_cad():
    import prepare_manual_tool_assets_from_ledit as entry
    with patch.object(sys, "argv", ["prepare", "missing.tdb", "--process-node", "unknown"]):
        with patch.object(entry, "resolve_ledit_executable") as launch:
            with pytest.raises(ProcessConfigError, match="未知工艺节点"):
                entry.main()
            launch.assert_not_called()
