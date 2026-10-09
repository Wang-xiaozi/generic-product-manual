from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from runtime_bootstrap import bootstrap_vendor

bootstrap_vendor(__file__)

import win32con
import win32gui
import win32gui_struct
import win32process
import pywintypes

DEFAULT_LEDIT_EXE = None
DEFAULT_PREPARE_SCRIPT = Path(__file__).resolve().parent / "analyze_ledit_pad_ground.py"
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "generated_output"

LEGACY_LEDIT_EXPORT_DXF_COMMAND_ID = 40732
KNOWN_LEDIT_EXPORT_DXF_COMMAND_IDS = (41754, LEGACY_LEDIT_EXPORT_DXF_COMMAND_ID)
DXF_DIALOG_TITLE = "Export DXF"
DXF_PATH_EDIT_IDS = (14001, 12001)
DXF_OK_BUTTON_ID = 1
WARNING_DIALOG_TITLE = "Warning"
WARNING_OK_BUTTON_ID = 2
DEFAULT_LEDIT_WINDOW_TITLE_HINT = "L-Edit"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export a L-Edit TDB file to DXF, then run the manual-automation pipeline "
            "to generate the dimension drawing, assembly drawing, and pad table outputs."
        )
    )
    parser.add_argument("tdb_path", type=Path, help="Source L-Edit TDB file.")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="Root directory used to store exported CAD files and grouped final outputs.",
    )
    parser.add_argument(
        "--runner-python",
        type=Path,
        default=Path("__CURRENT_PYTHON__"),
        help="Python executable used to run the downstream CAD asset script.",
    )
    parser.add_argument(
        "--ledit-exe",
        type=Path,
        default=DEFAULT_LEDIT_EXE,
        help="Path to ledit64.exe or the L-Edit installation directory.",
    )
    parser.add_argument(
        "--prepare-script",
        type=Path,
        default=DEFAULT_PREPARE_SCRIPT,
        help="Downstream analysis script that consumes the TDB/DXF pipeline and generates the final assets.",
    )
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Regenerate the DXF export and downstream outputs even if they already exist.",
    )
    parser.add_argument(
        "--startup-timeout",
        type=int,
        default=60,
        help="Seconds to wait for the L-Edit main window.",
    )
    parser.add_argument(
        "--export-timeout",
        type=int,
        default=180,
        help="Seconds to wait for DXF export completion.",
    )
    parser.add_argument(
        "--stop-after-cad",
        action="store_true",
        help="Only export the TDB to DXF and skip the downstream CAD asset generation.",
    )
    parser.add_argument(
        "--ledit-window-title-hint",
        type=str,
        default=DEFAULT_LEDIT_WINDOW_TITLE_HINT,
        help="Visible window-title substring used to locate the L-Edit main window.",
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


def resolve_ledit_path(path_arg: Path | None) -> Path:
    if path_arg is not None and str(path_arg).strip():
        return path_arg
    env_value = os.environ.get("LEDIT_EXE", "").strip()
    if env_value:
        return Path(env_value)
    raise FileNotFoundError(
        "L-Edit path not specified. Pass --ledit-exe to run.py or set the LEDIT_EXE environment variable."
    )


def resolve_ledit_executable(path_arg: Path | None) -> Path:
    path = resolve_ledit_path(path_arg)
    if path.is_file():
        return path.resolve()
    if path.is_dir():
        for candidate_name in ("ledit64.exe", "ledit.exe", "ledit32.exe"):
            candidate = path / candidate_name
            if candidate.exists():
                return candidate.resolve()
        for candidate_name in ("ledit64.exe", "ledit.exe", "ledit32.exe"):
            matches = sorted(
                subpath
                for subpath in path.rglob(candidate_name)
                if len(subpath.relative_to(path).parts) <= 4
            )
            if matches:
                return matches[0].resolve()
    raise FileNotFoundError(f"L-Edit executable not found from path: {path}")


def log_text(text: str) -> None:
    encoding = sys.stdout.encoding or "utf-8"
    safe_text = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
    print(safe_text)


def run_command(args: list[str], label: str) -> None:
    log_text(f"[RUN] {label}")
    try:
        result = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    except subprocess.CalledProcessError as exc:
        if exc.stdout.strip():
            log_text(exc.stdout.strip())
        if exc.stderr.strip():
            log_text(exc.stderr.strip())
        raise
    if result.stdout.strip():
        log_text(result.stdout.strip())
    if result.stderr.strip():
        log_text(result.stderr.strip())


def find_expected_assets(output_root: Path, model_id: str) -> dict[str, Path]:
    return {
        "dimension": output_root / "dimension_drawing_with_ground_numbered_dimensioned.png",
        "function_block": output_root / "function_block_diagram.png",
        "function_block_scene": output_root / "function_block_scene.json",
        "assembly": output_root / "assembly_drawing.png",
        "pad_xlsx": output_root / f"{model_id}_压点信息表.xlsx",
        "pad_csv": output_root / f"{model_id}_压点信息表.csv",
        "report": output_root / "pad_ground_report.json",
        "dimension_scene": output_root / "dimension_scene.json",
        "assembly_scene": output_root / "assembly_scene.json",
        "dxf": output_root / "cad_exports" / f"{model_id}.dxf",
    }


def enum_ledit_windows(title_hint: str) -> list[tuple[int, str, int]]:
    matches: list[tuple[int, str, int]] = []

    def callback(hwnd: int, _: object) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if title_hint not in title:
            return
        _, window_pid = win32process.GetWindowThreadProcessId(hwnd)
        matches.append((hwnd, title, window_pid))

    try:
        win32gui.EnumWindows(callback, None)
    except pywintypes.error as exc:
        log_text(f"[WARN] EnumWindows failed, continuing with empty window list: {exc}")
        return []
    return matches


def wait_for_ledit_main_window(
    *,
    model_id: str,
    launched_pid: int,
    existing_hwnds: set[int],
    timeout_seconds: int,
    title_hint: str,
) -> int:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        for hwnd, title, pid in enum_ledit_windows(title_hint):
            if model_id in title:
                return hwnd
            if pid == launched_pid and hwnd not in existing_hwnds:
                return hwnd
        time.sleep(0.5)
    raise TimeoutError(f"Timed out waiting for the L-Edit window for model {model_id}")


def wait_for_dialog(
    *,
    pid: int,
    exact_title: str,
    timeout_seconds: int,
) -> int:
    last_titles: list[str] = []
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        for hwnd in enum_windows_for_pid(pid):
            title = win32gui.GetWindowText(hwnd)
            last_titles.append(title)
            if is_target_dxf_dialog(hwnd, title, exact_title):
                return hwnd
        time.sleep(0.5)
    unique_titles = [title for title in dict.fromkeys(last_titles) if title]
    titles_text = ", ".join(unique_titles) if unique_titles else "<no visible windows>"
    raise TimeoutError(
        f"Timed out waiting for dialog {exact_title} in process {pid}. "
        f"Visible windows: {titles_text}"
    )


def enum_windows_for_pid(pid: int) -> list[int]:
    matches: list[int] = []

    def callback(hwnd: int, _: object) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        _, window_pid = win32process.GetWindowThreadProcessId(hwnd)
        if window_pid == pid:
            matches.append(hwnd)

    win32gui.EnumWindows(callback, None)
    return matches


def find_dialog_child(dialog_hwnd: int, control_id: int) -> int:
    children: list[int] = []
    win32gui.EnumChildWindows(dialog_hwnd, lambda child, acc: acc.append(child), children)
    for child in children:
        if win32gui.GetDlgCtrlID(child) == control_id:
            return child
    raise RuntimeError(f"Control {control_id} was not found in dialog {dialog_hwnd}")


def find_dialog_child_any(dialog_hwnd: int, control_ids: tuple[int, ...]) -> int:
    for control_id in control_ids:
        try:
            return find_dialog_child(dialog_hwnd, control_id)
        except RuntimeError:
            continue
    raise RuntimeError(f"Controls {control_ids} were not found in dialog {dialog_hwnd}")


def has_dialog_child(dialog_hwnd: int, control_id: int) -> bool:
    try:
        find_dialog_child(dialog_hwnd, control_id)
        return True
    except RuntimeError:
        return False


def is_target_dxf_dialog(hwnd: int, title: str, exact_title: str) -> bool:
    normalized_title = title.strip().lower()
    expected_title = exact_title.strip().lower()

    if normalized_title == expected_title:
        return True
    if expected_title in normalized_title:
        return True
    if "dxf" in normalized_title:
        return True

    # Some L-Edit versions show a different caption, but the DXF export dialog
    # still exposes the path edit control and the OK button with stable IDs.
    return any(has_dialog_child(hwnd, control_id) for control_id in DXF_PATH_EDIT_IDS) and has_dialog_child(
        hwnd, DXF_OK_BUTTON_ID
    )


def normalize_menu_text(text: str) -> str:
    cleaned = text.replace("&", "")
    cleaned = cleaned.replace("...", "")
    cleaned = cleaned.split("\t", 1)[0]
    return " ".join(cleaned.strip().lower().split())


def iter_menu_entries(menu_handle: int, path: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], int]]:
    entries: list[tuple[tuple[str, ...], int]] = []
    count = win32gui.GetMenuItemCount(menu_handle)
    for index in range(count):
        info_buffer, _extras = win32gui_struct.EmptyMENUITEMINFO(
            mask=win32con.MIIM_ID | win32con.MIIM_SUBMENU | win32con.MIIM_STRING
        )
        win32gui.GetMenuItemInfo(menu_handle, index, True, info_buffer)
        _f_type, _f_state, item_id, sub_menu, _checked, _unchecked, _item_data, text, _bmp = (
            win32gui_struct.UnpackMENUITEMINFO(info_buffer)
        )
        normalized_text = normalize_menu_text(text or "")
        current_path = path + ((normalized_text,) if normalized_text else ())
        if item_id not in (0, -1):
            entries.append((current_path, item_id))
        if sub_menu:
            entries.extend(iter_menu_entries(sub_menu, current_path))
    return entries


