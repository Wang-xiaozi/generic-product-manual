from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

from runtime_bootstrap import bootstrap_vendor

bootstrap_vendor(__file__)

# 独立执行 pipeline 脚本时复用后端的同一套工艺配置读取逻辑。
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend_v2"))
from config.process_nodes import DEFAULT_PROCESS_CONFIG, load_process_config, select_process_node

VENDOR_DIR = Path(__file__).resolve().parent / "vendor"

import ezdxf
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon

from layout_scene_builder import build_dimension_scene, dimension_canvas_spec, save_scene_json


SCRIPT_ROOT = Path(__file__).resolve().parent
DEFAULT_EXPORT_SCRIPT = SCRIPT_ROOT / "prepare_manual_tool_assets_from_ledit.py"
DEFAULT_ASSEMBLY_SCRIPT = SCRIPT_ROOT / "generate_assembly_from_dimension.py"
DEFAULT_FUNCTION_BLOCK_SCRIPT = SCRIPT_ROOT / "generate_function_block_from_report.py"
DEFAULT_PAD_TABLE_SCRIPT = SCRIPT_ROOT / "generate_pad_table_from_report.py"
DEFAULT_OUTPUT_ROOT = SCRIPT_ROOT / "generated_output"
PAD_AREA_MAX = 10000.0
GEOM_EPSILON = 0.6
GROUND_VIA_CONTAIN_EPSILON = 0.6
PORT_POSITION_GRID = 5.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export a L-Edit TDB to DXF, isolate pad-layer port boxes, infer ground pads from "
            "pad/M0/via0 connectivity, and generate review images plus a report."
        )
    )
    parser.add_argument("tdb_path", type=Path, help="Source L-Edit TDB file.")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory used to store DXF export, analysis images, and the JSON report.",
    )
    parser.add_argument(
        "--runner-python",
        type=Path,
        default=Path("__CURRENT_PYTHON__"),
        help="Python executable used to run the export helper.",
    )
    parser.add_argument(
        "--export-script",
        type=Path,
        default=DEFAULT_EXPORT_SCRIPT,
        help="Helper script used to export the TDB into DXF.",
    )
    parser.add_argument(
        "--ledit-exe",
        type=Path,
        default=None,
        help="Path to ledit64.exe or the L-Edit installation directory.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Regenerate the DXF export even if it already exists.",
    )
    parser.add_argument(
        "--assembly-script",
        type=Path,
        default=DEFAULT_ASSEMBLY_SCRIPT,
        help="Helper script used to generate the assembly drawing from the rendered dimension drawing.",
    )
    parser.add_argument(
        "--function-block-script",
        type=Path,
        default=DEFAULT_FUNCTION_BLOCK_SCRIPT,
        help="Helper script used to generate the function block diagram from the rendered dimension drawing/report.",
    )
    parser.add_argument(
        "--pad-table-script",
        type=Path,
        default=DEFAULT_PAD_TABLE_SCRIPT,
        help="Helper script used to generate the pad table from the pad-ground analysis report.",
    )
    parser.add_argument("--process-node", default=None, help="Configured process node ID.")
    parser.add_argument(
        "--process-config", type=Path, default=DEFAULT_PROCESS_CONFIG,
        help="JSON file mapping process nodes to DXF layer names.",
    )
    return parser.parse_args()


def resolve_runner_python(path_arg: Path) -> Path:
    if path_arg.name == "__CURRENT_PYTHON__":
        return Path(sys.executable).resolve()
    return path_arg.resolve()


def ensure_exists(path: Path, label: str) -> Path:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path.resolve()


def log_text(text: str) -> None:
    encoding = sys.stdout.encoding or "utf-8"
    safe_text = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
    print(safe_text)


def run_command(args: list[str], label: str) -> None:
    log_text(f"[RUN] {label}")
    env = os.environ.copy()
    existing_pythonpath = env.get("PYTHONPATH", "")
    extra_paths = [str(Path(__file__).resolve().parent)]
    if env.get("LAYOUT_USE_BUNDLED_VENDOR", "").strip().lower() in {"1", "true", "yes", "on"}:
        extra_paths.insert(0, str(VENDOR_DIR))
    env["PYTHONPATH"] = os.pathsep.join([path for path in extra_paths + [existing_pythonpath] if path])
    try:
        result = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            env=env,
        )
    except subprocess.CalledProcessError as exc:
        if exc.stdout and exc.stdout.strip():
            log_text(exc.stdout.strip())
        if exc.stderr and exc.stderr.strip():
            log_text(exc.stderr.strip())
        raise
    if result.stdout.strip():
        log_text(result.stdout.strip())
    if result.stderr.strip():
        log_text(result.stderr.strip())


def run_downstream_asset_scripts(
    *,
    runner_python: Path,
    assembly_script: Path,
    function_block_script: Path,
    pad_table_script: Path,
    output_root: Path,
) -> None:
    run_command(
        [
            str(runner_python),
            str(assembly_script),
            "--output-root",
            str(output_root),
        ],
        "Generate assembly drawing",
    )
    run_command(
        [
            str(runner_python),
            str(function_block_script),
            "--output-root",
            str(output_root),
        ],
        "Generate function block diagram",
    )
    run_command(
        [
            str(runner_python),
            str(pad_table_script),
            "--output-root",
            str(output_root),
        ],
        "Generate pad table",
    )


