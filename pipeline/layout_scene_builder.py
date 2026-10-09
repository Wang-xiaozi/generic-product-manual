from __future__ import annotations

import json
import math
from pathlib import Path

import ezdxf
from shapely.geometry import Polygon


SCENE_SCHEMA = "layout-scene-v1"
# Keep the output canvas safely padded so edge labels stay fully visible in PDF export.
DIMENSION_CANVAS_MARGINS = {"left": 420, "right": 420, "top": 200, "bottom": 180}
ASSEMBLY_EXTRA_MARGINS = {"left": 180, "right": 320, "top": 100, "bottom_bottom": 360, "bottom_other": 160}


def polygon_from_polyline(entity) -> Polygon | None:
    points = []
    for vertex in entity.vertices:
        location = getattr(vertex.dxf, "location", None)
        if location is None:
            continue
        points.append((float(location.x), float(location.y)))
    if len(points) < 3:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    polygon = Polygon(points)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    return None if polygon.is_empty else polygon


def detect_io_sides_from_via2(dxf_path: Path, frame_bounds: list[float]) -> dict[str, str]:
    doc = ezdxf.readfile(dxf_path)
    modelspace = doc.modelspace()
    frame_x1, frame_y1, frame_x2, frame_y2 = frame_bounds
    frame_cx = (frame_x1 + frame_x2) / 2.0
    frame_area = (frame_x2 - frame_x1) * (frame_y2 - frame_y1)

    via2_polys = []
    for entity in modelspace:
        if entity.dxftype() != "POLYLINE" or entity.dxf.layer.lower() != "via2":
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


def choose_ports(report: dict[str, object]) -> dict[str, dict[str, object]]:
    ports = list(report.get("physical_ports", report["ports"]))
    role_info = report.get("port_roles") or {}
    port_by_index = {int(port["port_index"]): port for port in ports}

    rfin = port_by_index.get(int(role_info["RFin"])) if role_info.get("RFin") is not None else None
    rfout = port_by_index.get(int(role_info["RFout"])) if role_info.get("RFout") is not None else None
    vd_port = port_by_index.get(int(role_info["Vd"])) if role_info.get("Vd") is not None else None
    vd_ports = [
        port_by_index[int(port_index)]
        for port_index in role_info.get("Vd_ports", [])
        if int(port_index) in port_by_index
    ]

    if rfin is None or rfout is None:
        raise RuntimeError("Unable to locate RFin/RFout ports from report port_roles.")
    if vd_port is None:
        raise RuntimeError("Unable to identify Vd port from report port_roles.")

    if not vd_ports:
        vd_ports = [vd_port]

    return {"RFin": rfin, "RFout": rfout, "Vd": vd_port, "Vd_ports": vd_ports}


def sort_ports_clockwise_from_lower_left(ports: list[dict[str, object]], frame_bounds: list[float]) -> list[dict[str, object]]:
    frame_x1, frame_y1, frame_x2, frame_y2 = [float(value) for value in frame_bounds]

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

    ordered = left_ports + top_ports + right_ports + bottom_ports
    assigned_ids = {id(port) for port in ordered}
    unassigned = [port for port in ports if id(port) not in assigned_ids]

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


def collect_dimension_annotations(
    report: dict[str, object],
    ports: list[dict[str, object]],
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
        "top": {"y": frame_y2, "value": top_value},
        "right": {"x": frame_x2, "value": right_value},
        "vd": None if vd_port is None else {"x": float(vd_port["centroid"][0]), "value": float(vd_port["centroid"][0]) - origin_x},
        "left_signal": None if left_signal_port is None else {"y": float(left_signal_port["centroid"][1]), "value": float(left_signal_port["centroid"][1]) - origin_y},
        "right_signal": None if right_signal_port is None else {"y": float(right_signal_port["centroid"][1]), "value": float(right_signal_port["centroid"][1]) - origin_y},
    }


def format_dimension_value(value: float) -> str:
    return str(int(round(value)))


