from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from runtime_bootstrap import bootstrap_vendor

bootstrap_vendor(__file__)

from PIL import Image, ImageDraw, ImageFont
from layout_scene_builder import ASSEMBLY_EXTRA_MARGINS, build_assembly_scene, choose_ports, dimension_canvas_spec, save_scene_json


DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "generated_output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render assembly drawing from an existing dimension drawing and DXF/report geometry."
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory containing dimension_drawing_with_ground.png and pad_ground_report.json.",
    )
    parser.add_argument(
        "--base-image",
        type=Path,
        default=None,
        help="Optional explicit dimension image path.",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=None,
        help="Optional explicit pad_ground_report.json path.",
    )
    parser.add_argument(
        "--output-image",
        type=Path,
        default=None,
        help="Optional explicit output assembly image path.",
    )
    return parser.parse_args()


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




def world_to_pixel_mapper(image_size: tuple[int, int], frame_bounds: list[float]):
    frame_x1, frame_y1, frame_x2, frame_y2 = frame_bounds
    canvas_width, canvas_height = image_size
    spec = dimension_canvas_spec({"dimension_frame": {"bounds": frame_bounds}})
    margins = spec["margins"]
    scale = float(spec["scale"])
    margin_left = margins["left"]
    margin_bottom = margins["bottom"]

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px = margin_left + (x - frame_x1) * scale
        py = canvas_height - (margin_bottom + (y - frame_y1) * scale)
        return px, py

    return to_pixel, scale


def port_anchor_pixel(
    port: dict[str, object],
    to_pixel,
    *,
    outer: bool,
) -> tuple[float, float]:
    x1, y1, x2, y2 = [float(value) for value in port["bounds"]]
    side = str(port["side"])
    if side == "left":
        return to_pixel(x1 if outer else x2, (y1 + y2) / 2.0)
    if side == "right":
        return to_pixel(x2 if outer else x1, (y1 + y2) / 2.0)
    if side == "top":
        return to_pixel((x1 + x2) / 2.0, y2 if outer else y1)
    return to_pixel((x1 + x2) / 2.0, y1 if outer else y2)


def draw_resistor_block(
    draw: ImageDraw.ImageDraw,
    port_px: tuple[float, float],
    side: str,
    label: str,
    scale: float,
    font: ImageFont.ImageFont,
) -> None:
    px, py = port_px
    lw = 15
    pad_gap = scale * 72
    block_w = scale * 178
    block_h = scale * 178
    if side == "left":
        x2 = px - pad_gap
        x1 = x2 - block_w
        y1 = py - block_h / 2
        y2 = py + block_h / 2
        draw.rectangle([x1, y1, x2, y2], outline="black", width=lw)
        band_y1 = py - scale * 25
        band_y2 = py + scale * 25
        draw.rectangle([x1, band_y1, x2, band_y2], outline="black", fill="#999900", width=lw)
        draw.line([(x2, py), (px - scale * 10, py - scale * 8), (px + scale * 52, py)], fill="black", width=lw)
        draw.line([(x2, py + scale * 12), (px - scale * 10, py + scale * 5), (px + scale * 52, py + scale * 12)], fill="black", width=lw)
        if label:
            bbox = draw.textbbox((0, 0), label, font=font)
            label_w = bbox[2] - bbox[0]
            label_h = bbox[3] - bbox[1]
            draw.text(
                ((x1 + x2 - label_w) / 2, y1 - label_h - scale * 18),
                label,
                fill="black",
                font=font,
            )
        value_text = "50Ω"
        value_bbox = draw.textbbox((0, 0), value_text, font=font)
        value_w = value_bbox[2] - value_bbox[0]
        draw.text(((x1 + x2 - value_w) / 2, y2 + scale * 18), value_text, fill="black", font=font)
    else:
        x1 = px + pad_gap
        x2 = x1 + block_w
        y1 = py - block_h / 2
        y2 = py + block_h / 2
        draw.rectangle([x1, y1, x2, y2], outline="black", width=lw)
        band_y1 = py - scale * 25
        band_y2 = py + scale * 25
        draw.rectangle([x1, band_y1, x2, band_y2], outline="black", fill="#999900", width=lw)
        draw.line([(x1, py), (px + scale * 10, py - scale * 8), (px - scale * 52, py)], fill="black", width=lw)
        draw.line([(x1, py + scale * 12), (px + scale * 10, py + scale * 5), (px - scale * 52, py + scale * 12)], fill="black", width=lw)
        if label:
            bbox = draw.textbbox((0, 0), label, font=font)
            label_w = bbox[2] - bbox[0]
            label_h = bbox[3] - bbox[1]
            draw.text(
                ((x1 + x2 - label_w) / 2, y1 - label_h - scale * 18),
                label,
                fill="black",
                font=font,
            )
        value_text = "50Ω"
        value_bbox = draw.textbbox((0, 0), value_text, font=font)
        value_w = value_bbox[2] - value_bbox[0]
        draw.text(((x1 + x2 - value_w) / 2, y2 + scale * 18), value_text, fill="black", font=font)