def export_tdb_to_dxf(
    *,
    runner_python: Path,
    export_script: Path,
    tdb_path: Path,
    output_root: Path,
    ledit_exe: Path,
    force_refresh: bool,
) -> Path:
    command = [
        str(runner_python),
        str(export_script),
        str(tdb_path),
        "--output-root",
        str(output_root),
        "--stop-after-cad",
        "--ledit-exe",
        str(ledit_exe),
    ]
    if force_refresh:
        command.append("--force-refresh")
    run_command(command, "Export TDB to DXF")
    return output_root / "cad_exports" / f"{tdb_path.stem}.dxf"


def polygon_from_polyline(entity) -> Polygon | None:
    points = [(vertex.dxf.location.x, vertex.dxf.location.y) for vertex in entity.vertices]
    if len(points) < 3:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    polygon = Polygon(points)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    return None if polygon.is_empty else polygon


def detect_io_sides_from_via2(
    dxf_path: Path, frame_bounds: list[float], io_marker_layer: str
) -> dict[str, str]:
    doc = ezdxf.readfile(dxf_path)
    modelspace = doc.modelspace()
    frame_x1, frame_y1, frame_x2, frame_y2 = frame_bounds
    frame_cx = (frame_x1 + frame_x2) / 2.0
    frame_area = (frame_x2 - frame_x1) * (frame_y2 - frame_y1)

    via2_polys = []
    for entity in modelspace:
        if entity.dxftype() != "POLYLINE" or entity.dxf.layer.strip().casefold() != io_marker_layer.strip().casefold():
            continue
        poly = polygon_from_polyline(entity)
        if poly is None:
            continue
        if poly.area > frame_area * 0.02:
            continue
        cx, cy = float(poly.centroid.x), float(poly.centroid.y)
        via2_polys.append({"centroid": (cx, cy)})

    left_count = sum(1 for item in via2_polys if item["centroid"][0] < frame_cx)
    right_count = sum(1 for item in via2_polys if item["centroid"][0] >= frame_cx)

    if left_count == 2 and right_count == 3:
        return {"in_side": "left", "out_side": "right"}
    if left_count == 3 and right_count == 2:
        return {"in_side": "right", "out_side": "left"}
    return {"in_side": "left", "out_side": "right"}


def detect_port_side(bounds: tuple[float, float, float, float], chip_bounds: tuple[float, float, float, float]) -> str:
    x1, y1, x2, y2 = bounds
    minx, miny, maxx, maxy = chip_bounds
    distances = {
        "left": abs(x1 - minx),
        "right": abs(maxx - x2),
        "top": abs(maxy - y2),
        "bottom": abs(y1 - miny),
    }
    return min(distances, key=distances.get)


def build_dimension_frame(pad_frame: list[dict[str, object]]) -> dict[str, object] | None:
    if len(pad_frame) < 4:
        return None

    horizontal_frames = sorted(
        [item for item in pad_frame if (item["bounds"][2] - item["bounds"][0]) >= (item["bounds"][3] - item["bounds"][1])],
        key=lambda item: item["bounds"][1],
    )
    vertical_frames = sorted(
        [item for item in pad_frame if (item["bounds"][2] - item["bounds"][0]) < (item["bounds"][3] - item["bounds"][1])],
        key=lambda item: item["bounds"][0],
    )
    if len(horizontal_frames) < 2 or len(vertical_frames) < 2:
        return None

    bottom_frame = horizontal_frames[0]
    top_frame = horizontal_frames[-1]
    left_frame = vertical_frames[0]
    right_frame = vertical_frames[-1]

    frame_bounds = (
        float(left_frame["bounds"][0]),
        float(bottom_frame["bounds"][1]),
        float(right_frame["bounds"][2]),
        float(top_frame["bounds"][3]),
    )
    return {
        "bounds": [round(value, 2) for value in frame_bounds],
        "source_frame_bounds": {
            "left": [round(value, 2) for value in left_frame["bounds"]],
            "right": [round(value, 2) for value in right_frame["bounds"]],
            "bottom": [round(value, 2) for value in bottom_frame["bounds"]],
            "top": [round(value, 2) for value in top_frame["bounds"]],
        },
    }


def classify_port_roles(
    ports: list[dict[str, object]],
    *,
    dxf_path: Path,
    frame_bounds: list[float],
    io_marker_layer: str,
) -> dict[str, object]:
    non_ground = [port for port in ports if not bool(port.get("is_ground", False))]
    side_map = detect_io_sides_from_via2(dxf_path, frame_bounds, io_marker_layer)
    in_side = side_map["in_side"]
    out_side = side_map["out_side"]

    in_candidates = [port for port in non_ground if str(port.get("side")) == in_side]
    out_candidates = [port for port in non_ground if str(port.get("side")) == out_side]
    if not in_candidates or not out_candidates:
        raise RuntimeError("Unable to locate non-ground IN/OUT candidates from side classification.")

    in_port = in_candidates[0]
    out_port = out_candidates[0]
    used_indices = {int(in_port["port_index"]), int(out_port["port_index"])}
    vd_ports = [port for port in non_ground if int(port["port_index"]) not in used_indices]

    return {
        "RFin": in_port,
        "RFout": out_port,
        "Vd": vd_ports[0] if vd_ports else None,
        "Vd_ports": vd_ports,
    }


def snap_port_coordinate(value: float, origin: float) -> float:
    offset = value - origin
    steps = math.copysign(math.floor(abs(offset) / PORT_POSITION_GRID + 0.5), offset)
    return round(origin + steps * PORT_POSITION_GRID, 2)


