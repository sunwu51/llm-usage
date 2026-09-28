"""Build the Chrome Web Store upload ZIP from an explicit extension file list."""

import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "manifest.json",
    "popup.html",
    "history.html",
    "login-success.html",
    "src/background.js",
    "src/history.js",
    "src/login-success.js",
    "src/model.js",
    "src/popup.js",
    "src/providers.js",
    "src/ui.css",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
    "icons/logo.svg",
]


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    output = ROOT / "dist" / f"llm-usage-v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            source = ROOT / name
            if not source.is_file():
                raise FileNotFoundError(source)
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    with ZipFile(output) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(FILES):
            raise RuntimeError("ZIP verification failed")
        if json.loads(archive.read("manifest.json"))["version"] != version:
            raise RuntimeError("Packaged manifest version mismatch")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f"{output} ({output.stat().st_size} bytes, SHA-256 {digest})")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Packaging failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