def draw_vd_supply(
    draw: ImageDraw.ImageDraw,
    port_px: tuple[float, float],
    side: str,
    scale: float,
    font: ImageFont.ImageFont,
) -> None:
    px, py = port_px
    lw = 15
    cap_gap = scale * 14
    if side == "bottom":
        # Fixed bottom layout: keep the capacitor/source block below the port.
        cap_y = py + scale * 120
        box_y1 = cap_y + scale * 52
    else:
        cap_y = py - scale * 120
        box_y1 = cap_y - scale * 180

    draw.line([(px - cap_gap, py), (px - cap_gap, cap_y)], fill="black", width=lw)
    draw.line([(px + cap_gap, py), (px + cap_gap, cap_y)], fill="black", width=lw)

    c_x1 = px - scale * 78
    c_x2 = px + scale * 78
    box_y2 = box_y1 + scale * 110
    draw.line([(px - cap_gap, cap_y), (px - cap_gap, box_y1)], fill="black", width=lw)
    draw.line([(px + cap_gap, cap_y), (px + cap_gap, box_y1)], fill="black", width=lw)
    draw.rectangle([c_x1, box_y1, c_x2, box_y2], outline="black", width=lw)
    draw.text((c_x1 + scale * 35, box_y1 + scale * 14), "C", fill="black", font=font)

    v_x1 = c_x2 + scale * 90
    v_x2 = v_x1 + scale * 120
    draw.rectangle([v_x1, box_y1, v_x2, box_y2], outline="black", width=lw)
    draw.text((v_x1 + scale * 22, box_y1 + scale * 14), "Vd", fill="black", font=font)

    draw.arc([c_x2 - scale * 10, box_y1 + scale * 40, v_x1 + scale * 10, box_y1 + scale * 66], 200, 340, fill="black", width=max(2, lw - 1))
    draw.arc([c_x2 - scale * 10, box_y1 + scale * 58, v_x1 + scale * 10, box_y1 + scale * 84], 200, 340, fill="black", width=max(2, lw - 1))
    text_y = box_y1 + scale * 18
    cap_label = "100pF"
    cap_bbox = draw.textbbox((0, 0), cap_label, font=font)
    cap_width = cap_bbox[2] - cap_bbox[0]
    draw.text((c_x1 - scale * 18 - cap_width, text_y), cap_label, fill="black", font=font)
    draw.text((v_x2 + scale * 18, text_y), "+5V", fill="black", font=font)


def draw_port_name(
    draw: ImageDraw.ImageDraw,
    name: str,
    center: tuple[float, float],
    font: ImageFont.ImageFont,
) -> None:
    px, py = center
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.text((px - text_w / 2, py - text_h / 2), name, fill="black", font=font)