def merge_physical_ports(
    ports: list[dict[str, object]], *, origin: tuple[float, float]
) -> list[dict[str, object]]:
    if not ports:
        return []

    normalized_ports: list[dict[str, object]] = []
    for port in ports:
        x1, y1, x2, y2 = [float(value) for value in port["bounds"]]
        normalized_ports.append(
            {
                **port,
                "_bounds_tuple": (x1, y1, x2, y2),
            }
        )

    groups: list[list[int]] = []
    visited: set[int] = set()
    merge_tolerance = 35.0

    for index, port in enumerate(normalized_ports):
        if index in visited:
            continue
        stack = [index]
        group: list[int] = []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            group.append(current)
            cx1, cy1, cx2, cy2 = normalized_ports[current]["_bounds_tuple"]
            for other_index, other in enumerate(normalized_ports):
                if other_index in visited:
                    continue
                ox1, oy1, ox2, oy2 = other["_bounds_tuple"]
                overlaps_x = min(cx2, ox2) - max(cx1, ox1) >= -merge_tolerance
                overlaps_y = min(cy2, oy2) - max(cy1, oy1) >= -merge_tolerance
                same_side = port["side"] == other["side"]
                if overlaps_x and overlaps_y and same_side:
                    stack.append(other_index)
        groups.append(group)

    merged_ports: list[dict[str, object]] = []
    for merged_index, group in enumerate(groups):
        members = [normalized_ports[index] for index in group]
        minx = min(member["_bounds_tuple"][0] for member in members)
        miny = min(member["_bounds_tuple"][1] for member in members)
        maxx = max(member["_bounds_tuple"][2] for member in members)
        maxy = max(member["_bounds_tuple"][3] for member in members)
        source_centroid_x = (minx + maxx) / 2.0
        source_centroid_y = (miny + maxy) / 2.0
        # Manual coordinates start at the frame's lower-left corner. Snap the
        # center once here so drawings and the pad table share one position.
        centroid_x = snap_port_coordinate(source_centroid_x, origin[0])
        centroid_y = snap_port_coordinate(source_centroid_y, origin[1])
        # Formal drawings use a fixed 100 x 100 um port frame while keeping
        # the center identified from the source layout unchanged.
        standard_port_size = 100.0
        half_size = standard_port_size / 2.0
        merged_ports.append(
            {
                "port_index": merged_index,
                "bounds": [
                    round(centroid_x - half_size, 2),
                    round(centroid_y - half_size, 2),
                    round(centroid_x + half_size, 2),
                    round(centroid_y + half_size, 2),
                ],
                "centroid": [round(centroid_x, 2), round(centroid_y, 2)],
                "width": standard_port_size,
                "height": standard_port_size,
                "source_bounds": [round(minx, 2), round(miny, 2), round(maxx, 2), round(maxy, 2)],
                "source_centroid": [round(source_centroid_x, 2), round(source_centroid_y, 2)],
                "source_width": round(maxx - minx, 2),
                "source_height": round(maxy - miny, 2),
                "side": members[0]["side"],
                "is_ground": any(bool(member["is_ground"]) for member in members),
                "source_port_indices": [int(member["port_index"]) for member in members],
            }
        )

    return sorted(merged_ports, key=lambda item: (item["source_centroid"][1], item["source_centroid"][0]))


