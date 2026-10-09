from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from runtime_bootstrap import bootstrap_vendor

bootstrap_vendor(__file__)

from PIL import Image, ImageDraw, ImageFont

from layout_scene_builder import build_function_block_scene, dimension_canvas_spec, function_block_geometry, save_scene_json


DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "generated_output"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a function block diagram from the pad-ground report."
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
        help="Optional explicit base image path. Defaults to dimension_drawing_with_ground.png.",
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
        help="Optional explicit output image path.",
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
    spec = dimension_canvas_spec({"dimension_frame": {"bounds": frame_bounds}})
    canvas_width, canvas_height = image_size
    scale = float(spec["scale"])
    margin_left = float(spec["margins"]["left"])
    margin_bottom = float(spec["margins"]["bottom"])

    def to_pixel(x: float, y: float) -> tuple[float, float]:
        px = margin_left + (x - frame_x1) * scale
        py = canvas_height - (margin_bottom + (y - frame_y1) * scale)
        return px, py

    return to_pixel, scale


def draw_amplifier(draw: ImageDraw.ImageDraw, center: tuple[float, float], scale: float, font: ImageFont.ImageFont) -> tuple[float, float, float, float]:
    cx, cy = center
    width = scale * 290
    height = scale * 220
    half_w = width / 2
    half_h = height / 2
    points = [
        (cx - half_w, cy - half_h),
        (cx - half_w, cy + half_h),
        (cx + half_w, cy),
    ]
    line_width = 15
    draw.polygon(points, outline="black", fill="white", width=line_width)
    return (cx - half_w, cy - half_h, cx + half_w, cy + half_h)


def draw_connection(draw: ImageDraw.ImageDraw, start: tuple[float, float], end: tuple[float, float], line_width: int) -> None:
    draw.line([start, end], fill="black", width=line_width)


def draw_label(draw: ImageDraw.ImageDraw, text: str, anchor: tuple[float, float], font: ImageFont.ImageFont, offset: tuple[float, float] = (0, 0), align: str = "center") -> None:
    x = anchor[0] + offset[0]
    y = anchor[1] + offset[1]
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    if align == "left":
        pos = (x, y - text_h / 2)
    elif align == "right":
        pos = (x - text_w, y - text_h / 2)
    else:
        pos = (x - text_w / 2, y - text_h / 2)
    draw.text(pos, text, fill="black", font=font)


def render_function_block(base_image: Path, report_json: Path, output_image: Path, content_bounds: tuple[float, float, float, float] | None = None) -> None:
    report = json.loads(report_json.read_text(encoding="utf-8"))
    geometry = function_block_geometry(report)

    base = Image.open(base_image).convert("RGB")
    crop_left = crop_top = 0
    if content_bounds is not None:
        crop_left = int(max(0, math.floor(content_bounds[0])))
        crop_top = int(max(0, math.floor(content_bounds[1])))
        crop_right = int(min(base.width, math.ceil(content_bounds[2])))
        crop_bottom = int(min(base.height, math.ceil(content_bounds[3])))
        if crop_right > crop_left and crop_bottom > crop_top:
            base = base.crop((crop_left, crop_top, crop_right, crop_bottom))
    shift_x = float(crop_left)
    shift_y = float(crop_top)
    image = Image.new("RGB", base.size, "white")
    image.paste(base, (0, 0))
    draw = ImageDraw.Draw(image)

    scale = float(geometry["scale"])
    line_width = 15
    title_font = load_font(int(round(float(geometry["title_font_size"]))))
    port_font = load_font(int(round(float(geometry["port_font_size"]))))

    in_px = geometry["in_anchor"]
    out_px = geometry["out_anchor"]
    vd_anchors = list(geometry.get("vd_anchors", []))
    amp_center = geometry["amp_center"]
    amp_input_contact = geometry["amp_input_contact"]
    amp_output_contact = geometry["amp_output_contact"]
    vd_contact = geometry["vd_contact"]

    def shift(point: tuple[float, float]) -> tuple[float, float]:
        return (point[0] - shift_x, point[1] - shift_y)

    amp_bounds = draw_amplifier(draw, shift(amp_center), scale, title_font)
    _ = amp_bounds

    draw_connection(draw, shift(in_px), shift(amp_input_contact), line_width)
    draw_connection(draw, shift(amp_output_contact), shift(out_px), line_width)
    for vd_info in vd_anchors:
        anchor = vd_info["anchor"]
        draw_connection(draw, shift(anchor), shift((anchor[0], vd_contact[1])), line_width)
        draw_connection(draw, shift((anchor[0], vd_contact[1])), shift(vd_contact), line_width)

    amp_label = shift(geometry["amp_label"])
    draw_label(draw, "AMP", amp_label, port_font, offset=(0, 0), align="center")
    draw_label(draw, "RFin", shift(in_px), port_font, offset=(scale * 170, -scale * 72), align="center")
    draw_label(draw, "RFout", shift(out_px), port_font, offset=(-scale * 170, -scale * 72), align="center")
    for vd_index, vd_info in enumerate(vd_anchors, start=1):
        label_text = "Vd" if len(vd_anchors) == 1 else f"Vd{vd_index}"
        label_x, label_y = geometry["vd_label_positions"][vd_index - 1]["label"]
        label_align = geometry["vd_label_positions"][vd_index - 1]["anchor"]
        draw_label(draw, label_text, shift((label_x, label_y)), port_font, offset=(0, 0), align=label_align)

    output_image.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_image)


def main() -> None:
    args = parse_args()
    output_root = args.output_root.resolve()
    base_image = args.base_image.resolve() if args.base_image else output_root / "dimension_drawing_with_ground.png"
    report_json = args.report_json.resolve() if args.report_json else output_root / "pad_ground_report.json"
    output_image = args.output_image.resolve() if args.output_image else output_root / "function_block_diagram.png"
    scene_output = output_root / "function_block_scene.json"
    report = json.loads(report_json.read_text(encoding="utf-8"))
    scene = build_function_block_scene(report, model_id=Path(str(report.get("dxf_path", output_root.name))).stem)
    content_bounds = scene.get("meta", {}).get("content_bounds")
    if isinstance(content_bounds, list) and len(content_bounds) == 4:
        bounds_tuple = tuple(float(value) for value in content_bounds)  # type: ignore[arg-type]
    else:
        bounds_tuple = None
    render_function_block(base_image, report_json, output_image, bounds_tuple)
    save_scene_json(scene, scene_output)
    print(f"FUNCTION_BLOCK_IMAGE={output_image}")
    print(f"FUNCTION_BLOCK_SCENE={scene_output}")


if __name__ == "__main__":
    main()