def find_dxf_export_command(main_hwnd: int) -> tuple[int | None, str]:
    menu_handle = win32gui.GetMenu(main_hwnd)
    if not menu_handle:
        return None, ""

    best_match: tuple[int, int, str] | None = None
    for path_parts, item_id in iter_menu_entries(menu_handle):
        if not path_parts:
            continue
        joined_path = " > ".join(path_parts)
        if "dxf" not in joined_path:
            continue

        score = 0
        if "export mask data" in joined_path:
            score += 100
        if "export" in joined_path:
            score += 50
        if path_parts[-1] == "dxf":
            score += 10
        if "import" in joined_path:
            score -= 100

        if best_match is None or score > best_match[0]:
            best_match = (score, item_id, joined_path)

    if best_match is None:
        return None, ""
    return best_match[1], best_match[2]


def request_dxf_export(main_hwnd: int) -> None:
    dynamic_command_id, command_path = find_dxf_export_command(main_hwnd)
    candidate_ids: list[tuple[int, str]] = []
    if dynamic_command_id is not None:
        candidate_ids.append((dynamic_command_id, command_path))
    for candidate_id in KNOWN_LEDIT_EXPORT_DXF_COMMAND_IDS:
        if all(candidate_id != existing_id for existing_id, _label in candidate_ids):
            candidate_ids.append((candidate_id, f"fallback id {candidate_id}"))

    for command_id, label in candidate_ids:
        log_text(f"[INFO] Requesting DXF export via command {command_id} ({label})")
        win32gui.PostMessage(main_hwnd, win32con.WM_COMMAND, command_id, 0)
        time.sleep(1.0)
        _, owner_pid = win32process.GetWindowThreadProcessId(main_hwnd)
        try:
            wait_for_dialog(pid=owner_pid, exact_title=DXF_DIALOG_TITLE, timeout_seconds=5)
            return
        except TimeoutError:
            continue

    _, owner_pid = win32process.GetWindowThreadProcessId(main_hwnd)
    raise TimeoutError(
        "Could not open the DXF export dialog with any known command. "
        f"Checked dynamic menu command and fallbacks in process {owner_pid}."
    )