def dimension_canvas_spec(report: dict[str, object]) -> dict[str, object]:
    frame_bounds = report["dimension_frame"]["bounds"]
    frame_x1, frame_y1, frame_x2, frame_y2 = [float(value) for value in frame_bounds]
    frame_width = frame_x2 - frame_x1
    frame_height = frame_y2 - frame_y1
    scale = 2.1
    margins = dict(DIMENSION_CANVAS_MARGINS)
    # Dimension labels sit outside the chip frame. Size the canvas for the
    # longest side label and the complete text below the bottom tick.
    label_size = 150
    tick_and_gap = scale * (38 + 12)
    side_label_length = len(format_dimension_value(frame_height))
    side_margin = math.ceil(tick_and_gap + side_label_length * label_size * 0.8 + 60)
    margins["left"] = max(margins["left"], side_margin)
    margins["right"] = max(margins["right"], side_margin)
    margins["bottom"] = max(margins["bottom"], math.ceil(tick_and_gap + label_size * 1.2 + 60))
    canvas_width = int(round(frame_width * scale + margins["left"] + margins["right"]))
    canvas_height = int(round(frame_height * scale + margins["top"] + margins["bottom"]))

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px = margins["left"] + (x - frame_x1) * scale
        py = canvas_height - (margins["bottom"] + (y - frame_y1) * scale)
        return px, py

    return {
        "frame_bounds": [frame_x1, frame_y1, frame_x2, frame_y2],
        "frame_width": frame_width,
        "frame_height": frame_height,
        "scale": scale,
        "margins": margins,
        "canvas_width": canvas_width,
        "canvas_height": canvas_height,
        "to_pixel": to_pixel,
    }


def _rect_element(*, element_id: str, role: str, x: float, y: float, width: float, height: float, stroke_width: float, stroke: str = "#000000", fill: str = "none", meta: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "id": element_id,
        "kind": "rect",
        "role": role,
        "x": round(x, 3),
        "y": round(y, 3),
        "width": round(width, 3),
        "height": round(height, 3),
        "stroke": stroke,
        "fill": fill,
        "stroke_width": round(stroke_width, 3),
        "editable": {"position": True, "size": True, "text": False},
        "meta": meta or {},
    }


def _text_element(*, element_id: str, role: str, x: float, y: float, text: str, font_size: float, anchor: str = "start", meta: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "id": element_id,
        "kind": "text",
        "role": role,
        "x": round(x, 3),
        "y": round(y, 3),
        "text": text,
        "font_size": round(font_size, 3),
        "text_anchor": anchor,
        "editable": {"position": True, "size": False, "text": True},
        "meta": meta or {},
    }


def _ground_symbol_element(*, element_id: str, x: float, y: float, side: str, placement: str, scale: float, port_index: int) -> dict[str, object]:
    return {
        "id": element_id,
        "kind": "ground_symbol",
        "role": "ground_symbol",
        "x": round(x, 3),
        "y": round(y, 3),
        "side": side,
        "placement": placement,
        "scale": 5.0,
        "stroke_width": 15.0,
        "editable": {"position": True, "size": True, "text": False},
        "meta": {"port_index": port_index},
    }


def _dimension_label_element(
    *,
    element_id: str,
    role: str,
    orientation: str,
    x: float,
    y: float,
    text: str,
    stroke_width: float,
    tick_length: float,
    text_gap: float,
    font_size: float,
) -> dict[str, object]:
    return {
        "id": element_id,
        "kind": "dimension_label",
        "role": role,
        "orientation": orientation,
        "x": round(x, 3),
        "y": round(y, 3),
        "text": text,
        "stroke_width": round(stroke_width, 3),
        "tick_length": round(tick_length, 3),
        "text_gap": round(text_gap, 3),
        "font_size": round(font_size, 3),
        "editable": {"position": True, "size": False, "text": True},
        "meta": {},
    }


def _polyline_element(
    *,
    element_id: str,
    role: str,
    points: list[tuple[float, float]],
    stroke_width: float,
    stroke: str = "#000000",
    fill: str = "none",
    meta: dict[str, object] | None = None,
) -> dict[str, object]:
    if not points:
        raise ValueError("Polyline element requires at least one point.")
    origin_x, origin_y = points[0]
    relative_points = [[round(px - origin_x, 3), round(py - origin_y, 3)] for px, py in points]
    return {
        "id": element_id,
        "kind": "polyline",
        "role": role,
        "x": round(origin_x, 3),
        "y": round(origin_y, 3),
        "points": relative_points,
        "stroke": stroke,
        "fill": fill,
        "stroke_width": round(stroke_width, 3),
        "editable": {"position": True, "size": False, "text": False},
        "meta": meta or {},
    }