def analyze_dxf(dxf_path: Path, process_node: dict[str, object] | None = None) -> dict[str, object]:
    node = process_node or select_process_node(load_process_config())
    layers = {role: name.strip().casefold() for role, name in node["layers"].items()}
    doc = ezdxf.readfile(dxf_path)
    available = {entity.dxf.layer.strip().casefold() for entity in doc.modelspace()}
    missing = [f"{role}={name}" for role, name in node["layers"].items()
               if name.strip().casefold() not in available]
    if missing:
        actual = ", ".join(sorted({entity.dxf.layer for entity in doc.modelspace()}))
        raise ValueError(f"工艺节点 {node['id']} 缺少配置层：{', '.join(missing)}；实际层名：{actual}")
    modelspace = doc.modelspace()

    all_items: list[dict[str, object]] = []
    text_entities: list[dict[str, object]] = []
    for entity in modelspace:
        layer = entity.dxf.layer.strip().casefold()
        entity_type = entity.dxftype()
        if entity_type in {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}:
            text = entity.plain_text() if hasattr(entity, "plain_text") else getattr(entity.dxf, "text", "")
            text_entities.append({"layer": layer, "type": entity_type, "text": text})
        if entity_type != "POLYLINE":
            continue
        if layer not in {layers["pad"], layers["metal"], layers["ground_via"]}:
            continue
        polygon = polygon_from_polyline(entity)
        if polygon is None:
            continue
        all_items.append(
            {
                "layer": layer,
                "polygon": polygon,
                "bounds": polygon.bounds,
                "area": float(polygon.area),
                "centroid": (float(polygon.centroid.x), float(polygon.centroid.y)),
            }
        )

    pad_ports = sorted(
        [item for item in all_items if item["layer"] == layers["pad"] and float(item["area"]) < PAD_AREA_MAX],
        key=lambda item: (item["bounds"][1], item["bounds"][0]),
    )
    pad_frame = [item for item in all_items if item["layer"] == layers["pad"] and float(item["area"]) >= PAD_AREA_MAX]
    m0_items = [item for item in all_items if item["layer"] == layers["metal"]]
    via0_items = [item for item in all_items if item["layer"] == layers["ground_via"]]
    if not pad_ports:
        raise ValueError(f"工艺节点 {node['id']} 的压点层 {node['layers']['pad']} 未识别到有效压点")
    dimension_frame = build_dimension_frame(pad_frame)

    chip_bounds = (
        min(item["bounds"][0] for item in pad_ports),
        min(item["bounds"][1] for item in pad_ports),
        max(item["bounds"][2] for item in pad_ports),
        max(item["bounds"][3] for item in pad_ports),
    )

    analysis_ports: list[dict[str, object]] = []
    for port_index, pad in enumerate(pad_ports):
        connected_m0_indices: list[int] = []
        via_hits: list[dict[str, object]] = []
        via_hit_records: list[dict[str, object]] = []

        for m0_index, m0 in enumerate(m0_items):
            if not pad["polygon"].buffer(GEOM_EPSILON).intersects(m0["polygon"].buffer(GEOM_EPSILON)):
                continue
            connected_m0_indices.append(m0_index)

            for via_index, via in enumerate(via0_items):
                via_center = via["polygon"].centroid
                m0_expanded = m0["polygon"].buffer(GROUND_VIA_CONTAIN_EPSILON)
                if not (m0_expanded.contains(via_center) or m0_expanded.intersects(via["polygon"].buffer(GEOM_EPSILON))):
                    continue
                via_hits.append(via)
                via_hit_records.append(
                    {
                        "m0_index": m0_index,
                        "via0_index": via_index,
                        "via0_centroid": [round(via["centroid"][0], 2), round(via["centroid"][1], 2)],
                    }
                )

        unique_via_hit_records: list[dict[str, object]] = []
        seen_via_keys: set[tuple[int, int]] = set()
        for record in via_hit_records:
            key = (int(record["m0_index"]), int(record["via0_index"]))
            if key in seen_via_keys:
                continue
            seen_via_keys.add(key)
            unique_via_hit_records.append(record)

        pad_width = pad["bounds"][2] - pad["bounds"][0]
        pad_height = pad["bounds"][3] - pad["bounds"][1]
        is_ground = bool(unique_via_hit_records)
        analysis_ports.append(
            {
                "port_index": port_index,
                "bounds": [round(value, 2) for value in pad["bounds"]],
                "centroid": [round(value, 2) for value in pad["centroid"]],
                "width": round(pad_width, 2),
                "height": round(pad_height, 2),
                "side": detect_port_side(pad["bounds"], chip_bounds),
                "is_ground": is_ground,
                "explicit_property_found": False,
                "connected_m0_indices": connected_m0_indices,
                "ground_via0_hits": unique_via_hit_records,
                "m0_component_count": len(connected_m0_indices),
            }
        )

    frame_bounds = dimension_frame["bounds"] if isinstance(dimension_frame, dict) else chip_bounds
    physical_ports = merge_physical_ports(
        analysis_ports, origin=(float(frame_bounds[0]), float(frame_bounds[1]))
    )
    port_roles = classify_port_roles(
        physical_ports,
        dxf_path=dxf_path,
        frame_bounds=list(frame_bounds),
        io_marker_layer=node["layers"]["io_marker"],
    )

    return {
        "dxf_path": str(dxf_path),
        "process_node": node["id"],
        "process_label": node["label"],
        "process_layers": dict(node["layers"]),
        "pad_frame_count": len(pad_frame),
        "dimension_frame": dimension_frame,
        "port_count": len(analysis_ports),
        "physical_port_count": len(physical_ports),
        "explicit_property_entities_found": text_entities,
        "ports": analysis_ports,
        "physical_ports": physical_ports,
        "port_roles": {
            "RFin": None if port_roles["RFin"] is None else int(port_roles["RFin"]["port_index"]),
            "RFout": None if port_roles["RFout"] is None else int(port_roles["RFout"]["port_index"]),
            "Vd": None if port_roles["Vd"] is None else int(port_roles["Vd"]["port_index"]),
            "Vd_ports": [int(port["port_index"]) for port in port_roles["Vd_ports"]],
        },
    }


def make_canvas(
    port_data: list[dict[str, object]],
    frame_bounds: list[float] | None = None,
    scale: float = 4.0,
    margin: int = 120,
):
    xs = []
    ys = []
    for port in port_data:
        x1, y1, x2, y2 = port["bounds"]
        xs.extend([x1, x2])
        ys.extend([y1, y2])
    if frame_bounds is not None:
        x1, y1, x2, y2 = frame_bounds
        xs.extend([x1, x2])
        ys.extend([y1, y2])
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    width = int((maxx - minx) * scale) + margin * 2
    height = int((maxy - miny) * scale) + margin * 2
    image = Image.new("RGB", (width, height), "white")
    return image, (minx, miny, maxx, maxy), scale, margin


def map_point(x: float, y: float, *, bounds, scale: float, margin: int, height: int) -> tuple[float, float]:
    minx, miny, _, _ = bounds
    px = margin + (x - minx) * scale
    py = height - (margin + (y - miny) * scale)
    return px, py


def draw_ground_symbol(draw: ImageDraw.ImageDraw, anchor: tuple[float, float], side: str, line_width: int = 5) -> None:
    ax, ay = anchor
    stem = 18
    bar = 14
    gap = 8
    if side == "left":
        joint = (ax - 22, ay)
        stem_end = (joint[0], joint[1] + stem)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.4, bar * 0.8]):
            y = stem_end[1] + index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)
    elif side == "right":
        joint = (ax + 22, ay)
        stem_end = (joint[0], joint[1] + stem)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.4, bar * 0.8]):
            y = stem_end[1] + index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)
    elif side == "top":
        joint = (ax, ay - 22)
        stem_end = (joint[0], joint[1] - stem)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.4, bar * 0.8]):
            y = stem_end[1] - index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)
    else:
        joint = (ax, ay + 22)
        stem_end = (joint[0], joint[1] + stem)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.4, bar * 0.8]):
            y = stem_end[1] + index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)


