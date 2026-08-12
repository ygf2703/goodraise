from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
BLOCKED_TRACKED_PATHS = {
    "work/config/dashboard-access.local.json",
    "work/source.csv",
    "work/prizes.xlsx",
    "work/prizes.csv",
    "netlify/data/admin-dataset.json",
}
TRACKED_DIR_RULES = {
    "work/data/": {"work/data/.gitkeep"},
    "netlify/data/": {"netlify/data/.gitkeep"},
}


def list_tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.strip().replace("\\", "/") for line in result.stdout.splitlines() if line.strip()]


def main() -> int:
    tracked_files = list_tracked_files()
    issues: list[str] = []

    for path in tracked_files:
        if path in BLOCKED_TRACKED_PATHS:
            issues.append(f"Blocked tracked file detected: {path}")

        for prefix, allowed in TRACKED_DIR_RULES.items():
            if path.startswith(prefix) and path not in allowed:
                issues.append(f"Sensitive directory contains tracked file: {path}")

    if issues:
        for issue in issues:
            print(issue)
        return 1

    print("Repository hygiene verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