def _amplifier_block_element(
    *,
    element_id: str,
    x: float,
    y: float,
    width: float,
    height: float,
    label: str,
    font_size: float,
    stroke_width: float,
    label_x: float | None = None,
    label_y: float | None = None,
    meta: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": element_id,
        "kind": "amplifier_block",
        "role": "amplifier_block",
        "x": round(x, 3),
        "y": round(y, 3),
        "width": round(width, 3),
        "height": round(height, 3),
        "label": label,
        "font_size": round(font_size, 3),
        "label_x": None if label_x is None else round(label_x, 3),
        "label_y": None if label_y is None else round(label_y, 3),
        "stroke": "#000000",
        "fill": "#ffffff",
        "stroke_width": round(stroke_width, 3),
        "editable": {"position": True, "size": True, "text": True},
        "meta": meta or {},
    }


def _port_inner_anchor_pixel(
    port: dict[str, object],
    to_pixel,
) -> tuple[float, float]:
    x1, y1, x2, y2 = [float(value) for value in port["bounds"]]
    side = str(port["side"])
    if side == "left":
        return to_pixel(x2, (y1 + y2) / 2.0)
    if side == "right":
        return to_pixel(x1, (y1 + y2) / 2.0)
    if side == "top":
        return to_pixel((x1 + x2) / 2.0, y1)
    return to_pixel((x1 + x2) / 2.0, y2)


def _port_outer_anchor_pixel(
    port: dict[str, object],
    to_pixel,
) -> tuple[float, float]:
    x1, y1, x2, y2 = [float(value) for value in port["bounds"]]
    side = str(port["side"])
    if side == "left":
        return to_pixel(x1, (y1 + y2) / 2.0)
    if side == "right":
        return to_pixel(x2, (y1 + y2) / 2.0)
    if side == "top":
        return to_pixel((x1 + x2) / 2.0, y2)
    return to_pixel((x1 + x2) / 2.0, y1)


def function_block_geometry(report: dict[str, object]) -> dict[str, object]:
    spec = dimension_canvas_spec(report)
    to_pixel = spec["to_pixel"]
    scale = float(spec["scale"])
    roles = choose_ports(report)
    frame_x1, frame_y1, frame_x2, frame_y2 = [float(value) for value in spec["frame_bounds"]]

    in_anchor = _port_inner_anchor_pixel(roles["RFin"], to_pixel)
    out_anchor = _port_inner_anchor_pixel(roles["RFout"], to_pixel)
    vd_anchor = _port_inner_anchor_pixel(roles["Vd"], to_pixel)
    in_outer_anchor = _port_outer_anchor_pixel(roles["RFin"], to_pixel)
    out_outer_anchor = _port_outer_anchor_pixel(roles["RFout"], to_pixel)
    vd_ports = list(roles.get("Vd_ports", [roles["Vd"]]))
    vd_anchors = [
        {
            "port": port,
            "anchor": _port_inner_anchor_pixel(port, to_pixel),
            "outer_anchor": _port_outer_anchor_pixel(port, to_pixel),
            "side": str(port["side"]),
        }
        for port in vd_ports
    ]
    vd_side = "bottom" if any(item["side"] == "bottom" for item in vd_anchors) else str(roles["Vd"]["side"])

    diagram_zoom = 2.0
    amp_width = scale * 430 * diagram_zoom
    amp_height = scale * 320 * diagram_zoom
    amp_half_w = amp_width / 2.0
    amp_half_h = amp_height / 2.0
    amp_center_x, _ = to_pixel((frame_x1 + frame_x2) / 2.0, (frame_y1 + frame_y2) / 2.0)
    amp_center_y = (in_anchor[1] + out_anchor[1]) / 2.0
    amp_center_x = vd_anchor[0]
    amp_center = (amp_center_x, amp_center_y)

    input_contact = (amp_center_x - amp_half_w, amp_center_y)
    output_contact = (amp_center_x + amp_half_w, amp_center_y)
    top_contact = (amp_center_x, amp_center_y - amp_half_h / 2.0)
    bottom_contact = (amp_center_x, amp_center_y + amp_half_h / 2.0)
    vd_contact = top_contact if vd_side == "top" else bottom_contact

    amp_label = (amp_center_x, amp_center_y - amp_half_h - scale * 18 * diagram_zoom)
    vd_label_positions = []
    for vd_info in vd_anchors:
        anchor = vd_info["anchor"]
        side = vd_info["side"]
        if side == "right":
            label_x = anchor[0] - scale * 35 * diagram_zoom
            label_y = anchor[1] - scale * 20 * diagram_zoom
            label_anchor = "end"
        elif side == "bottom":
            label_x = anchor[0] + scale * 95 * diagram_zoom
            label_y = anchor[1] - scale * 8
            label_anchor = "start"
        else:
            label_x = anchor[0] + scale * 35 * diagram_zoom
            label_y = anchor[1] + scale * 20 * diagram_zoom
            label_anchor = "start"
        vd_label_positions.append({
            "label": (label_x, label_y),
            "anchor": label_anchor,
            "port_index": int(vd_info["port"]["port_index"]),
        })

    rfout_label = _port_inner_anchor_pixel(roles["RFout"], to_pixel)
    rfout_label = (rfout_label[0] - scale * 145, rfout_label[1] - scale * 72)

    return {
        "spec": spec,
        "roles": roles,
        "scale": scale,
        "line_width": 15.0,
        "title_font_size": 150.0,
        "port_font_size": 150.0,
        "amp_label": amp_label,
        "amp_center": amp_center,
        "amp_width": amp_width,
        "amp_height": amp_height,
        "amp_input_contact": input_contact,
        "amp_output_contact": output_contact,
        "amp_top_contact": top_contact,
        "amp_bottom_contact": bottom_contact,
        "vd_contact": vd_contact,
        "in_anchor": in_anchor,
        "out_anchor": out_anchor,
        "rfout_label": rfout_label,
        "vd_anchor": vd_anchor,
        "in_outer_anchor": in_outer_anchor,
        "out_outer_anchor": out_outer_anchor,
        "vd_anchors": vd_anchors,
        "vd_label_positions": vd_label_positions,
        "vd_side": vd_side,
    }