def render_assembly(base_image: Path, report_json: Path, output_path: Path) -> None:
    report = json.loads(report_json.read_text(encoding="utf-8"))
    frame_bounds = report["dimension_frame"]["bounds"]
    roles = choose_ports(report)
    vd_ports = list(roles.get("Vd_ports", [roles["Vd"]]))
    base = Image.open(base_image).convert("RGB")
    # Match the hand-adjusted assembly layout while preserving canvas width.
    extra_left = ASSEMBLY_EXTRA_MARGINS["left"]
    extra_right = ASSEMBLY_EXTRA_MARGINS["right"]
    extra_top = ASSEMBLY_EXTRA_MARGINS["top"]
    extra_bottom = (
        ASSEMBLY_EXTRA_MARGINS["bottom_bottom"]
        if any(str(port["side"]) == "bottom" for port in vd_ports)
        else ASSEMBLY_EXTRA_MARGINS["bottom_other"]
    )
    image = Image.new(
        "RGB",
        (base.width + extra_left + extra_right, base.height + extra_top + extra_bottom),
        "white",
    )
    image.paste(base, (extra_left, extra_top))
    draw = ImageDraw.Draw(image)
    base_to_pixel, scale = world_to_pixel_mapper(base.size, frame_bounds)

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px, py = base_to_pixel(x, y)
        return px + extra_left, py + extra_top

    role_font = load_font(150)
    vd_font = load_font(150)
    port_font = load_font(150)

    in_px = port_anchor_pixel(roles["RFin"], to_pixel, outer=True)
    out_px = port_anchor_pixel(roles["RFout"], to_pixel, outer=True)
    in_inner_px = port_anchor_pixel(roles["RFin"], to_pixel, outer=False)
    out_inner_px = port_anchor_pixel(roles["RFout"], to_pixel, outer=False)

    draw_resistor_block(draw, in_px, str(roles["RFin"]["side"]), "RFin", scale, role_font)
    draw_resistor_block(draw, out_px, str(roles["RFout"]["side"]), "RFout", scale, role_font)
    draw_port_name(draw, "RFin", (in_inner_px[0] + scale * 90, in_inner_px[1]), port_font)
    draw_port_name(draw, "RFout", (out_inner_px[0] - scale * 145, out_inner_px[1]), port_font)
    for vd_index, vd_port in enumerate(vd_ports, start=1):
        vd_px = port_anchor_pixel(vd_port, to_pixel, outer=True)
        vd_inner_px = port_anchor_pixel(vd_port, to_pixel, outer=False)
        vd_name = "Vd" if len(vd_ports) == 1 else f"Vd{vd_index}"
        draw_vd_supply(draw, vd_px, str(vd_port["side"]), scale, vd_font)
        side = str(vd_port["side"])
        if side == "left":
            label_center = (vd_inner_px[0] + scale * 170, vd_inner_px[1] - scale * 72)
        elif side == "right":
            label_center = (vd_inner_px[0] - scale * 170, vd_inner_px[1] - scale * 72)
        elif side == "top":
            label_center = (vd_inner_px[0], vd_inner_px[1] + scale * 150)
        else:
            label_center = (vd_inner_px[0], vd_inner_px[1] - scale * 110)
        draw_port_name(draw, vd_name, label_center, port_font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def main() -> None:
    args = parse_args()
    output_root = args.output_root.resolve()
    base_image = args.base_image.resolve() if args.base_image else output_root / "dimension_drawing_with_ground.png"
    report_json = args.report_json.resolve() if args.report_json else output_root / "pad_ground_report.json"
    output_image = args.output_image.resolve() if args.output_image else output_root / "assembly_drawing.png"
    render_assembly(base_image, report_json, output_image)
    report = json.loads(report_json.read_text(encoding="utf-8"))
    assembly_scene_path = output_root / "assembly_scene.json"
    save_scene_json(build_assembly_scene(report, model_id=Path(str(report.get("dxf_path", output_root.name))).stem), assembly_scene_path)
    print(f"ASSEMBLY_IMAGE={output_image}")
    print(f"ASSEMBLY_SCENE={assembly_scene_path}")


if __name__ == "__main__":
    main()
