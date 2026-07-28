from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
BUILD_SCRIPT = ROOT_DIR / "work" / "build_yellow_dashboard.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local dashboard backend with session-based admin auth.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument("--port", type=int, default=8767, help="Port to listen on")
    parser.add_argument("--skip-build", action="store_true", help="Skip rebuilding the dashboard before startup")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.skip_build:
        subprocess.run([sys.executable, str(BUILD_SCRIPT)], check=True, cwd=str(ROOT_DIR))

    sys.path.insert(0, str(ROOT_DIR))
    from work.dashboard_backend import serve

    serve(host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