def build_dimension_scene(
    report: dict[str, object],
    *,
    model_id: str | None = None,
    draw_ground: bool = True,
    draw_numbers: bool = True,
    draw_dimensions: bool = True,
) -> dict[str, object]:
    spec = dimension_canvas_spec(report)
    ports = list(report.get("physical_ports", report["ports"]))
    frame_x1, frame_y1, frame_x2, frame_y2 = spec["frame_bounds"]
    frame_mid_x = (frame_x1 + frame_x2) / 2.0
    frame_mid_y = (frame_y1 + frame_y2) / 2.0
    scale = float(spec["scale"])
    frame_line_width = 15.0
    extension_width = 15.0
    tick_length = scale * 38
    text_gap = scale * 12
    number_font_size = 150.0
    dimension_font_size = 150.0
    to_pixel = spec["to_pixel"]

    elements: list[dict[str, object]] = []
    frame_top_left = to_pixel(frame_x1, frame_y2)
    frame_bottom_right = to_pixel(frame_x2, frame_y1)
    elements.append(
        _rect_element(
            element_id="chip-frame",
            role="chip_frame",
            x=frame_top_left[0],
            y=frame_top_left[1],
            width=frame_bottom_right[0] - frame_top_left[0],
            height=frame_bottom_right[1] - frame_top_left[1],
            stroke_width=frame_line_width,
        )
    )

    for port in ports:
        x1, y1, x2, y2 = [float(value) for value in port["bounds"]]
        top_left = to_pixel(x1, y2)
        bottom_right = to_pixel(x2, y1)
        port_index = int(port["port_index"])
        elements.append(
            _rect_element(
                element_id=f"port-{port_index}",
                role="port",
                x=top_left[0],
                y=top_left[1],
                width=bottom_right[0] - top_left[0],
                height=bottom_right[1] - top_left[1],
                stroke_width=frame_line_width,
                meta={
                    "port_index": port_index,
                    "side": str(port["side"]),
                    "is_ground": bool(port.get("is_ground", False)),
                    "centroid": [float(port["centroid"][0]), float(port["centroid"][1])],
                },
            )
        )

        if draw_ground and bool(port.get("is_ground", False)):
            _, cy = [float(value) for value in port["centroid"]]
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
            elements.append(
                _ground_symbol_element(
                    element_id=f"ground-{port_index}",
                    x=anchor[0],
                    y=anchor[1],
                    side=str(port["side"]),
                    placement=placement,
                    scale=scale,
                    port_index=port_index,
                )
            )

    if draw_numbers:
        ordered_ports = sort_ports_clockwise_from_lower_left(list(ports), report["dimension_frame"]["bounds"])
        for number, port in enumerate(ordered_ports, start=1):
            port_index = int(port["port_index"])
            world_x, world_y = get_port_number_position(port, scale=scale, frame_mid_x=frame_mid_x, frame_mid_y=frame_mid_y)
            px, py = to_pixel(world_x, world_y)
            elements.append(
                _text_element(
                    element_id=f"port-number-{port_index}",
                    role="port_number",
                    x=px,
                    y=py,
                    text=str(number),
                    font_size=number_font_size,
                    anchor="middle",
                    meta={"port_index": port_index},
                )
            )

    if draw_dimensions:
        dimensions = collect_dimension_annotations(report, list(ports))
        frame_left_x = frame_top_left[0]
        frame_right_x = frame_bottom_right[0]
        frame_top_y = frame_top_left[1]
        frame_bottom_y = frame_bottom_right[1]

        elements.append(
            _text_element(
                element_id="dimension-origin",
                role="dimension_origin",
                x=frame_left_x - tick_length - text_gap - scale * 18,
                y=frame_bottom_y,
                text=format_dimension_value(0),
                font_size=dimension_font_size,
                anchor="end",
            )
        )
        elements.append(
            _dimension_label_element(
                element_id="dimension-top",
                role="dimension_top",
                orientation="left",
                x=frame_left_x,
                y=frame_top_y,
                text=format_dimension_value(float(dimensions["top"]["value"])),
                stroke_width=extension_width,
                tick_length=tick_length,
                text_gap=text_gap,
                font_size=dimension_font_size,
            )
        )
        elements.append(
            _dimension_label_element(
                element_id="dimension-right",
                role="dimension_right",
                orientation="bottom",
                x=frame_right_x,
                y=frame_bottom_y,
                text=format_dimension_value(float(dimensions["right"]["value"])),
                stroke_width=extension_width,
                tick_length=tick_length,
                text_gap=text_gap,
                font_size=dimension_font_size,
            )
        )

        vd_dimension = dimensions["vd"]
        if isinstance(vd_dimension, dict):
            vd_x_px, _ = to_pixel(float(vd_dimension["x"]), frame_y1)
            elements.append(
                _dimension_label_element(
                    element_id="dimension-vd",
                    role="dimension_vd",
                    orientation="bottom",
                    x=vd_x_px,
                    y=frame_bottom_y,
                    text=format_dimension_value(float(vd_dimension["value"])),
                    stroke_width=extension_width,
                    tick_length=tick_length,
                    text_gap=text_gap,
                    font_size=dimension_font_size,
                )
            )

        left_signal = dimensions["left_signal"]
        if isinstance(left_signal, dict):
            _, y_px = to_pixel(frame_x1, float(left_signal["y"]))
            elements.append(
                _dimension_label_element(
                    element_id="dimension-left-signal",
                    role="dimension_left_signal",
                    orientation="left",
                    x=frame_left_x,
                    y=y_px,
                    text=format_dimension_value(float(left_signal["value"])),
                    stroke_width=extension_width,
                    tick_length=tick_length,
                    text_gap=text_gap,
                    font_size=dimension_font_size,
                )
            )

        right_signal = dimensions["right_signal"]
        if isinstance(right_signal, dict):
            _, y_px = to_pixel(frame_x2, float(right_signal["y"]))
            elements.append(
                _dimension_label_element(
                    element_id="dimension-right-signal",
                    role="dimension_right_signal",
                    orientation="right",
                    x=frame_right_x,
                    y=y_px,
                    text=format_dimension_value(float(right_signal["value"])),
                    stroke_width=extension_width,
                    tick_length=tick_length,
                    text_gap=text_gap,
                    font_size=dimension_font_size,
                )
            )

    return {
        "schema": SCENE_SCHEMA,
        "scene_type": "dimension",
        "model_id": model_id or Path(str(report.get("dxf_path", "unknown"))).stem,
        "canvas": {
            "width": spec["canvas_width"],
            "height": spec["canvas_height"],
            "background": "#ffffff",
        },
        "meta": {
            "frame_bounds": spec["frame_bounds"],
            "scale": scale,
            "margins": spec["margins"],
            "draw_ground": draw_ground,
            "draw_numbers": draw_numbers,
            "draw_dimensions": draw_dimensions,
        },
        "elements": elements,
    }


