from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run(
    [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name",
        "engine",
        "--distpath",
        str(root / "engine-dist"),
        "--workpath",
        str(root / "build" / "python"),
        "--paths",
        str(root),
        "--add-data",
        str(root / "app" / "topic-scopes.json") + ";app",
        "--collect-all",
        "trafilatura",
        "--collect-all",
        "pymupdf",
        "--hidden-import",
        "app.parsers",
        "--hidden-import",
        "app.worker",
        str(root / "scripts" / "engine_entry.py"),
    ],
    cwd=root,
    check=True,
)
exe = root / "engine-dist" / "engine" / "engine.exe"
exe.rename(exe.with_name("zhishi-engine.exe"))