def close_process(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


def close_ledit_session(proc: subprocess.Popen[bytes], main_hwnd: int | None, owner_pid: int | None) -> None:
    if main_hwnd is not None and win32gui.IsWindow(main_hwnd):
        try:
            win32gui.PostMessage(main_hwnd, win32con.WM_CLOSE, 0, 0)
            time.sleep(1.0)
        except pywintypes.error:
            pass

    if owner_pid is not None:
        subprocess.run(
            ["taskkill", "/PID", str(owner_pid), "/T", "/F"],
            check=False,
            capture_output=True,
            text=True,
        )

    close_process(proc)


def find_window_by_title(pid: int, title: str) -> int | None:
    for hwnd in enum_windows_for_pid(pid):
        if win32gui.GetWindowText(hwnd) == title:
            return hwnd
    return None


def dismiss_warning_dialogs(pid: int) -> bool:
    dismissed = False
    while True:
        warning_hwnd = find_window_by_title(pid, WARNING_DIALOG_TITLE)
        if warning_hwnd is None:
            return dismissed

        warning_texts: list[str] = []
        children: list[int] = []
        win32gui.EnumChildWindows(warning_hwnd, lambda child, acc: acc.append(child), children)
        for child in children:
            if win32gui.GetClassName(child) == "Static":
                text = win32gui.GetWindowText(child).strip()
                if text:
                    warning_texts.append(text)

        summary = " | ".join(dict.fromkeys(warning_texts))
        if summary:
            log_text(f"[WARN] L-Edit warning dialog detected: {summary}")
        ok_button = find_dialog_child(warning_hwnd, WARNING_OK_BUTTON_ID)
        win32gui.SendMessage(ok_button, win32con.BM_CLICK, 0, 0)
        time.sleep(0.5)
        dismissed = True


def is_complete_dxf(path: Path) -> bool:
    if not path.exists() or path.stat().st_size <= 0:
        return False
    try:
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - 4096))
            tail = handle.read().decode("utf-8", errors="ignore")
    except OSError:
        return False
    return "ENDSEC" in tail and "EOF" in tail