def _assembly_canvas_spec(report: dict[str, object]) -> dict[str, object]:
    dimension_spec = dimension_canvas_spec(report)
    roles = choose_ports(report)
    # Keep the chip centered like the hand-adjusted assembly reference.
    extra_left = ASSEMBLY_EXTRA_MARGINS["left"]
    extra_right = ASSEMBLY_EXTRA_MARGINS["right"]
    extra_top = ASSEMBLY_EXTRA_MARGINS["top"]
    vd_ports = list(roles.get("Vd_ports", [roles["Vd"]]))
    extra_bottom = ASSEMBLY_EXTRA_MARGINS["bottom_bottom"] if any(str(port["side"]) == "bottom" for port in vd_ports) else ASSEMBLY_EXTRA_MARGINS["bottom_other"]
    return {
        "base": dimension_spec,
        "roles": roles,
        "extra_left": extra_left,
        "extra_right": extra_right,
        "extra_top": extra_top,
        "extra_bottom": extra_bottom,
        "canvas_width": int(dimension_spec["canvas_width"] + extra_left + extra_right),
        "canvas_height": int(dimension_spec["canvas_height"] + extra_top + extra_bottom),
    }


def build_assembly_scene(report: dict[str, object], *, model_id: str | None = None) -> dict[str, object]:
    assembly_spec = _assembly_canvas_spec(report)
    base_spec = assembly_spec["base"]
    roles = assembly_spec["roles"]
    to_base_pixel = base_spec["to_pixel"]
    scale = float(base_spec["scale"])
    # Keep generated assembly text consistent with the editable SVG defaults.
    role_font_size = 150.0
    vd_font_size = 150.0
    port_font_size = 150.0
    frame_x1, frame_y1, frame_x2, frame_y2 = base_spec["frame_bounds"]
    base_scene = build_dimension_scene(report, model_id=model_id, draw_ground=True, draw_numbers=False, draw_dimensions=False)

    def offset_element(element: dict[str, object]) -> dict[str, object]:
        clone = json.loads(json.dumps(element))
        if "x" in clone:
            clone["x"] = round(float(clone["x"]) + assembly_spec["extra_left"], 3)
        if "y" in clone:
            clone["y"] = round(float(clone["y"]) + assembly_spec["extra_top"], 3)
        return clone

    elements = [offset_element(element) for element in base_scene["elements"]]

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px, py = to_base_pixel(x, y)
        return px + assembly_spec["extra_left"], py + assembly_spec["extra_top"]

    role_ports = [("RFin", roles["RFin"]), ("RFout", roles["RFout"])]
    vd_ports = list(roles.get("Vd_ports", [roles["Vd"]]))
    role_ports.extend([("Vd", port) for port in vd_ports])

    for vd_order, (role_name, port) in enumerate(role_ports):
        cx, cy = [float(value) for value in port["centroid"]]
        px, py = to_pixel(cx, cy)
        inner_px, inner_py = _port_inner_anchor_pixel(port, to_pixel)
        outer_px, outer_py = _port_outer_anchor_pixel(port, to_pixel)
        side = str(port["side"])
        port_index = int(port["port_index"])

        if role_name in {"RFin", "RFout"}:
            elements.append(
                {
                    "id": f"assembly-{role_name.lower()}-resistor",
                    "kind": "resistor_block",
                    "role": role_name.lower(),
                    "x": round(outer_px, 3),
                    "y": round(outer_py, 3),
                    "side": side,
                    "label": role_name,
                    "value_text": "50" + chr(937),
                    "scale": round(scale, 3),
                    "font_size": role_font_size,
                    "editable": {"position": True, "size": True, "text": True},
                    "meta": {"port_index": port_index},
                }
            )
            if side == "left":
                text_x, text_y = inner_px + scale * 90, inner_py
            elif side == "right":
                text_x, text_y = inner_px - scale * 190, inner_py
            elif side == "top":
                text_x, text_y = inner_px, inner_py + scale * 150
            else:
                text_x, text_y = inner_px, inner_py - scale * 110
            elements.append(
                _text_element(
                    element_id=f"assembly-{role_name.lower()}-name",
                    role=f"{role_name.lower()}_name",
                    x=text_x,
                    y=text_y,
                    text=role_name,
                    font_size=port_font_size,
                    anchor="middle",
                    meta={"port_index": port_index},
                )
            )
        else:
            vd_id_suffix = "" if vd_order == 2 else f"-{port_index}"
            elements.append(
                {
                    "id": f"assembly-vd-supply{vd_id_suffix}",
                    "kind": "vd_supply",
                    "role": "vd_supply",
                    "x": round(outer_px, 3),
                    "y": round(outer_py, 3),
                    "side": side,
                    "scale": round(scale, 3),
                    "font_size": vd_font_size,
                    "capacitor_text": "100pF",
                    "box_text": "C",
                    "source_text": "Vd",
                    "voltage_text": "+5V",
                    "editable": {"position": True, "size": True, "text": True},
                    "meta": {"port_index": port_index},
                }
            )
            if side == "left":
                text_x, text_y = inner_px + scale * 170, inner_py - scale * 72
            elif side == "right":
                text_x, text_y = inner_px - scale * 170, inner_py - scale * 72
            elif side == "top":
                text_x, text_y = inner_px, inner_py + scale * 150
            else:
                text_x, text_y = inner_px, inner_py - scale * 110
            elements.append(
                _text_element(
                    element_id=f"assembly-vd-name{vd_id_suffix}",
                    role="vd_name",
                    x=text_x,
                    y=text_y,
                    text="Vd" if len(vd_ports) == 1 else f"Vd{vd_ports.index(port) + 1}",
                    font_size=port_font_size,
                    anchor="middle",
                    meta={"port_index": port_index},
                )
            )

    return {
        "schema": SCENE_SCHEMA,
        "scene_type": "assembly",
        "model_id": model_id or Path(str(report.get("dxf_path", "unknown"))).stem,
        "canvas": {
            "width": assembly_spec["canvas_width"],
            "height": assembly_spec["canvas_height"],
            "background": "#ffffff",
        },
        "meta": {
            "frame_bounds": [frame_x1, frame_y1, frame_x2, frame_y2],
            "scale": scale,
            "base_canvas": {
                "width": base_spec["canvas_width"],
                "height": base_spec["canvas_height"],
            },
            "offsets": {
                "left": assembly_spec["extra_left"],
                "right": assembly_spec["extra_right"],
                "top": assembly_spec["extra_top"],
                "bottom": assembly_spec["extra_bottom"],
            },
        },
        "elements": elements,
    }