def draw_formal_ground_symbol(
    draw: ImageDraw.ImageDraw,
    anchor: tuple[float, float],
    side: str,
    *,
    scale: float,
    placement: str = "above",
) -> None:
    symbol_scale = 5.0
    line_width = 15
    stem = symbol_scale * 34
    bar = symbol_scale * 28
    gap = symbol_scale * 10
    elbow = symbol_scale * 24
    ax, ay = anchor

    if side == "left":
        joint = (ax + elbow, ay)
        stem_end_y = joint[1] - stem if placement == "above" else joint[1] + stem
        stem_end = (joint[0], stem_end_y)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.45, bar * 0.9]):
            y = stem_end[1] - index * gap if placement == "above" else stem_end[1] + index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)
    elif side == "right":
        joint = (ax - elbow, ay)
        stem_end_y = joint[1] - stem if placement == "above" else joint[1] + stem
        stem_end = (joint[0], stem_end_y)
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.45, bar * 0.9]):
            y = stem_end[1] - index * gap if placement == "above" else stem_end[1] + index * gap
            draw.line([(joint[0] - width / 2, y), (joint[0] + width / 2, y)], fill="black", width=line_width)
    elif side == "top":
        joint = (ax, ay + elbow)
        stem_end = (joint[0] + stem, joint[1])
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.45, bar * 0.9]):
            x = stem_end[0] + index * gap
            draw.line([(x, joint[1] - width / 2), (x, joint[1] + width / 2)], fill="black", width=line_width)
    else:
        joint = (ax, ay - elbow)
        stem_end = (joint[0] + stem, joint[1])
        draw.line([anchor, joint, stem_end], fill="black", width=line_width)
        for index, width in enumerate([bar * 2.0, bar * 1.45, bar * 0.9]):
            x = stem_end[0] + index * gap
            draw.line([(x, joint[1] - width / 2), (x, joint[1] + width / 2)], fill="black", width=line_width)


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\simhei.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def merge_close_values(values: list[float], tolerance: float) -> list[float]:
    if not values:
        return []
    sorted_values = sorted(values)
    groups: list[list[float]] = [[sorted_values[0]]]
    for value in sorted_values[1:]:
        if abs(value - groups[-1][-1]) <= tolerance:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [sum(group) / len(group) for group in groups]


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    position: tuple[float, float],
    text: str,
    *,
    font: ImageFont.ImageFont,
) -> None:
    try:
        draw.text(position, text, fill="black", font=font, anchor="mm")
    except TypeError:
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        width = right - left
        height = bottom - top
        draw.text((position[0] - width / 2, position[1] - height / 2), text, fill="black", font=font)


def format_dimension_value(value: float) -> str:
    rounded = int(round(value))
    return str(rounded)


def draw_left_dimension_label(
    draw: ImageDraw.ImageDraw,
    y_px: float,
    text: str,
    *,
    frame_left_x: float,
    font: ImageFont.ImageFont,
    line_width: int,
    tick_length: float,
    text_gap: float,
) -> None:
    draw.line([(frame_left_x - tick_length, y_px), (frame_left_x, y_px)], fill="black", width=line_width)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_w = right - left
    text_h = bottom - top
    draw.text((frame_left_x - tick_length - text_gap - text_w, y_px - text_h / 2), text, fill="black", font=font)


def draw_right_dimension_label(
    draw: ImageDraw.ImageDraw,
    y_px: float,
    text: str,
    *,
    frame_right_x: float,
    font: ImageFont.ImageFont,
    line_width: int,
    tick_length: float,
    text_gap: float,
) -> None:
    draw.line([(frame_right_x, y_px), (frame_right_x + tick_length, y_px)], fill="black", width=line_width)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_h = bottom - top
    draw.text((frame_right_x + tick_length + text_gap, y_px - text_h / 2), text, fill="black", font=font)


def draw_top_dimension_label(
    draw: ImageDraw.ImageDraw,
    x_px: float,
    text: str,
    *,
    frame_top_y: float,
    font: ImageFont.ImageFont,
    line_width: int,
    tick_length: float,
    text_gap: float,
) -> None:
    draw.line([(x_px, frame_top_y), (x_px, frame_top_y - tick_length)], fill="black", width=line_width)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_w = right - left
    text_h = bottom - top
    draw.text((x_px - text_w / 2, frame_top_y - tick_length - text_gap - text_h), text, fill="black", font=font)


def draw_bottom_dimension_label(
    draw: ImageDraw.ImageDraw,
    x_px: float,
    text: str,
    *,
    frame_bottom_y: float,
    font: ImageFont.ImageFont,
    line_width: int,
    tick_length: float,
    text_gap: float,
) -> None:
    draw.line([(x_px, frame_bottom_y), (x_px, frame_bottom_y + tick_length)], fill="black", width=line_width)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_w = right - left
    draw.text((x_px - text_w / 2, frame_bottom_y + tick_length + text_gap), text, fill="black", font=font)