def export_tdb_to_dxf(
    *,
    ledit_exe: Path,
    tdb_path: Path,
    output_path: Path,
    force_refresh: bool,
    startup_timeout: int,
    export_timeout: int,
    title_hint: str,
) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and not force_refresh:
        if is_complete_dxf(output_path):
            log_text(f"[SKIP] Reusing existing DXF export: {output_path}")
            return output_path
        log_text(f"[WARN] Existing DXF export is incomplete, regenerating: {output_path}")

    output_path.unlink(missing_ok=True)
    model_id = tdb_path.stem
    existing_hwnds = {hwnd for hwnd, _, _ in enum_ledit_windows(title_hint)}
    proc = subprocess.Popen([str(ledit_exe), str(tdb_path)])
    main_hwnd: int | None = None
    owner_pid: int | None = None
    try:
        main_hwnd = wait_for_ledit_main_window(
            model_id=model_id,
            launched_pid=proc.pid,
            existing_hwnds=existing_hwnds,
            timeout_seconds=startup_timeout,
            title_hint=title_hint,
        )
        request_dxf_export(main_hwnd)
        _, owner_pid = win32process.GetWindowThreadProcessId(main_hwnd)
        dialog_hwnd = wait_for_dialog(
            pid=owner_pid,
            exact_title=DXF_DIALOG_TITLE,
            timeout_seconds=30,
        )
        path_edit = find_dialog_child_any(dialog_hwnd, DXF_PATH_EDIT_IDS)
        ok_button = find_dialog_child(dialog_hwnd, DXF_OK_BUTTON_ID)
        win32gui.SendMessage(path_edit, win32con.WM_SETTEXT, 0, str(output_path))
        time.sleep(0.3)
        win32gui.SendMessage(ok_button, win32con.BM_CLICK, 0, 0)

        deadline = time.time() + export_timeout
        stable_count = 0
        last_size = -1
        while time.time() < deadline:
            dismiss_warning_dialogs(owner_pid)
            dialog_open = False
            for hwnd in enum_windows_for_pid(owner_pid):
                if is_target_dxf_dialog(hwnd, win32gui.GetWindowText(hwnd), DXF_DIALOG_TITLE):
                    dialog_open = True
                    break
            if output_path.exists():
                current_size = output_path.stat().st_size
                if current_size == last_size and current_size > 0:
                    stable_count += 1
                else:
                    stable_count = 0
                    last_size = current_size
                if current_size > 0 and stable_count >= 2 and not dialog_open and is_complete_dxf(output_path):
                    return output_path
            time.sleep(0.5)
        raise TimeoutError(f"Timed out waiting for DXF export: {output_path}")
    finally:
        close_ledit_session(proc, main_hwnd, owner_pid)


