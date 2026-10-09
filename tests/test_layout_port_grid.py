"""Keep the four layout outputs aligned to the same 5 μm pad positions."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageChops

PIPELINE_ROOT = Path(__file__).resolve().parents[1] / "pipeline"
sys.path.insert(0, str(PIPELINE_ROOT))

from analyze_ledit_pad_ground import merge_physical_ports, render_formal_dimension_drawing  # noqa: E402
from generate_pad_table_from_report import build_rows  # noqa: E402
from layout_scene_builder import (  # noqa: E402
    build_assembly_scene,
    build_dimension_scene,
    build_function_block_scene,
)


def _source_port(index: int, bounds: list[float], side: str, ground: bool = False) -> dict:
    x1, y1, x2, y2 = bounds
    return {
        "port_index": index,
        "bounds": bounds,
        "side": side,
        "is_ground": ground,
        "centroid": [(x1 + x2) / 2, (y1 + y2) / 2],
    }


def _port_centers(scene: dict) -> dict[int, tuple[float, float]]:
    return {
        element["meta"]["port_index"]: (
            element["x"] + element["width"] / 2,
            element["y"] + element["height"] / 2,
        )
        for element in scene["elements"]
        if element["kind"] == "rect" and element["role"] == "port"
    }


def _sample_report() -> dict:
    source_ports = [
        _source_port(0, [15.75, 92.5, 95.75, 172.5], "left", True),
        _source_port(1, [15.75, 242, 95.75, 322], "left"),
        _source_port(2, [905.5, 242.5, 985.5, 322.5], "right"),
        _source_port(3, [467.5, 15.75, 547.5, 95.75], "bottom"),
    ]
    ports = merge_physical_ports(source_ports, origin=(0, 0))
    roles = {port["side"]: port["port_index"] for port in ports if not port["is_ground"]}
    report = {
        "dimension_frame": {"bounds": [0, 0, 1000, 600]},
        "ports": source_ports,
        "physical_ports": ports,
        "port_roles": {
            "RFin": roles["left"],
            "RFout": roles["right"],
            "Vd": roles["bottom"],
            "Vd_ports": [roles["bottom"]],
        },
    }
    return report


def _assert_layout_positions() -> None:
    report = _sample_report()
    ports = report["physical_ports"]

    assert any(port["centroid"] != port["source_centroid"] for port in ports)
    for port in ports:
        assert all(value % 5 == 0 for value in port["centroid"])
        x1, y1, x2, y2 = port["bounds"]
        assert ((x1 + x2) / 2, (y1 + y2) / 2) == tuple(port["centroid"])

    rows = build_rows(report)
    by_role = {row[1]: row for row in rows}
    assert by_role["RFin"][3] == "(55, 280)"
    assert by_role["RFout"][3] == "(945, 285)"
    assert by_role["Vd"][3] == "(510, 55)"
    assert "(55, 135)" in by_role["GND"][3]

    dimension = build_dimension_scene(report, model_id="test")
    assembly = build_assembly_scene(report, model_id="test")
    function = build_function_block_scene(report, model_id="test")
    dimension_centers = _port_centers(dimension)
    assembly_centers = _port_centers(assembly)
    function_centers = _port_centers(function)
    assert dimension_centers.keys() == assembly_centers.keys() == function_centers.keys()

    assembly_offsets = assembly["meta"]["offsets"]
    function_bounds = function["meta"]["content_bounds"]
    for port_index, (dx, dy) in dimension_centers.items():
        assembly_expected = (dx + assembly_offsets["left"], dy + assembly_offsets["top"])
        function_expected = (dx - function_bounds[0], dy - function_bounds[1])
        assert all(abs(actual - expected) < 0.001 for actual, expected in zip(assembly_centers[port_index], assembly_expected))
        assert all(abs(actual - expected) < 0.001 for actual, expected in zip(function_centers[port_index], function_expected))

    labels = {element["role"]: element["text"] for element in dimension["elements"] if element["kind"] == "dimension_label"}
    assert labels["dimension_left_signal"] == "280"
    assert labels["dimension_right_signal"] == "285"
    assert labels["dimension_vd"] == "510"


class LayoutPortGridTests(unittest.TestCase):
    def test_dimension_labels_have_canvas_padding(self) -> None:
        report = _sample_report()
        with TemporaryDirectory() as output_dir:
            image_path = Path(output_dir) / "dimension.png"
            render_formal_dimension_drawing(
                report, image_path, draw_ground=True, draw_numbers=True, draw_dimensions=True
            )
            with Image.open(image_path) as source:
                image = source.convert("RGB")
                ink = ImageChops.difference(image, Image.new("RGB", image.size, "white")).getbbox()
                self.assertIsNotNone(ink)
                self.assertGreaterEqual(ink[0], 40)
                self.assertGreaterEqual(image.width - ink[2], 40)
                self.assertGreaterEqual(image.height - ink[3], 40)

    def test_pad_positions_match_all_four_outputs(self) -> None:
        _assert_layout_positions()

    def test_grid_is_relative_to_frame_origin(self) -> None:
        port = _source_port(0, [-880.75, -340.5, -800.75, -260.5], "left")
        adjusted = merge_physical_ports([port], origin=(-937.5, -457.5))[0]
        self.assertEqual(adjusted["centroid"], [-842.5, -302.5])
        self.assertEqual(adjusted["source_centroid"], [-840.75, -300.5])

    def test_snapping_does_not_reorder_ports_with_equal_grid_coordinates(self) -> None:
        ports = [
            _source_port(0, [900, -56, 1000, 24], "right"),
            _source_port(1, [-100, -53.5, 0, 26.5], "left"),
        ]
        adjusted = merge_physical_ports(ports, origin=(0, 0))
        self.assertEqual([port["source_port_indices"] for port in adjusted], [[0], [1]])