def collect_dimension_annotations(
    report: dict[str, object],
    ports: list[dict[str, object]],
    *,
    draw_ground: bool,
) -> dict[str, object]:
    frame_info = report["dimension_frame"]
    frame_x1, frame_y1, frame_x2, frame_y2 = [float(value) for value in frame_info["bounds"]]
    origin_x = frame_x1
    origin_y = frame_y1

    top_value = frame_y2 - origin_y
    right_value = frame_x2 - origin_x

    non_ground_ports = [port for port in ports if not bool(port.get("is_ground", False))]
    role_info = report.get("port_roles") or {}
    vd_indices = {int(value) for value in role_info.get("Vd_ports", [])}
    vd_ports = [port for port in ports if int(port["port_index"]) in vd_indices]
    vd_port = min(vd_ports, key=lambda item: float(item["centroid"][0])) if vd_ports else None

    left_signal_port = min(
        [port for port in non_ground_ports if str(port["side"]) == "left"],
        key=lambda item: float(item["centroid"][1]),
        default=None,
    )
    right_signal_port = min(
        [port for port in non_ground_ports if str(port["side"]) == "right"],
        key=lambda item: float(item["centroid"][1]),
        default=None,
    )

    return {
        "origin": (origin_x, origin_y),
        "top": {
            "y": frame_y2,
            "value": top_value,
        },
        "right": {
            "x": frame_x2,
            "value": right_value,
        },
        "vd": None if vd_port is None else {
            "x": float(vd_port["centroid"][0]),
            "value": float(vd_port["centroid"][0]) - origin_x,
        },
        "left_signal": None if left_signal_port is None else {
            "y": float(left_signal_port["centroid"][1]),
            "value": float(left_signal_port["centroid"][1]) - origin_y,
        },
        "right_signal": None if right_signal_port is None else {
            "y": float(right_signal_port["centroid"][1]),
            "value": float(right_signal_port["centroid"][1]) - origin_y,
        },
    }


def sort_ports_clockwise_from_lower_left(ports: list[dict[str, object]], frame_bounds: list[float]) -> list[dict[str, object]]:
    frame_x1, frame_y1, frame_x2, frame_y2 = [float(value) for value in frame_bounds]
    tolerance = 80.0

    left_ports = sorted(
        [port for port in ports if str(port["side"]) == "left"],
        key=lambda item: (float(item["centroid"][1]), float(item["centroid"][0])),
    )
    top_ports = sorted(
        [port for port in ports if str(port["side"]) == "top"],
        key=lambda item: (float(item["centroid"][0]), float(item["centroid"][1])),
    )
    right_ports = sorted(
        [port for port in ports if str(port["side"]) == "right"],
        key=lambda item: (-float(item["centroid"][1]), float(item["centroid"][0])),
    )
    bottom_ports = sorted(
        [port for port in ports if str(port["side"]) == "bottom"],
        key=lambda item: (-float(item["centroid"][0]), float(item["centroid"][1])),
    )

    unassigned: list[dict[str, object]] = []
    ordered = left_ports + top_ports + right_ports + bottom_ports
    assigned_ids = {id(port) for port in ordered}
    for port in ports:
        if id(port) not in assigned_ids:
            unassigned.append(port)

    for port in unassigned:
        cx, cy = [float(value) for value in port["centroid"]]
        distances = {
            "left": abs(cx - frame_x1),
            "top": abs(cy - frame_y2),
            "right": abs(cx - frame_x2),
            "bottom": abs(cy - frame_y1),
        }
        best_side = min(distances, key=distances.get)
        if best_side == "left":
            left_ports.append(port)
            left_ports.sort(key=lambda item: (float(item["centroid"][1]), float(item["centroid"][0])))
        elif best_side == "top":
            top_ports.append(port)
            top_ports.sort(key=lambda item: (float(item["centroid"][0]), float(item["centroid"][1])))
        elif best_side == "right":
            right_ports.append(port)
            right_ports.sort(key=lambda item: (-float(item["centroid"][1]), float(item["centroid"][0])))
        else:
            bottom_ports.append(port)
            bottom_ports.sort(key=lambda item: (-float(item["centroid"][0]), float(item["centroid"][1])))

    return left_ports + top_ports + right_ports + bottom_ports


def get_port_number_position(
    port: dict[str, object],
    *,
    scale: float,
    frame_mid_x: float,
    frame_mid_y: float,
) -> tuple[float, float]:
    cx, cy = [float(value) for value in port["centroid"]]
    return cx, cy


