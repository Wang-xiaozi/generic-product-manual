from __future__ import annotations

import argparse
import csv
import json
import sys
import zipfile
from pathlib import Path

from runtime_bootstrap import bootstrap_vendor

bootstrap_vendor(__file__)

DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "generated_output"

HEADERS = ["压点编号", "功能符号", "功能描述", "位置（μm）", "尺寸"]
DESCRIPTIONS = {
    "RFin": "射频信号输入端，外接50欧姆系统，无需隔直电容",
    "RFout": "射频信号输出端，外接50欧姆系统，无需隔直电容",
    "Vd": "放大器工作电压馈电端，需外置100pF电源滤波电容",
    "GND": "供探针测试用的接地压点",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate pad table files from the current report/numbering logic.")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory containing pad_ground_report.json and used to store generated pad table files.",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=None,
        help="Optional explicit pad_ground_report.json path.",
    )
    parser.add_argument(
        "--output-xlsx",
        type=Path,
        default=None,
        help="Optional explicit output xlsx path.",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        default=None,
        help="Optional explicit output csv path.",
    )
    return parser.parse_args()


def format_size(port: dict[str, object]) -> str:
    width = int(round(float(port["width"])))
    height = int(round(float(port["height"])))
    return f"{width}×{height}μm²"


def format_coordinate(value: object) -> str:
    number = round(float(value), 2)
    return str(int(number)) if number.is_integer() else f"{number:.2f}".rstrip("0").rstrip(".")


def format_position(port: dict[str, object], origin: tuple[float, float]) -> str:
    x, y = [float(value) for value in port["centroid"]]
    x -= origin[0]
    y -= origin[1]
    return f"({format_coordinate(x)}, {format_coordinate(y)})"


def sort_ports_clockwise_from_lower_left(
    ports: list[dict[str, object]],
    frame_bounds: list[float],
) -> list[dict[str, object]]:
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


def build_rows(report: dict[str, object]) -> list[list[str]]:
    ports = list(report.get("physical_ports", report["ports"]))
    frame_bounds = [float(value) for value in report["dimension_frame"]["bounds"]]
    ordered = sort_ports_clockwise_from_lower_left(list(ports), frame_bounds)
    port_number_map = {int(port["port_index"]): index for index, port in enumerate(ordered, start=1)}
    origin = (frame_bounds[0], frame_bounds[1])

    role_info = report.get("port_roles") or {}
    role_by_index = {}
    if role_info.get("RFin") is not None:
        role_by_index[int(role_info["RFin"])] = "RFin"
    if role_info.get("RFout") is not None:
        role_by_index[int(role_info["RFout"])] = "RFout"
    vd_indices = [int(value) for value in role_info.get("Vd_ports", [])]
    vd_label_by_index: dict[int, str] = {}
    if len(vd_indices) == 1:
        vd_label_by_index[vd_indices[0]] = "Vd"
    elif len(vd_indices) > 1:
        for vd_order, port_index in enumerate(vd_indices, start=1):
            vd_label_by_index[port_index] = f"Vd{vd_order}"
    for port_index, vd_label in vd_label_by_index.items():
        role_by_index[port_index] = vd_label

    gnd_numbers: list[int] = []
    gnd_size = ""
    gnd_positions: list[tuple[int, str]] = []
    rows: list[list[str]] = []

    for port in ordered:
        port_index = int(port["port_index"])
        number = str(port_number_map[port_index])
        role = role_by_index.get(port_index)

        if bool(port.get("is_ground", False)):
            gnd_numbers.append(port_number_map[port_index])
            gnd_positions.append((port_number_map[port_index], format_position(port, origin)))
            if not gnd_size:
                gnd_size = format_size(port)
            continue

        if role is None:
            role = "UNKNOWN"

        rows.append(
            [
                number,
                role,
                DESCRIPTIONS.get("Vd" if str(role).startswith("Vd") else role, ""),
                format_position(port, origin),
                format_size(port),
            ]
        )

    def role_sort_key(role_name: str) -> tuple[int, int]:
        if role_name == "RFin":
            return (0, 0)
        if role_name == "RFout":
            return (1, 0)
        if role_name == "Vd":
            return (2, 0)
        if role_name.startswith("Vd"):
            suffix = role_name[2:]
            return (2, int(suffix) if suffix.isdigit() else 0)
        if role_name == "UNKNOWN":
            return (99, 0)
        return (98, 0)

    rows.sort(key=lambda row: (role_sort_key(str(row[1])), row[0]))

    if gnd_numbers:
        rows.append(
            [
                ",".join(str(number) for number in gnd_numbers),
                "GND",
                DESCRIPTIONS["GND"],
                "\n".join(f"{number}: {position}" for number, position in gnd_positions),
                gnd_size,
            ]
        )

    return rows


def save_xlsx(rows: list[list[str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    all_rows = [HEADERS, *rows]
    sheet_name = "压点信息表"

    def col_name(index: int) -> str:
        result = ""
        while index > 0:
            index, rem = divmod(index - 1, 26)
            result = chr(65 + rem) + result
        return result

    def xml_escape(value: object) -> str:
        text = str(value)
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    row_xml: list[str] = []
    for row_idx, row in enumerate(all_rows, start=1):
        cells: list[str] = []
        for col_idx, value in enumerate(row, start=1):
            cell_ref = f"{col_name(col_idx)}{row_idx}"
            cells.append(
                f'<c r="{cell_ref}" s="{1 if row_idx == 1 else 2}" t="inlineStr"><is><t>{xml_escape(value)}</t></is></c>'
            )
        max_lines = max(str(value).count("\n") + 1 for value in row)
        height = "24" if row_idx == 1 else str(max(34, 18 * max_lines + 10))
        row_xml.append(f'<row r="{row_idx}" ht="{height}" customHeight="1">{"".join(cells)}</row>')

    worksheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<cols>'
        '<col min="1" max="1" width="14" customWidth="1"/>'
        '<col min="2" max="2" width="14" customWidth="1"/>'
        '<col min="3" max="3" width="46" customWidth="1"/>'
        '<col min="4" max="4" width="32" customWidth="1"/>'
        '<col min="5" max="5" width="16" customWidth="1"/>'
        '</cols>'
        f'<sheetData>{"".join(row_xml)}</sheetData>'
        "</worksheet>"
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{xml_escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        "</Relationships>"
    )
    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )
    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", root_rels_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet_xml)
        archive.writestr("xl/styles.xml", styles_xml)


def save_csv(rows: list[list[str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADERS)
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    output_root = args.output_root.resolve()
    report_json = args.report_json.resolve() if args.report_json else output_root / "pad_ground_report.json"
    report = json.loads(report_json.read_text(encoding="utf-8"))

    model_id = Path(report["dxf_path"]).stem
    output_xlsx = args.output_xlsx.resolve() if args.output_xlsx else output_root / f"{model_id}_压点信息表.xlsx"
    output_csv = args.output_csv.resolve() if args.output_csv else output_root / f"{model_id}_压点信息表.csv"

    rows = build_rows(report)
    save_xlsx(rows, output_xlsx)
    save_csv(rows, output_csv)

    print(f"PAD_TABLE_XLSX={output_xlsx}")
    print(f"PAD_TABLE_CSV={output_csv}")


if __name__ == "__main__":
    main()
