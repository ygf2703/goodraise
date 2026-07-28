from __future__ import annotations

from pathlib import Path
import sys


ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_HTML = ROOT_DIR / "outputs" / "yellow-project-dashboard.html"
BROWSER_OUTPUT_HTML = ROOT_DIR / "outputs" / "yellow-project-dashboard-browser.html"

REQUIRED_SNIPPETS = [
    "yellow-dashboard-root",
    "page-prizes",
    "page-rules",
    "page-privacy",
    "page-admin",
    "go-admin-login",
    "public-admin-login",
    "login-form",
    "session-status",
    "import-status",
    "csv-upload",
    "compare-upload",
    "prize-upload",
    "export-filtered",
]

FORBIDDEN_SNIPPETS = [
    "__INITIAL_ROWS__",
    "__INITIAL_META__",
    "__INITIAL_ORG_LOGO__",
    "__INITIAL_CAMPAIGN_LOGO__",
    "__INITIAL_PRIZES__",
    "__ACCESS_CONTROL__",
]


def validate_output(path: Path) -> list[str]:
    issues: list[str] = []
    if not path.exists():
        return [f"Missing output file: {path}"]

    content = path.read_text(encoding="utf-8")
    if len(content.strip()) < 1000:
        issues.append(f"Output file is unexpectedly small: {path}")

    for snippet in REQUIRED_SNIPPETS:
        if snippet not in content:
            issues.append(f"Required snippet '{snippet}' was not found in {path.name}")

    for snippet in FORBIDDEN_SNIPPETS:
        if snippet in content:
            issues.append(f"Unresolved template token '{snippet}' found in {path.name}")

    if "<html" not in content.lower():
        issues.append(f"{path.name} is not a full HTML document")

    if "data:image/png;base64" not in content:
        issues.append(f"{path.name} does not appear to contain embedded logo assets")

    return issues


def main() -> int:
    issues = validate_output(OUTPUT_HTML) + validate_output(BROWSER_OUTPUT_HTML)
    if issues:
        print("Dashboard release verification failed:")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print("Dashboard release verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