def render_formal_dimension_drawing(
    report: dict[str, object],
    output_path: Path,
    *,
    draw_ground: bool,
    draw_numbers: bool = False,
    draw_dimensions: bool = False,
) -> None:
    frame_info = report.get("dimension_frame")
    if not isinstance(frame_info, dict):
        raise ValueError("A dimension frame is required to render the formal dimension drawing.")

    spec = dimension_canvas_spec(report)
    frame_bounds = spec["frame_bounds"]
    ports = report.get("physical_ports", report["ports"])
    frame_x1, frame_y1, frame_x2, frame_y2 = frame_bounds
    frame_mid_x = (frame_x1 + frame_x2) / 2.0
    frame_mid_y = (frame_y1 + frame_y2) / 2.0
    margins = spec["margins"]
    scale = float(spec["scale"])
    canvas_width = int(spec["canvas_width"])
    canvas_height = int(spec["canvas_height"])

    image = Image.new("RGB", (canvas_width, canvas_height), "white")
    draw = ImageDraw.Draw(image)
    # Port identifiers must remain legible after the drawing is embedded in a manual.
    number_font = load_font(150)
    dimension_font = load_font(150)
    frame_line_width = 15
    extension_width = 15
    tick_length = scale * 38
    text_gap = scale * 12

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px = margins["left"] + (x - frame_x1) * scale
        py = canvas_height - (margins["bottom"] + (y - frame_y1) * scale)
        return px, py

    frame_top_left = to_pixel(frame_x1, frame_y2)
    frame_bottom_right = to_pixel(frame_x2, frame_y1)
    draw.rectangle([frame_top_left, frame_bottom_right], outline="black", width=frame_line_width)

    for port in ports:
        x1, y1, x2, y2 = port["bounds"]
        top_left = to_pixel(x1, y2)
        bottom_right = to_pixel(x2, y1)
        draw.rectangle([top_left, bottom_right], outline="black", width=frame_line_width)

        cx, cy = port["centroid"]
        if draw_ground and port["is_ground"]:
            if port["side"] == "left":
                anchor = (bottom_right[0], (top_left[1] + bottom_right[1]) / 2)
                placement = "above" if cy > frame_mid_y else "below"
            elif port["side"] == "right":
                anchor = (top_left[0], (top_left[1] + bottom_right[1]) / 2)
                placement = "above" if cy > frame_mid_y else "below"
            elif port["side"] == "top":
                anchor = ((top_left[0] + bottom_right[0]) / 2, top_left[1])
                placement = "right"
            else:
                anchor = ((top_left[0] + bottom_right[0]) / 2, bottom_right[1])
                placement = "right"
            draw_formal_ground_symbol(draw, anchor, str(port["side"]), scale=scale, placement=placement)

    if draw_numbers:
        ordered_ports = sort_ports_clockwise_from_lower_left(list(ports), frame_bounds)
        for number, port in enumerate(ordered_ports, start=1):
            number_world = get_port_number_position(
                port,
                scale=scale,
                frame_mid_x=frame_mid_x,
                frame_mid_y=frame_mid_y,
            )
            number_px = to_pixel(*number_world)
            draw_centered_text(draw, number_px, str(number), font=number_font)

    if draw_dimensions:
        dimensions = collect_dimension_annotations(report, list(ports), draw_ground=draw_ground)
        frame_left_x = frame_top_left[0]
        frame_right_x = frame_bottom_right[0]
        frame_top_y = frame_top_left[1]
        frame_bottom_y = frame_bottom_right[1]

        origin_text = format_dimension_value(0)
        left, top, right, bottom = draw.textbbox((0, 0), origin_text, font=dimension_font)
        origin_w = right - left
        draw.text(
            (frame_left_x - tick_length - text_gap - origin_w, frame_bottom_y - (bottom - top) / 2),
            origin_text,
            fill="black",
            font=dimension_font,
        )

        draw_left_dimension_label(
            draw,
            frame_top_y,
            format_dimension_value(float(dimensions["top"]["value"])),
            frame_left_x=frame_left_x,
            font=dimension_font,
            line_width=extension_width,
            tick_length=tick_length,
            text_gap=text_gap,
        )

        vd_dimension = dimensions["vd"]
        if isinstance(vd_dimension, dict):
            vd_x_px, _ = to_pixel(float(vd_dimension["x"]), frame_y1)
            draw_bottom_dimension_label(
                draw,
                vd_x_px,
                format_dimension_value(float(vd_dimension["value"])),
                frame_bottom_y=frame_bottom_y,
                font=dimension_font,
                line_width=extension_width,
                tick_length=tick_length,
                text_gap=text_gap,
            )

        draw_bottom_dimension_label(
            draw,
            frame_right_x,
            format_dimension_value(float(dimensions["right"]["value"])),
            frame_bottom_y=frame_bottom_y,
            font=dimension_font,
            line_width=extension_width,
            tick_length=tick_length,
            text_gap=text_gap,
        )

        left_signal = dimensions["left_signal"]
        if isinstance(left_signal, dict):
            _, y_px = to_pixel(frame_x1, float(left_signal["y"]))
            draw_left_dimension_label(
                draw,
                y_px,
                format_dimension_value(float(left_signal["value"])),
                frame_left_x=frame_left_x,
                font=dimension_font,
                line_width=extension_width,
                tick_length=tick_length,
                text_gap=text_gap,
            )

        right_signal = dimensions["right_signal"]
        if isinstance(right_signal, dict):
            _, y_px = to_pixel(frame_x2, float(right_signal["y"]))
            draw_right_dimension_label(
                draw,
                y_px,
                format_dimension_value(float(right_signal["value"])),
                frame_right_x=frame_right_x,
                font=dimension_font,
                line_width=extension_width,
                tick_length=tick_length,
                text_gap=text_gap,
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def render_pad_only(
    port_data: list[dict[str, object]],
    output_path: Path,
    *,
    draw_ground: bool,
    frame_bounds: list[float] | None = None,
) -> None:
    image, bounds, scale, margin = make_canvas(port_data, frame_bounds=frame_bounds)
    draw = ImageDraw.Draw(image)
    width, height = image.size

    if frame_bounds is not None:
        x1, y1, x2, y2 = frame_bounds
        top_left = map_point(x1, y2, bounds=bounds, scale=scale, margin=margin, height=height)
        bottom_right = map_point(x2, y1, bounds=bounds, scale=scale, margin=margin, height=height)
        draw.rectangle([top_left, bottom_right], outline="black", width=3)

    for port in port_data:
        x1, y1, x2, y2 = port["bounds"]
        top_left = map_point(x1, y2, bounds=bounds, scale=scale, margin=margin, height=height)
        bottom_right = map_point(x2, y1, bounds=bounds, scale=scale, margin=margin, height=height)
        draw.rectangle([top_left, bottom_right], outline="black", width=4)

        cx, cy = port["centroid"]
        label_x, label_y = map_point(cx, cy, bounds=bounds, scale=scale, margin=margin, height=height)
        draw.text((label_x + 10, label_y - 12), str(port["port_index"]), fill="black")

        if draw_ground and port["is_ground"]:
            if port["side"] == "left":
                anchor = bottom_right[0], (top_left[1] + bottom_right[1]) / 2
                anchor = (top_left[0], anchor[1])
            elif port["side"] == "right":
                anchor = (bottom_right[0], (top_left[1] + bottom_right[1]) / 2)
            elif port["side"] == "top":
                anchor = ((top_left[0] + bottom_right[0]) / 2, top_left[1])
            else:
                anchor = ((top_left[0] + bottom_right[0]) / 2, bottom_right[1])
            draw_ground_symbol(draw, anchor, str(port["side"]))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def main() -> None:
    args = parse_args()
    # 在启动 L-Edit 前校验节点，配置错误不触发 CAD 导出。
    node = select_process_node(load_process_config(args.process_config), args.process_node)
    runner_python = resolve_runner_python(args.runner_python)
    tdb_path = ensure_exists(args.tdb_path, "L-Edit TDB file")
    export_script = ensure_exists(args.export_script, "DXF export helper script")
    assembly_script = ensure_exists(args.assembly_script, "Assembly drawing helper script")
    function_block_script = ensure_exists(args.function_block_script, "Function block helper script")
    pad_table_script = ensure_exists(args.pad_table_script, "Pad table helper script")
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    ledit_path = args.ledit_exe
    if ledit_path is None or not str(ledit_path).strip():
        env_value = os.environ.get("LEDIT_EXE", "").strip()
        if env_value:
            ledit_path = Path(env_value)
    if ledit_path is None or not str(ledit_path).strip():
        raise FileNotFoundError(
            "L-Edit path not specified. Pass --ledit-exe or set the LEDIT_EXE environment variable."
        )

    dxf_path = export_tdb_to_dxf(
        runner_python=runner_python,
        export_script=export_script,
        tdb_path=tdb_path,
        output_root=output_root,
        ledit_exe=ledit_path,
        force_refresh=args.force_refresh,
    )
    report = analyze_dxf(dxf_path, node)
    report["tdb_path"] = str(tdb_path)
    report["explicit_port_properties_available"] = bool(report["explicit_property_entities_found"])
    frame_bounds = report["dimension_frame"]["bounds"] if report["dimension_frame"] is not None else None

    pad_only_path = output_root / "pad_only_ports.png"
    ground_preview_path = output_root / "pad_only_with_ground.png"
    dimension_path = output_root / "dimension_drawing.png"
    dimension_ground_path = output_root / "dimension_drawing_with_ground.png"
    dimension_ground_numbered_path = output_root / "dimension_drawing_with_ground_numbered.png"
    dimension_ground_numbered_dimensioned_path = output_root / "dimension_drawing_with_ground_numbered_dimensioned.png"
    render_pad_only(report["ports"], pad_only_path, draw_ground=False, frame_bounds=frame_bounds)
    render_pad_only(report["ports"], ground_preview_path, draw_ground=True, frame_bounds=frame_bounds)
    render_formal_dimension_drawing(report, dimension_path, draw_ground=False)
    render_formal_dimension_drawing(report, dimension_ground_path, draw_ground=True)
    render_formal_dimension_drawing(report, dimension_ground_numbered_path, draw_ground=True, draw_numbers=True)
    render_formal_dimension_drawing(
        report,
        dimension_ground_numbered_dimensioned_path,
        draw_ground=True,
        draw_numbers=True,
        draw_dimensions=True,
    )

    report_path = output_root / "pad_ground_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    dimension_scene_path = output_root / "dimension_scene.json"
    save_scene_json(
        build_dimension_scene(
            report,
            model_id=tdb_path.stem,
            draw_ground=True,
            draw_numbers=True,
            draw_dimensions=True,
        ),
        dimension_scene_path,
    )

    run_downstream_asset_scripts(
        runner_python=runner_python,
        assembly_script=assembly_script,
        function_block_script=function_block_script,
        pad_table_script=pad_table_script,
        output_root=output_root,
    )

    ground_ports = [port["port_index"] for port in report["ports"] if port["is_ground"]]
    non_ground_ports = [port["port_index"] for port in report["ports"] if not port["is_ground"]]

    log_text(f"TDB={tdb_path}")
    log_text(f"DXF={dxf_path}")
    log_text(f"PAD_ONLY_IMAGE={pad_only_path}")
    log_text(f"GROUND_PREVIEW_IMAGE={ground_preview_path}")
    log_text(f"DIMENSION_DRAWING={dimension_path}")
    log_text(f"DIMENSION_DRAWING_WITH_GROUND={dimension_ground_path}")
    log_text(f"DIMENSION_DRAWING_WITH_GROUND_NUMBERED={dimension_ground_numbered_path}")
    log_text(f"DIMENSION_DRAWING_WITH_GROUND_NUMBERED_DIMENSIONED={dimension_ground_numbered_dimensioned_path}")
    log_text(f"FUNCTION_BLOCK_DIAGRAM={output_root / 'function_block_diagram.png'}")
    log_text(f"ASSEMBLY_DRAWING={output_root / 'assembly_drawing.png'}")
    log_text(f"PAD_TABLE_XLSX={output_root / f'{tdb_path.stem}_压点信息表.xlsx'}")
    log_text(f"PAD_TABLE_CSV={output_root / f'{tdb_path.stem}_压点信息表.csv'}")
    log_text(f"REPORT={report_path}")
    log_text(f"DIMENSION_SCENE={dimension_scene_path}")
    log_text(f"GROUND_PORTS={ground_ports}")
    log_text(f"NON_GROUND_PORTS={non_ground_ports}")


if __name__ == "__main__":
    main()
