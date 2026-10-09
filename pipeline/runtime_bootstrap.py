from __future__ import annotations

import os
import sys
from pathlib import Path


# Keep these objects alive for the lifetime of the process.  On Windows,
# dropping an add_dll_directory handle removes the directory from the DLL
# search path again.
_DLL_DIRECTORY_HANDLES: list[object] = []
_PRELOADED_DLLS: list[object] = []


def use_bundled_vendor() -> bool:
    return os.environ.get("LAYOUT_USE_BUNDLED_VENDOR", "").strip().lower() in {"1", "true", "yes", "on"}


def _add_dll_directory(path: Path) -> None:
    if path.exists() and hasattr(os, "add_dll_directory"):
        _DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(path)))


def _add_site_pywin32_dll_dir() -> Path | None:
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    site_pywin32_dir = site_packages / "pywin32_system32"
    if not site_pywin32_dir.exists():
        return None
    _add_dll_directory(site_pywin32_dir)
    return site_pywin32_dir


def _preload_pywintypes(dll_dir: Path | None) -> None:
    """Load the matching pywin32 runtime before win32gui.

    Conda may leave another pywintypes DLL in Library/bin. Importing a pywin32
    extension first can make Windows pick that stale DLL from PATH and fail with
    WinError 127. Loading the DLL by its absolute path makes the choice
    deterministic.
    """
    if os.name == "nt" and dll_dir is not None:
        import ctypes

        dll_name = f"pywintypes{sys.version_info.major}{sys.version_info.minor}.dll"
        dll_path = dll_dir / dll_name
        if dll_path.is_file():
            _PRELOADED_DLLS.append(ctypes.WinDLL(str(dll_path)))

    # Populate sys.modules as well so later imports share the preloaded module.
    import pywintypes  # type: ignore  # noqa: F401


def bootstrap_vendor(script_file: str) -> None:
    # Even in standard pip-installed mode, pywin32 may need its DLL directory
    # explicitly added for child Python processes started by the pipeline.
    pywin32_dll_dir = _add_site_pywin32_dll_dir()

    if use_bundled_vendor():
        script_root = Path(script_file).resolve().parent
        vendor_dir = script_root / "vendor"

        if vendor_dir.exists():
            dll_dir = vendor_dir / "pywin32_system32"
            if dll_dir.exists():
                _add_dll_directory(dll_dir)
                pywin32_dll_dir = dll_dir
        vendor_paths = (
            vendor_dir,
            vendor_dir / "win32",
            vendor_dir / "win32" / "lib",
            vendor_dir / "pythonwin",
        )
        for extra in vendor_paths:
            if extra.exists() and str(extra) not in sys.path:
                # Prepend vendor paths only when bundled-vendor mode is explicitly requested.
                sys.path.insert(0, str(extra))
        try:
            import pywin32_bootstrap  # type: ignore  # noqa: F401
        except Exception:
            pass

    _preload_pywintypes(pywin32_dll_dir)