def build_function_block_scene(report: dict[str, object], *, model_id: str | None = None) -> dict[str, object]:
    geometry = function_block_geometry(report)
    spec = geometry["spec"]
    scale = float(geometry["scale"])
    line_width = float(geometry["line_width"])
    title_font_size = float(geometry["title_font_size"])
    port_font_size = 150.0
    roles = geometry["roles"]

    base_scene = build_dimension_scene(
        report,
        model_id=model_id,
        draw_ground=True,
        draw_numbers=False,
        draw_dimensions=False,
    )
    elements = json.loads(json.dumps(base_scene["elements"]))

    in_px = geometry["in_anchor"]
    out_px = geometry["out_anchor"]
    in_outer_px = geometry["in_outer_anchor"]
    out_outer_px = geometry["out_outer_anchor"]
    vd_anchors = list(geometry.get("vd_anchors", []))
    amp_center = geometry["amp_center"]
    amp_width = float(geometry["amp_width"])
    amp_height = float(geometry["amp_height"])
    amp_input_contact = geometry["amp_input_contact"]
    amp_output_contact = geometry["amp_output_contact"]
    vd_contact = geometry["vd_contact"]
    amp_label = geometry["amp_label"]

    elements.append(
        _amplifier_block_element(
            element_id="function-amp",
            x=amp_center[0],
            y=amp_center[1],
            width=amp_width,
            height=amp_height,
            label="AMP",
            font_size=port_font_size,
            stroke_width=line_width,
            label_x=amp_label[0],
            label_y=amp_label[1],
        )
    )
    elements.append(
        _polyline_element(
            element_id="function-rfin-wire",
            role="rfin_wire",
            points=[in_px, amp_input_contact],
            stroke_width=line_width,
            meta={"port_index": int(roles["RFin"]["port_index"])},
        )
    )
    elements.append(
        _polyline_element(
            element_id="function-rfout-wire",
            role="rfout_wire",
            points=[amp_output_contact, out_px],
            stroke_width=line_width,
            meta={"port_index": int(roles["RFout"]["port_index"])},
        )
    )
    for vd_index, vd_info in enumerate(vd_anchors, start=1):
        anchor = vd_info["anchor"]
        port = vd_info["port"]
        label_info = geometry["vd_label_positions"][vd_index - 1]
        label_text = "Vd" if len(vd_anchors) == 1 else f"Vd{vd_index}"
        suffix = "" if vd_index == 1 else f"-{int(port['port_index'])}"
        elements.append(
            _polyline_element(
                element_id=f"function-vd-wire{suffix}",
                role="vd_wire",
                points=[anchor, (anchor[0], vd_contact[1]), vd_contact],
                stroke_width=line_width,
                meta={"port_index": int(port["port_index"])},
            )
        )
        elements.append(
            _text_element(
                element_id=f"function-vd-label{suffix}",
                role="vd_name",
                x=label_info["label"][0],
                y=label_info["label"][1],
                text=label_text,
                font_size=port_font_size,
                anchor=label_info["anchor"],
                meta={"port_index": int(port["port_index"])},
            )
        )
    elements.append(
        _text_element(
            element_id="function-rfin-label",
            role="rfin_name",
            x=in_px[0] + scale * 170,
            y=in_px[1] - scale * 72,
            text="RFin",
            font_size=port_font_size,
            anchor="middle",
            meta={"port_index": int(roles["RFin"]["port_index"])},
        )
    )
    rfout_label = geometry["rfout_label"]
    elements.append(
        _text_element(
            element_id="function-rfout-label",
            role="rfout_name",
            x=rfout_label[0],
            y=rfout_label[1],
            text="RFout",
            font_size=port_font_size,
            anchor="middle",
            meta={"port_index": int(roles["RFout"]["port_index"])},
        )
    )

    def element_bounds(element: dict[str, object]) -> tuple[float, float, float, float] | None:
        kind = element.get("kind")
        x = float(element.get("x", 0.0))
        y = float(element.get("y", 0.0))
        if kind in {"rect", "amplifier_block", "ground_symbol", "text", "dimension_label"}:
            width = float(element.get("width", 0.0))
            height = float(element.get("height", 0.0))
            return (x, y, x + width, y + height)
        if kind == "polyline":
            points = [[x + float(dx), y + float(dy)] for dx, dy in element.get("points", [])]
            if not points:
                return None
            xs = [pt[0] for pt in points]
            ys = [pt[1] for pt in points]
            return (min(xs), min(ys), max(xs), max(ys))
        return None

    margin = 120.0
    bounds = []
    for element in elements:
        item_bounds = element_bounds(element)
        if item_bounds is not None:
            bounds.append(item_bounds)
    min_x = min(bound[0] for bound in bounds) - margin
    min_y = min(bound[1] for bound in bounds) - margin
    max_x = max(bound[2] for bound in bounds) + margin
    max_y = max(bound[3] for bound in bounds) + margin

    for element in elements:
        if "x" in element:
            element["x"] = round(float(element["x"]) - min_x, 3)
        if "y" in element:
            element["y"] = round(float(element["y"]) - min_y, 3)

    width = int(round(max_x - min_x))
    height = int(round(max_y - min_y))

    return {
        "schema": SCENE_SCHEMA,
        "scene_type": "function_block",
        "model_id": model_id or Path(str(report.get("dxf_path", "unknown"))).stem,
        "canvas": {
            "width": width,
            "height": height,
            "background": "#ffffff",
        },
        "meta": {
            "frame_bounds": spec["frame_bounds"],
            "scale": scale,
            "margins": spec["margins"],
            "content_bounds": [round(min_x, 3), round(min_y, 3), round(max_x, 3), round(max_y, 3)],
        },
        "elements": elements,
    }


def save_scene_json(scene: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(scene, ensure_ascii=False, indent=2), encoding="utf-8")