def main() -> None:
    args = parse_args()
    runner_python = resolve_runner_python(args.runner_python)
    tdb_path = ensure_exists(args.tdb_path, "L-Edit TDB file")
    ledit_exe = resolve_ledit_executable(args.ledit_exe)
    prepare_script = ensure_exists(args.prepare_script, "Downstream asset pipeline script")

    model_id = tdb_path.stem
    output_root = args.output_root.resolve()
    cad_exports_dir = output_root / "cad_exports"
    exported_dxf = cad_exports_dir / f"{model_id}.dxf"

    export_tdb_to_dxf(
        ledit_exe=ledit_exe,
        tdb_path=tdb_path,
        output_path=exported_dxf,
        force_refresh=args.force_refresh,
        startup_timeout=args.startup_timeout,
        export_timeout=args.export_timeout,
        title_hint=args.ledit_window_title_hint,
    )

    log_text(f"MODEL={model_id}")
    log_text(f"TDB={tdb_path}")
    log_text(f"CAD_DXF={exported_dxf}")
    log_text(f"OUTPUT_ROOT={output_root}")

    if args.stop_after_cad:
        return

    command = [
        str(runner_python),
        str(prepare_script),
        str(tdb_path),
        "--output-root",
        str(output_root),
        "--runner-python",
        str(runner_python),
        "--export-script",
        str(Path(__file__).resolve()),
        "--ledit-exe",
        str(ledit_exe),
    ]
    if args.force_refresh:
        command.append("--force-refresh")
    run_command(command, "Generate dimension drawing / assembly drawing / pad table from TDB")

    expected_assets = find_expected_assets(output_root, model_id)
    missing = [label for label, path in expected_assets.items() if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Pipeline finished but did not produce all expected assets: "
            + ", ".join(f"{label}={expected_assets[label]}" for label in missing)
        )

    log_text(f"DIMENSION_IMAGE={expected_assets['dimension']}")
    log_text(f"ASSEMBLY_IMAGE={expected_assets['assembly']}")
    log_text(f"PAD_TABLE_XLSX={expected_assets['pad_xlsx']}")
    log_text(f"PAD_TABLE_CSV={expected_assets['pad_csv']}")
    log_text(f"REPORT={expected_assets['report']}")


if __name__ == "__main__":
    main()
