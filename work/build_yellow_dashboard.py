from __future__ import annotations

import base64
import csv
import json
import re
import subprocess
import textwrap
from datetime import datetime
from html import unescape
from pathlib import Path

import pandas as pd


WORK_DIR = Path(r"C:\Users\noamf\Documents\Codex\2026-07-27\mu\work")
SOURCE_CSV = WORK_DIR / "source.csv"
PRIZES_XLSX = WORK_DIR / "prizes.xlsx"
LOGO_PATH = WORK_DIR / "brand-logo.png"
VIS_DIR = Path(r"C:\Users\noamf\.codex\visualizations\2026\07\27\019fa494-6c18-70a0-bbb2-4a92c166188a")
FRAGMENT_PATH = VIS_DIR / "yellow-project-dashboard.html"
OUTPUT_HTML = Path(r"C:\Users\noamf\Documents\Codex\2026-07-27\mu\outputs\yellow-project-dashboard.html")
BROWSER_OUTPUT_HTML = Path(r"C:\Users\noamf\Documents\Codex\2026-07-27\mu\outputs\yellow-project-dashboard-browser.html")
RENDER_SCRIPT = Path(
    r"C:\Users\noamf\.codex\plugins\cache\openai-bundled\visualize\1.0.11\skills\visualize\scripts\render.py"
)
PYTHON_EXE = Path(r"C:\Users\noamf\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
DATE_TIME_FORMAT = "%d/%m/%y %H:%M"


def parse_amount(value: str) -> float:
    try:
        return float((value or "").strip() or "0")
    except ValueError:
        return 0.0


def parse_bool(value: str) -> bool:
    return (value or "").strip().lower() == "true"


def ambassador_label(value: str) -> str:
    cleaned = (value or "").strip()
    return cleaned if cleaned else "ללא שיוך"


def load_rows() -> list[dict]:
    rows: list[dict] = []
    with SOURCE_CSV.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            created_raw = (raw.get("created_at") or "").strip()
            if not created_raw:
                continue
            try:
                created_dt = datetime.strptime(created_raw, DATE_TIME_FORMAT)
            except ValueError:
                continue

            rows.append(
                {
                    "id": (raw.get("id") or "").strip(),
                    "createdIso": created_dt.isoformat(timespec="minutes"),
                    "date": created_dt.date().isoformat(),
                    "hour": created_dt.hour,
                    "email": (raw.get("email") or "").strip().lower(),
                    "donor": (raw.get("full_name") or "").strip() or "ללא שם",
                    "ambassador": ambassador_label(raw.get("Ambassador name") or ""),
                    "amount": parse_amount(raw.get("total") or ""),
                    "city": (raw.get("city") or "").strip() or "ללא עיר",
                    "status": "success" if parse_bool(raw.get("charged_success") or "") else "failed",
                    "chargeResult": (raw.get("charge_result") or "").strip(),
                }
            )
    return rows


def build_meta(rows: list[dict]) -> dict:
    unique_dates = sorted({row["date"] for row in rows})
    project_dates = unique_dates[:10]
    default_from = project_dates[0] if project_dates else (unique_dates[0] if unique_dates else "")
    default_to = project_dates[-1] if project_dates else (unique_dates[-1] if unique_dates else "")
    return {
        "uniqueDates": unique_dates,
        "projectDates": project_dates,
        "defaultFrom": default_from,
        "defaultTo": default_to,
        "minDate": unique_dates[0] if unique_dates else "",
        "maxDate": unique_dates[-1] if unique_dates else "",
        "rowCount": len(rows),
        "projectWindowLabel": f"{default_from} עד {default_to}" if default_from and default_to else "",
    }


def load_logo_data_uri() -> str:
    if not LOGO_PATH.exists():
        return ""
    encoded = base64.b64encode(LOGO_PATH.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def load_prize_model() -> dict:
    if not PRIZES_XLSX.exists():
        return {"placePrizes": [], "tierPrizes": [], "tierRuleNote": ""}

    df = pd.read_excel(PRIZES_XLSX)
    columns = [normalize_text(column) for column in df.columns]
    if len(columns) < 2:
        return {"placePrizes": [], "tierPrizes": [], "tierRuleNote": ""}

    place_prizes = []
    left_header, right_header = columns[0], columns[1]
    if left_header and right_header:
        place_prizes.append({"place": 1, "label": left_header, "prize": right_header})

    tier_prizes = []
    tier_rule_note = ""
    in_tiers = False

    for _, row in df.iterrows():
        left_value = row.iloc[0]
        right_value = row.iloc[1] if len(row) > 1 else ""
        left_text = normalize_text(left_value)
        right_text = normalize_text(right_value)

        if not in_tiers and left_text.startswith("מקום"):
            digits = "".join(character for character in left_text if character.isdigit())
            if digits:
                place_prizes.append(
                    {
                        "place": int(digits),
                        "label": left_text,
                        "prize": right_text,
                    }
                )
            continue

        if left_text == "מדרגות פרס":
            in_tiers = True
            continue

        if in_tiers:
            if left_text.replace(".", "", 1).isdigit() and right_text:
                tier_prizes.append(
                    {
                        "threshold": int(float(left_text)),
                        "prize": right_text,
                    }
                )
                continue
            if left_text and "לא ניתן לקבל יותר מפרס אחד" in left_text:
                tier_rule_note = left_text

    place_prizes = sorted(place_prizes, key=lambda item: item["place"])
    tier_prizes = sorted(tier_prizes, key=lambda item: item["threshold"])

    return {
        "placePrizes": place_prizes,
        "tierPrizes": tier_prizes,
        "tierRuleNote": tier_rule_note,
    }


def build_fragment(rows: list[dict], meta: dict, logo_data_uri: str, prize_model: dict) -> str:
    rows_json = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    logo_json = json.dumps(logo_data_uri, ensure_ascii=False)
    prize_json = json.dumps(prize_model, ensure_ascii=False, separators=(",", ":"))
    access_json = json.dumps(
        {
            "managerEmails": ["noamfrostig@gmail.com"],
            "adminPasswordHash": "aaf587976eeb78f291c13743195dd667cbd1a175bbee14f7a8712b37ef6c1b47",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )

    template = textwrap.dedent(
        """
        <div id="yellow-dashboard-root" dir="rtl">
          <style>
            #yellow-dashboard-root {
              --brand-blue-950: #131750;
              --brand-blue-900: #1c2368;
              --brand-blue-700: #2d3998;
              --brand-blue-500: #4b65d9;
              --brand-yellow-500: #ffd93d;
              --brand-yellow-400: #ffe66d;
              --brand-yellow-200: #fff4b3;
              --brand-black: #101010;
              --brand-white: #ffffff;
              color: var(--brand-black);
              font-size: var(--font-size-base);
              background:
                radial-gradient(circle at top right, rgba(255, 217, 61, 0.24), transparent 28rem),
                linear-gradient(180deg, rgba(28, 35, 104, 0.06), rgba(255, 255, 255, 0.96) 28%);
              padding: 0.25rem 0 1rem;
            }

            #yellow-dashboard-root .dashboard-shell {
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .app-shell {
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .app-topbar,
            #yellow-dashboard-root .page-panel,
            #yellow-dashboard-root .legal-card,
            #yellow-dashboard-root .admin-lock,
            #yellow-dashboard-root .public-hero {
              background: rgba(255, 255, 255, 0.94);
              border: 2px solid rgba(19, 23, 80, 0.12);
              border-radius: 1.25rem;
              box-shadow: 0 12px 34px rgba(19, 23, 80, 0.08);
            }

            #yellow-dashboard-root .app-topbar {
              padding: 0.9rem 1rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 1rem;
              flex-wrap: wrap;
              position: sticky;
              top: 0.5rem;
              z-index: 20;
              backdrop-filter: blur(12px);
            }

            #yellow-dashboard-root .topbar-brand {
              display: flex;
              align-items: center;
              gap: 0.75rem;
              color: var(--brand-blue-950);
              font-weight: 600;
            }

            #yellow-dashboard-root .topbar-logo {
              width: 3rem;
              height: 3rem;
              border-radius: 0.9rem;
              background: rgba(255, 217, 61, 0.18);
              padding: 0.3rem;
              object-fit: contain;
            }

            #yellow-dashboard-root .topbar-meta {
              display: grid;
              gap: 0.15rem;
            }

            #yellow-dashboard-root .topbar-title {
              font-size: 1.05rem;
            }

            #yellow-dashboard-root .topbar-subtitle {
              color: rgba(16, 16, 16, 0.64);
              font-size: 0.9em;
            }

            #yellow-dashboard-root .topbar-actions {
              display: flex;
              align-items: center;
              gap: 0.75rem;
              flex-wrap: wrap;
              justify-content: flex-end;
            }

            #yellow-dashboard-root .top-nav {
              display: flex;
              gap: 0.55rem;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .nav-button {
              border: 1px solid rgba(19, 23, 80, 0.12);
              border-radius: 999px;
              padding: 0.55rem 0.9rem;
              font: inherit;
              font-weight: 500;
              cursor: pointer;
              background: rgba(28, 35, 104, 0.05);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .nav-button.is-active {
              background: var(--brand-blue-950);
              color: var(--brand-yellow-500);
              border-color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .session-box {
              display: flex;
              align-items: center;
              gap: 0.55rem;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .session-chip {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              padding: 0.45rem 0.8rem;
              border-radius: 999px;
              background: rgba(255, 217, 61, 0.18);
              color: var(--brand-blue-950);
              font-size: 0.92em;
            }

            #yellow-dashboard-root .page-shell {
              display: none;
              gap: 1rem;
            }

            #yellow-dashboard-root .page-shell.is-active {
              display: grid;
            }

            #yellow-dashboard-root .page-panel,
            #yellow-dashboard-root .public-hero,
            #yellow-dashboard-root .legal-card {
              padding: 1rem;
            }

            #yellow-dashboard-root .public-hero {
              background:
                linear-gradient(140deg, rgba(28, 35, 104, 0.98) 0%, rgba(28, 35, 104, 0.98) 60%, rgba(255, 217, 61, 0.98) 60%, rgba(255, 217, 61, 0.98) 100%);
              color: var(--brand-white);
              display: grid;
              gap: 0.85rem;
            }

            #yellow-dashboard-root .public-hero h2,
            #yellow-dashboard-root .legal-card h2,
            #yellow-dashboard-root .legal-card h3,
            #yellow-dashboard-root .admin-lock h3 {
              margin: 0;
            }

            #yellow-dashboard-root .public-hero p {
              margin: 0;
              max-width: 42rem;
              color: rgba(255, 255, 255, 0.9);
            }

            #yellow-dashboard-root .public-badges {
              display: flex;
              gap: 0.6rem;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .admin-lock {
              padding: 1rem;
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .admin-lock-grid {
              display: grid;
              gap: 1rem;
              grid-template-columns: minmax(0, 1.1fr) minmax(18rem, 0.9fr);
            }

            #yellow-dashboard-root .login-card {
              display: grid;
              gap: 0.8rem;
              padding: 1rem;
              border-radius: 1rem;
              background: rgba(28, 35, 104, 0.04);
              border: 1px solid rgba(19, 23, 80, 0.08);
            }

            #yellow-dashboard-root .login-help {
              display: grid;
              gap: 0.5rem;
            }

            #yellow-dashboard-root .login-message {
              min-height: 1.3rem;
            }

            #yellow-dashboard-root .login-message.is-error {
              color: #8b1e1e;
            }

            #yellow-dashboard-root .login-message.is-success {
              color: #1b5e20;
            }

            #yellow-dashboard-root .manager-only-note {
              padding: 0.75rem 0.85rem;
              border-radius: 0.9rem;
              background: rgba(255, 217, 61, 0.16);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .admin-content[hidden] {
              display: none !important;
            }

            #yellow-dashboard-root .page-hero-row {
              display: flex;
              justify-content: space-between;
              gap: 1rem;
              flex-wrap: wrap;
              align-items: flex-start;
            }

            #yellow-dashboard-root .legal-grid {
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .legal-card {
              display: grid;
              gap: 0.8rem;
            }

            #yellow-dashboard-root .legal-card p,
            #yellow-dashboard-root .legal-card li {
              margin: 0;
              color: rgba(16, 16, 16, 0.82);
            }

            #yellow-dashboard-root .legal-card ul {
              margin: 0;
              padding-inline-start: 1.25rem;
              display: grid;
              gap: 0.45rem;
            }

            #yellow-dashboard-root .graph-control-row {
              display: grid;
              gap: 0.75rem;
              grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
            }

            #yellow-dashboard-root .view-note {
              color: rgba(16, 16, 16, 0.64);
            }

            #yellow-dashboard-root .hero {
              display: grid;
              gap: 1rem;
              grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
              align-items: stretch;
            }

            #yellow-dashboard-root .hero-panel,
            #yellow-dashboard-root .control-panel,
            #yellow-dashboard-root .metric-card,
            #yellow-dashboard-root .prize-card {
              background: var(--brand-white);
              border: 2px solid rgba(19, 23, 80, 0.12);
              border-radius: 1.25rem;
              box-shadow: 0 12px 34px rgba(19, 23, 80, 0.08);
            }

            #yellow-dashboard-root .hero-panel {
              position: relative;
              overflow: hidden;
              padding: 1.25rem;
              background:
                linear-gradient(120deg, rgba(28, 35, 104, 0.98) 0%, rgba(28, 35, 104, 0.98) 54%, rgba(255, 217, 61, 0.98) 54%, rgba(255, 217, 61, 0.98) 100%);
              color: var(--brand-white);
            }

            #yellow-dashboard-root .hero-panel::after {
              content: "";
              position: absolute;
              inset-inline-end: -2rem;
              bottom: -2rem;
              width: 12rem;
              height: 12rem;
              border-radius: 50%;
              background: rgba(255, 255, 255, 0.14);
            }

            #yellow-dashboard-root .brand-layout {
              position: relative;
              z-index: 1;
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .brand-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 1rem;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .logo-wrap {
              width: 8.5rem;
              height: 8.5rem;
              border-radius: 1.1rem;
              background: rgba(255, 255, 255, 0.94);
              display: grid;
              place-items: center;
              padding: 0.7rem;
            }

            #yellow-dashboard-root .logo-wrap img {
              width: 100%;
              height: 100%;
              object-fit: contain;
            }

            #yellow-dashboard-root .brand-copy {
              display: grid;
              gap: 0.35rem;
              min-width: 16rem;
            }

            #yellow-dashboard-root .brand-kicker {
              display: inline-flex;
              align-items: center;
              gap: 0.45rem;
              padding: 0.28rem 0.75rem;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.14);
              color: var(--brand-yellow-400);
              width: fit-content;
              font-size: 0.92em;
            }

            #yellow-dashboard-root .hero-title {
              margin: 0;
              font-size: clamp(1.9rem, 4vw, 2.8rem);
              line-height: 1.05;
              color: var(--brand-white);
            }

            #yellow-dashboard-root .hero-subtitle {
              margin: 0;
              max-width: 36rem;
              color: rgba(255, 255, 255, 0.9);
            }

            #yellow-dashboard-root .hero-badges {
              display: flex;
              flex-wrap: wrap;
              gap: 0.6rem;
            }

            #yellow-dashboard-root .hero-badge {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              padding: 0.45rem 0.8rem;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.12);
              color: var(--brand-white);
              white-space: nowrap;
            }

            #yellow-dashboard-root .control-panel {
              padding: 1rem;
              display: grid;
              gap: 0.9rem;
            }

            #yellow-dashboard-root .control-panel h3,
            #yellow-dashboard-root .section-head h3 {
              margin: 0;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .filters-grid {
              display: grid;
              gap: 0.75rem;
              grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
            }

            #yellow-dashboard-root .form-label {
              display: grid;
              gap: 0.35rem;
              color: var(--brand-blue-950);
              font-weight: 500;
            }

            #yellow-dashboard-root .form-control,
            #yellow-dashboard-root .form-select {
              width: 100%;
              border: 1px solid rgba(19, 23, 80, 0.2);
              border-radius: 0.85rem;
              background: var(--brand-white);
              color: var(--brand-black);
              padding: 0.7rem 0.85rem;
              font: inherit;
              box-sizing: border-box;
            }

            #yellow-dashboard-root .control-note,
            #yellow-dashboard-root .text-small {
              font-size: 0.9em;
            }

            #yellow-dashboard-root .text-muted {
              color: rgba(16, 16, 16, 0.66);
            }

            #yellow-dashboard-root .section-head {
              display: flex;
              justify-content: space-between;
              gap: 1rem;
              flex-wrap: wrap;
              align-items: baseline;
            }

            #yellow-dashboard-root .metric-grid {
              display: grid;
              gap: 0.9rem;
              grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
            }

            #yellow-dashboard-root .metric-card {
              padding: 1rem;
              display: grid;
              gap: 0.35rem;
            }

            #yellow-dashboard-root .metric-label {
              color: rgba(16, 16, 16, 0.66);
            }

            #yellow-dashboard-root .metric-value {
              font-size: clamp(1.5rem, 3vw, 2rem);
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .prize-shell {
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .comparison-shell {
              display: grid;
              gap: 1rem;
            }

            #yellow-dashboard-root .comparison-metric-grid {
              display: grid;
              gap: 0.9rem;
              grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
            }

            #yellow-dashboard-root .comparison-card {
              background: var(--brand-white);
              border: 2px solid rgba(19, 23, 80, 0.12);
              border-radius: 1.15rem;
              padding: 1rem;
              display: grid;
              gap: 0.55rem;
              box-shadow: 0 12px 34px rgba(19, 23, 80, 0.08);
            }

            #yellow-dashboard-root .comparison-card h4 {
              margin: 0;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .comparison-main {
              display: flex;
              justify-content: space-between;
              gap: 0.75rem;
              align-items: baseline;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .comparison-value {
              font-size: 1.35rem;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .comparison-delta {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              padding: 0.28rem 0.65rem;
              border-radius: 999px;
              font-size: 0.92em;
              font-weight: 500;
              background: rgba(19, 23, 80, 0.08);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .comparison-delta.is-up {
              background: rgba(255, 217, 61, 0.3);
            }

            #yellow-dashboard-root .comparison-delta.is-down {
              background: rgba(16, 16, 16, 0.1);
            }

            #yellow-dashboard-root .comparison-lists {
              display: grid;
              gap: 0.9rem;
              grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
            }

            #yellow-dashboard-root .comparison-list {
              background: rgba(255, 255, 255, 0.92);
              border: 2px solid rgba(19, 23, 80, 0.12);
              border-radius: 1.15rem;
              padding: 1rem;
              display: grid;
              gap: 0.7rem;
            }

            #yellow-dashboard-root .comparison-list h4 {
              margin: 0;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .comparison-list ul {
              margin: 0;
              padding: 0;
              list-style: none;
              display: grid;
              gap: 0.55rem;
            }

            #yellow-dashboard-root .comparison-list li {
              padding: 0.55rem 0.65rem;
              border-radius: 0.85rem;
              background: rgba(28, 35, 104, 0.05);
              color: var(--brand-black);
            }

            #yellow-dashboard-root .comparison-list.critical li {
              background: rgba(255, 217, 61, 0.2);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .comparison-list.insights li {
              background: rgba(28, 35, 104, 0.08);
            }

            #yellow-dashboard-root .analysis-shell,
            #yellow-dashboard-root .signal-grid,
            #yellow-dashboard-root .segment-grid {
              display: grid;
              gap: 0.9rem;
            }

            #yellow-dashboard-root .signal-grid,
            #yellow-dashboard-root .segment-grid {
              grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
            }

            #yellow-dashboard-root .analysis-card {
              background: rgba(255, 255, 255, 0.92);
              border: 2px solid rgba(19, 23, 80, 0.12);
              border-radius: 1.15rem;
              padding: 1rem;
              display: grid;
              gap: 0.7rem;
            }

            #yellow-dashboard-root .analysis-card h4 {
              margin: 0;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .analysis-card ul {
              margin: 0;
              padding: 0;
              list-style: none;
              display: grid;
              gap: 0.5rem;
            }

            #yellow-dashboard-root .analysis-card li {
              padding: 0.52rem 0.65rem;
              border-radius: 0.85rem;
              background: rgba(28, 35, 104, 0.05);
            }

            #yellow-dashboard-root .analysis-card.quality li {
              background: rgba(255, 217, 61, 0.2);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .bucket-row {
              display: grid;
              gap: 0.55rem;
            }

            #yellow-dashboard-root .bucket-item {
              display: grid;
              gap: 0.25rem;
            }

            #yellow-dashboard-root .bucket-head {
              display: flex;
              justify-content: space-between;
              gap: 0.75rem;
              align-items: center;
            }

            #yellow-dashboard-root .bucket-bar {
              height: 0.55rem;
              border-radius: 999px;
              overflow: hidden;
              background: rgba(19, 23, 80, 0.08);
            }

            #yellow-dashboard-root .bucket-fill {
              height: 100%;
              border-radius: inherit;
              background: linear-gradient(90deg, rgba(255, 217, 61, 0.95), rgba(28, 35, 104, 0.95));
            }

            #yellow-dashboard-root .action-row {
              display: flex;
              gap: 0.75rem;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .action-button {
              border: 0;
              border-radius: 0.9rem;
              padding: 0.72rem 1rem;
              font: inherit;
              font-weight: 500;
              cursor: pointer;
              background: var(--brand-blue-950);
              color: var(--brand-yellow-500);
            }

            #yellow-dashboard-root .action-button.secondary {
              background: rgba(255, 217, 61, 0.24);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .podium-grid,
            #yellow-dashboard-root .tier-grid {
              display: grid;
              gap: 0.9rem;
              grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
            }

            #yellow-dashboard-root .prize-card {
              overflow: hidden;
              display: grid;
            }

            #yellow-dashboard-root .prize-visual {
              min-height: 8rem;
              padding: 1rem;
              background:
                linear-gradient(160deg, rgba(255, 217, 61, 0.96) 0%, rgba(255, 217, 61, 0.96) 58%, rgba(28, 35, 104, 0.96) 58%, rgba(28, 35, 104, 0.96) 100%);
            }

            #yellow-dashboard-root .prize-card.place-card .prize-visual {
              background:
                linear-gradient(180deg, rgba(28, 35, 104, 0.98) 0%, rgba(28, 35, 104, 0.98) 56%, rgba(255, 217, 61, 0.98) 56%, rgba(255, 217, 61, 0.98) 100%);
            }

            #yellow-dashboard-root .podium-mark,
            #yellow-dashboard-root .tier-mark {
              width: 100%;
              height: 100%;
              display: grid;
              place-items: center;
            }

            #yellow-dashboard-root .prize-content {
              padding: 1rem;
              display: grid;
              gap: 0.7rem;
            }

            #yellow-dashboard-root .prize-title-row {
              display: flex;
              justify-content: space-between;
              gap: 0.75rem;
              align-items: center;
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .prize-title {
              font-size: 1.05rem;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .prize-pill {
              display: inline-flex;
              align-items: center;
              gap: 0.4rem;
              border-radius: 999px;
              padding: 0.35rem 0.65rem;
              background: rgba(255, 217, 61, 0.24);
              color: var(--brand-blue-950);
              font-weight: 500;
            }

            #yellow-dashboard-root .winner-list {
              display: grid;
              gap: 0.55rem;
            }

            #yellow-dashboard-root .winner-item {
              display: grid;
              grid-template-columns: auto 1fr auto;
              gap: 0.6rem;
              align-items: center;
              padding: 0.55rem 0.65rem;
              border-radius: 0.9rem;
              background: rgba(28, 35, 104, 0.05);
            }

            #yellow-dashboard-root .winner-item.is-focus {
              outline: 2px solid var(--brand-yellow-500);
              background: rgba(255, 217, 61, 0.22);
            }

            #yellow-dashboard-root .winner-rank {
              width: 1.7rem;
              height: 1.7rem;
              border-radius: 50%;
              display: grid;
              place-items: center;
              background: var(--brand-blue-950);
              color: var(--brand-yellow-500);
              font-size: 0.88em;
              font-weight: 500;
            }

            #yellow-dashboard-root .winner-name {
              color: var(--brand-blue-950);
              font-weight: 500;
            }

            #yellow-dashboard-root .winner-amount {
              color: rgba(16, 16, 16, 0.72);
              white-space: nowrap;
            }

            #yellow-dashboard-root .status-note {
              padding: 0.7rem 0.8rem;
              border-radius: 0.9rem;
              background: rgba(255, 217, 61, 0.22);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .dashboard-section {
              display: grid;
              gap: 0.75rem;
            }

            #yellow-dashboard-root .chart-frame {
              position: relative;
            }

            #yellow-dashboard-root .chart-panel {
              padding: 1rem;
              border-radius: 1.25rem;
              background: rgba(255, 255, 255, 0.92);
              border: 2px solid rgba(19, 23, 80, 0.12);
            }

            #yellow-dashboard-root svg {
              width: 100%;
              height: auto;
              display: block;
              overflow: visible;
            }

            #yellow-dashboard-root .tooltip {
              position: absolute;
              inset-inline-start: 0;
              top: 0;
              transform: translate(-9999px, -9999px);
              visibility: hidden;
              pointer-events: none;
              max-width: 16rem;
              padding: 0.55rem 0.75rem;
              border: 1px solid rgba(19, 23, 80, 0.24);
              border-radius: 0.9rem;
              background: var(--brand-white);
              color: var(--brand-black);
              box-shadow: 0 18px 36px rgba(19, 23, 80, 0.14);
              z-index: 10;
            }

            #yellow-dashboard-root .tooltip.is-visible {
              visibility: visible;
            }

            #yellow-dashboard-root .matrix-label {
              cursor: pointer;
              fill: var(--brand-blue-950);
              font-weight: 500;
            }

            #yellow-dashboard-root .matrix-label.is-active {
              fill: var(--brand-blue-500);
            }

            #yellow-dashboard-root .clickable-cell {
              cursor: pointer;
            }

            #yellow-dashboard-root .legend-row {
              display: flex;
              gap: 0.75rem;
              flex-wrap: wrap;
              align-items: center;
            }

            #yellow-dashboard-root .legend-item {
              display: inline-flex;
              gap: 0.4rem;
              align-items: center;
            }

            #yellow-dashboard-root .legend-swatch {
              width: 0.95rem;
              height: 0.95rem;
              border-radius: 0.25rem;
              display: inline-block;
              vertical-align: middle;
            }

            #yellow-dashboard-root .table-wrap {
              overflow-x: auto;
              border-radius: 1rem;
              border: 2px solid rgba(19, 23, 80, 0.12);
              background: var(--brand-white);
            }

            #yellow-dashboard-root table {
              width: 100%;
              border-collapse: collapse;
            }

            #yellow-dashboard-root th,
            #yellow-dashboard-root td {
              padding: 0.7rem 0.6rem;
              border-bottom: 1px solid rgba(19, 23, 80, 0.08);
              text-align: right;
              vertical-align: top;
            }

            #yellow-dashboard-root th {
              background: rgba(28, 35, 104, 0.05);
              color: var(--brand-blue-950);
              font-weight: 500;
            }

            #yellow-dashboard-root tbody tr:hover {
              background: rgba(255, 217, 61, 0.15);
            }

            #yellow-dashboard-root .amount-cell {
              white-space: nowrap;
              font-weight: 500;
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .status-badge {
              display: inline-flex;
              padding: 0.22rem 0.55rem;
              border-radius: 999px;
              font-size: 0.86em;
              background: rgba(28, 35, 104, 0.12);
              color: var(--brand-blue-950);
            }

            #yellow-dashboard-root .status-badge.failed {
              background: rgba(16, 16, 16, 0.12);
              color: var(--brand-black);
            }

            #yellow-dashboard-root .empty-state {
              padding: 0.9rem 0;
              color: rgba(16, 16, 16, 0.66);
            }

            @media (max-width: 840px) {
              #yellow-dashboard-root .admin-lock-grid {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .hero {
                grid-template-columns: 1fr;
              }
            }

            @media (max-width: 560px) {
              #yellow-dashboard-root .app-topbar,
              #yellow-dashboard-root .topbar-actions,
              #yellow-dashboard-root .session-box {
                align-items: stretch;
              }

              #yellow-dashboard-root .hero-panel {
                padding: 1rem;
              }

              #yellow-dashboard-root .brand-row,
              #yellow-dashboard-root .section-head {
                flex-direction: column;
                align-items: stretch;
              }

              #yellow-dashboard-root .logo-wrap {
                width: 6.8rem;
                height: 6.8rem;
              }
            }
          </style>

          <div class="app-shell">
            <header class="app-topbar">
              <div class="topbar-brand">
                <img id="topbar-logo" class="topbar-logo" alt="לוגו אחים לסמל" />
                <div class="topbar-meta">
                  <div class="topbar-title">אחים לסמל · מערכת ניהול קמפיין</div>
                  <div class="topbar-subtitle">דשבורד רב־עמודי למנהלים, משתתפים ותצוגת תחרות</div>
                </div>
              </div>
              <div class="topbar-actions">
                <nav class="top-nav" aria-label="ניווט עמודים">
                  <button class="nav-button" type="button" data-page-target="prizes">פרסים ותחרות</button>
                  <button class="nav-button" type="button" data-page-target="rules">תקנון השתתפות</button>
                  <button class="nav-button" type="button" data-page-target="privacy">פרטיות</button>
                  <button class="nav-button" type="button" data-page-target="admin">דשבורד ניהולי</button>
                </nav>
                <div class="session-box">
                  <div id="session-status" class="session-chip">מצב ניהול: אורח/ת</div>
                  <button id="go-admin-login" class="action-button secondary" type="button">כניסת מנהלים</button>
                  <button id="logout-button" class="action-button secondary" type="button" hidden>התנתקות</button>
                </div>
              </div>
            </header>

            <section id="page-prizes" class="page-shell is-active">
              <article class="public-hero">
                <div class="page-hero-row">
                  <div class="brand-copy">
                    <span class="brand-kicker">ציבורי למשתתפים ולמנהלים</span>
                    <h2 class="hero-title">דשבורד פרסים ותחרות</h2>
                    <p>תצוגת תחרות ייעודית לזוכים הנוכחיים, למדרגות הפעילות ולמצב הפרסים נכון לרגע זה על בסיס הנתונים שהועלו למערכת.</p>
                  </div>
                </div>
                <div id="public-hero-badges" class="public-badges"></div>
              </article>

              <section class="page-panel">
                <div class="section-head">
                  <h3>פרסים, מדרגות וזוכים חיים</h3>
                  <div id="prize-summary" class="text-small text-muted"></div>
                </div>
                <div id="prize-board" class="prize-shell"></div>
              </section>
            </section>

            <section id="page-rules" class="page-shell">
              <div class="legal-grid">
                <article class="legal-card">
                  <h2>תקנון השתתפות</h2>
                  <p>זהו נוסח עבודה ראשוני לשימוש פנימי ולהצגה במוצר. לפני עלייה לאוויר מומלץ לבצע אישור משפטי וניסוח סופי מטעם הארגון.</p>
                </article>
                <article class="legal-card">
                  <h3>זכאות להשתתפות</h3>
                  <ul>
                    <li>השתתפות בתחרות ובמסלולי הפרסים כפופה לרישום כשגריר/ה במערכת ולפעילות במהלך ימי הקמפיין.</li>
                    <li>הארגון רשאי להגדיר תנאי סף, שיוך לקבוצות, או החרגת משתמשים שאינם עומדים בכללי הפעילות.</li>
                    <li>רק עסקאות שנקלטו במערכת באופן תקין ושויכו בהתאם לכללי הקמפיין ייחשבו לצורך התחרות.</li>
                  </ul>
                </article>
                <article class="legal-card">
                  <h3>חישוב תוצאות וזכייה</h3>
                  <ul>
                    <li>הדירוג נקבע לפי טבלת הפרסים ומדרגות הפרס המעודכנות במערכת.</li>
                    <li>הנהלת הקמפיין רשאית לקבוע האם הזכאות מבוססת על סכום גיוס, מספר עסקאות, או שילוב של שניהם.</li>
                    <li>במקרה של פערי מידע, כפילויות, כשלי סליקה, ביטולים או עסקאות חוזרות, הכרעת הנהלת הקמפיין היא הקובעת.</li>
                  </ul>
                </article>
                <article class="legal-card">
                  <h3>עדכונים, שוויון ותיקונים</h3>
                  <ul>
                    <li>הדשבורד מתעדכן לפי נתוני המקור שהועלו, ולכן ייתכנו שינויים במהלך הקמפיין.</li>
                    <li>במקרה של שוויון בין משתתפים, הארגון רשאי להפעיל כללי הכרעה משלימים.</li>
                    <li>הארגון שומר לעצמו את הזכות לעדכן את התקנון, את מדרגות הפרסים או את מנגנון החישוב, בכפוף לדין ולהודעה מתאימה.</li>
                  </ul>
                </article>
              </div>
            </section>

            <section id="page-privacy" class="page-shell">
              <div class="legal-grid">
                <article class="legal-card">
                  <h2>מדיניות פרטיות</h2>
                  <p>זהו נוסח עבודה ראשוני. לפני פרסום חיצוני מומלץ לאמת את הנוסח עם ייעוץ משפטי, אבטחת מידע ונהלי הארגון.</p>
                </article>
                <article class="legal-card">
                  <h3>אילו נתונים עשויים להיקלט</h3>
                  <ul>
                    <li>שם תורם/ת, כתובת דוא"ל, סכום תרומה, זמן ביצוע, שיוך לשגריר/ה, סטטוס עסקה ושדות תפעוליים נוספים.</li>
                    <li>במסכי הניהול ניתן לנתח את הנתונים לצורך תפעול, בקרה, תחרות, פרסים וקבלת החלטות.</li>
                  </ul>
                </article>
                <article class="legal-card">
                  <h3>מטרות השימוש</h3>
                  <ul>
                    <li>הצגת נתונים ניהוליים בזמן אמת.</li>
                    <li>זיהוי מגמות גיוס, זוכים, שגרירים מובילים, תקלות וחריגות.</li>
                    <li>השוואות בין קבצים, בין תקופות ובין מחזורי קמפיין שונים.</li>
                  </ul>
                </article>
                <article class="legal-card">
                  <h3>גישה והרשאות</h3>
                  <ul>
                    <li>העמודים הציבוריים נגישים למשתתפים ולמנהלים.</li>
                    <li>הדשבורד הניהולי זמין רק למשתמשים מורשים לפי מייל שהוגדר מראש ובאמצעות סיסמה.</li>
                    <li>לפני עלייה לאוויר יש להעביר את מנגנון הזיהוי לאימות שרת אמיתי ולא להסתמך על קוד צד־לקוח בלבד.</li>
                  </ul>
                </article>
                <article class="legal-card">
                  <h3>שמירת מידע ואבטחה</h3>
                  <ul>
                    <li>בגרסת הפיילוט המערכת עובדת מקומית ומקטינה את חשיפת המידע, אך עדיין יש לנהוג בזהירות בקבצי המקור.</li>
                    <li>מומלץ להגדיר מדיניות שמירה, מחיקה, גיבוי והרשאות צפייה לפי תפקיד.</li>
                    <li>בעתיד יש להוסיף שכבת Backend, ניהול משתמשים, ורישום פעולות לצורכי בקרה.</li>
                  </ul>
                </article>
              </div>
            </section>

            <section id="page-admin" class="page-shell">
              <section id="admin-lock" class="admin-lock">
                <div class="section-head">
                  <h3>כניסה לפאנל הניהול</h3>
                  <div class="text-small text-muted">גישה מוגבלת למנהלים מורשים מראש לפי מייל וסיסמה.</div>
                </div>
                <div class="admin-lock-grid">
                  <div class="login-help">
                    <div class="manager-only-note">
                      הדשבורד הניהולי כולל פילוח מתקדם, שינוי תצוגות גרפיות, השוואה בין קבצים, ייצוא נתונים ותמונת מצב תפעולית.
                    </div>
                    <div class="manager-only-note">
                      הערת אבטחה: בגרסה זו מדובר בשער גישה מקומי המבוסס צד־לקוח. לפני פרסום חיצוני חובה להעביר את האימות לשרת מאובטח.
                    </div>
                  </div>
                  <form id="login-form" class="login-card">
                    <label class="form-label">
                      מייל מנהל/ת
                      <input id="login-email" class="form-control" type="email" placeholder="name@example.org" />
                    </label>
                    <label class="form-label">
                      סיסמה
                      <input id="login-password" class="form-control" type="password" placeholder="הקלד/י סיסמה" />
                    </label>
                    <button id="login-button" class="action-button" type="submit">כניסה לפאנל הניהול</button>
                    <div id="login-message" class="login-message text-small"></div>
                  </form>
                </div>
              </section>

              <div id="admin-content" class="admin-content" hidden>
                <div class="dashboard-shell">
                  <section class="hero">
                    <article class="hero-panel">
                      <div class="brand-layout">
                        <div class="brand-row">
                          <div class="brand-copy">
                            <span class="brand-kicker">ממשק כחול־צהוב חי</span>
                            <h1 class="hero-title">דשבורד הגיוס של אחים לסמל</h1>
                            <p class="hero-subtitle">פילוח לפי תאריך, שעה, טווח שעות, יום פרויקט, שגריר/ה ותורם/ת, עם יכולת שינוי גרפים, השוואת קבצים ותמונת מצב ניהולית.</p>
                          </div>
                          <div class="logo-wrap">
                            <img id="brand-logo" alt="לוגו אחים לסמל" />
                          </div>
                        </div>
                        <div id="hero-badges" class="hero-badges"></div>
                      </div>
                    </article>

                    <aside class="control-panel">
                      <div class="section-head">
                        <h3>קלטים ושליטה</h3>
                        <div class="control-note text-muted">אפשר להחליף את קובץ העסקאות, קובץ ההשוואה וקובץ הפרסים.</div>
                      </div>
                      <div class="filters-grid">
                        <label class="form-label">
                          קובץ עסקאות
                          <input id="csv-upload" class="form-control" type="file" accept=".csv,text/csv" />
                        </label>
                        <label class="form-label">
                          קובץ השוואה
                          <input id="compare-upload" class="form-control" type="file" accept=".csv,text/csv" />
                        </label>
                        <label class="form-label">
                          קובץ פרסים
                          <input id="prize-upload" class="form-control" type="file" accept=".xlsx,.xls,.csv,text/csv" />
                        </label>
                        <label class="form-label">
                          שגריר/ה
                          <select id="ambassador-filter" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          יום פרויקט
                          <select id="project-day-filter" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          תאריך מדויק
                          <select id="date-exact" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          תאריך התחלה
                          <input id="date-from" class="form-control" type="date" />
                        </label>
                        <label class="form-label">
                          תאריך סיום
                          <input id="date-to" class="form-control" type="date" />
                        </label>
                        <label class="form-label">
                          שעה
                          <select id="hour-filter" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          משעה
                          <select id="hour-from-filter" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          עד שעה
                          <select id="hour-to-filter" class="form-select"></select>
                        </label>
                        <label class="form-label">
                          שם התורם/ת
                          <input id="donor-filter" class="form-control" type="text" placeholder="חיפוש לפי שם תורם" />
                        </label>
                        <label class="form-label">
                          סכום מינימלי
                          <input id="amount-min-filter" class="form-control" type="number" min="0" step="50" placeholder="למשל 180" />
                        </label>
                        <label class="form-label">
                          סכום מקסימלי
                          <input id="amount-max-filter" class="form-control" type="number" min="0" step="50" placeholder="למשל 5000" />
                        </label>
                        <label class="form-label">
                          יעד כולל
                          <input id="goal-total" class="form-control" type="number" min="0" step="100" placeholder="למשל 1500000" />
                        </label>
                        <label class="form-label">
                          יעד יומי
                          <input id="goal-daily" class="form-control" type="number" min="0" step="100" placeholder="למשל 150000" />
                        </label>
                      </div>
                      <div class="action-row">
                        <button id="export-filtered" class="action-button" type="button">ייצוא הנתונים המסוננים</button>
                        <button id="clear-compare" class="action-button secondary" type="button">ניקוי קובץ ההשוואה</button>
                      </div>
                      <div id="control-note" class="status-note text-small"></div>
                    </aside>
                  </section>

                  <section id="metrics-grid" class="metric-grid" aria-label="מדדי סיכום"></section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>תצוגות גרפיות</h3>
                      <div class="view-note text-small">מנהלים יכולים לשנות כאן את המדד שמוצג בכל גרף.</div>
                    </div>
                    <div class="graph-control-row">
                      <label class="form-label">
                        גרף יומי
                        <select id="daily-metric-select" class="form-select">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                          <option value="average">ממוצע לעסקה</option>
                        </select>
                      </label>
                      <label class="form-label">
                        מפת חום
                        <select id="heatmap-metric-select" class="form-select">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                        </select>
                      </label>
                      <label class="form-label">
                        תנועת שגרירים
                        <select id="movement-metric-select" class="form-select">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                        </select>
                      </label>
                    </div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>יעדים מול ביצוע</h3>
                      <div id="goals-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="goals-board" class="analysis-shell"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>ולידציה של קבצי הקלט</h3>
                      <div id="validation-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="validation-board" class="analysis-shell"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>סיכום ניהולי</h3>
                      <div id="executive-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="executive-board" class="analysis-shell"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>איכות נתונים וסיכונים</h3>
                      <div id="quality-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="quality-board" class="analysis-shell"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>פילוח עסקאות ותורמים</h3>
                      <div id="segment-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="segment-board" class="analysis-shell"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>השוואה בין שני קבצים</h3>
                      <div id="comparison-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="comparison-board" class="comparison-shell"></div>
                  </section>

                  <section class="dashboard-section chart-frame">
                    <div class="chart-panel">
                      <div class="section-head">
                        <h3>מגמת גיוס יומית</h3>
                        <div id="daily-chart-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="daily-chart"></div>
                    </div>
                    <div id="daily-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                  </section>

                  <section class="dashboard-section chart-frame">
                    <div class="chart-panel">
                      <div class="section-head">
                        <h3>מפת חום לפי ימים ושעות</h3>
                        <div class="legend-row text-small text-muted">
                          <span class="legend-item"><span class="legend-swatch" style="background: rgba(255, 217, 61, 0.2); border: 1px solid rgba(19, 23, 80, 0.14);"></span>נמוך</span>
                          <span class="legend-item"><span class="legend-swatch" style="background: rgba(255, 217, 61, 0.95); border: 1px solid rgba(19, 23, 80, 0.14);"></span>גבוה</span>
                        </div>
                      </div>
                      <div id="heatmap-chart"></div>
                    </div>
                    <div id="heatmap-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                  </section>

                  <section class="dashboard-section chart-frame">
                    <div class="chart-panel">
                      <div class="section-head">
                        <h3>תנועת שגרירים לאורך ימי הפרויקט</h3>
                        <div id="movement-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="movement-chart"></div>
                    </div>
                    <div id="movement-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                  </section>

                  <section class="dashboard-section">
                    <div class="section-head">
                      <h3>רשומות מסוננות</h3>
                      <div id="table-summary" class="text-small text-muted"></div>
                    </div>
                    <div id="table-root" class="table-wrap"></div>
                  </section>
                </div>
              </div>
            </section>
          </div>
          <script>
            (() => {
              const INITIAL_ROWS = __INITIAL_ROWS__;
              const INITIAL_META = __INITIAL_META__;
              const INITIAL_LOGO = __INITIAL_LOGO__;
              const INITIAL_PRIZES = __INITIAL_PRIZES__;
              const ACCESS_CONTROL = __ACCESS_CONTROL__;
              const PRIZE_STORAGE_KEY = "yellow-dashboard.prize-model";
              const GOAL_STORAGE_KEY = "yellow-dashboard.goals";
              const SESSION_STORAGE_KEY = "yellow-dashboard.manager-session";
              const XLSX_MODULE_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
              const root = document.getElementById("yellow-dashboard-root");

              const elements = {
                topbarLogo: root.querySelector("#topbar-logo"),
                logo: root.querySelector("#brand-logo"),
                navButtons: Array.from(root.querySelectorAll("[data-page-target]")),
                pagePrizes: root.querySelector("#page-prizes"),
                pageRules: root.querySelector("#page-rules"),
                pagePrivacy: root.querySelector("#page-privacy"),
                pageAdmin: root.querySelector("#page-admin"),
                sessionStatus: root.querySelector("#session-status"),
                goAdminLogin: root.querySelector("#go-admin-login"),
                logoutButton: root.querySelector("#logout-button"),
                publicHeroBadges: root.querySelector("#public-hero-badges"),
                adminLock: root.querySelector("#admin-lock"),
                adminContent: root.querySelector("#admin-content"),
                loginForm: root.querySelector("#login-form"),
                loginEmail: root.querySelector("#login-email"),
                loginPassword: root.querySelector("#login-password"),
                loginMessage: root.querySelector("#login-message"),
                heroBadges: root.querySelector("#hero-badges"),
                controlNote: root.querySelector("#control-note"),
                upload: root.querySelector("#csv-upload"),
                compareUpload: root.querySelector("#compare-upload"),
                prizeUpload: root.querySelector("#prize-upload"),
                goalTotal: root.querySelector("#goal-total"),
                goalDaily: root.querySelector("#goal-daily"),
                dailyMetric: root.querySelector("#daily-metric-select"),
                heatmapMetric: root.querySelector("#heatmap-metric-select"),
                movementMetric: root.querySelector("#movement-metric-select"),
                exportFiltered: root.querySelector("#export-filtered"),
                clearCompare: root.querySelector("#clear-compare"),
                ambassador: root.querySelector("#ambassador-filter"),
                projectDay: root.querySelector("#project-day-filter"),
                dateExact: root.querySelector("#date-exact"),
                dateFrom: root.querySelector("#date-from"),
                dateTo: root.querySelector("#date-to"),
                hour: root.querySelector("#hour-filter"),
                hourFrom: root.querySelector("#hour-from-filter"),
                hourTo: root.querySelector("#hour-to-filter"),
                donor: root.querySelector("#donor-filter"),
                amountMin: root.querySelector("#amount-min-filter"),
                amountMax: root.querySelector("#amount-max-filter"),
                metrics: root.querySelector("#metrics-grid"),
                goalsBoard: root.querySelector("#goals-board"),
                goalsSummary: root.querySelector("#goals-summary"),
                validationBoard: root.querySelector("#validation-board"),
                validationSummary: root.querySelector("#validation-summary"),
                executiveBoard: root.querySelector("#executive-board"),
                executiveSummary: root.querySelector("#executive-summary"),
                qualityBoard: root.querySelector("#quality-board"),
                qualitySummary: root.querySelector("#quality-summary"),
                segmentBoard: root.querySelector("#segment-board"),
                segmentSummary: root.querySelector("#segment-summary"),
                comparisonBoard: root.querySelector("#comparison-board"),
                comparisonSummary: root.querySelector("#comparison-summary"),
                prizeBoard: root.querySelector("#prize-board"),
                prizeSummary: root.querySelector("#prize-summary"),
                dailyChart: root.querySelector("#daily-chart"),
                dailyTooltip: root.querySelector("#daily-tooltip"),
                dailySummary: root.querySelector("#daily-chart-summary"),
                heatmapChart: root.querySelector("#heatmap-chart"),
                heatmapTooltip: root.querySelector("#heatmap-tooltip"),
                movementChart: root.querySelector("#movement-chart"),
                movementTooltip: root.querySelector("#movement-tooltip"),
                movementSummary: root.querySelector("#movement-summary"),
                tableRoot: root.querySelector("#table-root"),
                tableSummary: root.querySelector("#table-summary"),
              };

              const state = {
                rows: INITIAL_ROWS,
                meta: INITIAL_META,
                sourceLabel: "קובץ בסיס",
                compare: {
                  rows: [],
                  meta: null,
                  label: "",
                },
                validation: {
                  base: null,
                  compare: null,
                },
                goals: readStoredGoals(),
                prizeModel: readStoredPrizeModel() || INITIAL_PRIZES,
                session: readStoredSession(),
                filters: {
                  ambassador: "all",
                  projectDay: "all",
                  dateExact: "all",
                  hour: "all",
                  hourFrom: "all",
                  hourTo: "all",
                  dateFrom: INITIAL_META.defaultFrom || "",
                  dateTo: INITIAL_META.defaultTo || "",
                  donor: "",
                  amountMin: "",
                  amountMax: "",
                },
                view: {
                  dailyMetric: "amount",
                  heatmapMetric: "amount",
                  movementMetric: "amount",
                },
                ui: {
                  page: "prizes",
                },
              };

              const weekdayFormatter = new Intl.DateTimeFormat("he-IL", { weekday: "short" });
              const dateFormatter = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
              const dateShortFormatter = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" });
              const dateTimeFormatter = new Intl.DateTimeFormat("he-IL", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              const currencyFormatter = new Intl.NumberFormat("he-IL", {
                style: "currency",
                currency: "ILS",
                maximumFractionDigits: 0,
              });
              const numberFormatter = new Intl.NumberFormat("he-IL");

              function readStoredPrizeModel() {
                try {
                  const raw = window.localStorage.getItem(PRIZE_STORAGE_KEY);
                  return raw ? JSON.parse(raw) : null;
                } catch (_error) {
                  return null;
                }
              }

              function storePrizeModel(model) {
                try {
                  window.localStorage.setItem(PRIZE_STORAGE_KEY, JSON.stringify(model));
                } catch (_error) {
                  return;
                }
              }

              function readStoredGoals() {
                try {
                  const raw = window.localStorage.getItem(GOAL_STORAGE_KEY);
                  const parsed = raw ? JSON.parse(raw) : null;
                  return {
                    total: Number(parsed?.total || 0),
                    daily: Number(parsed?.daily || 0),
                  };
                } catch (_error) {
                  return { total: 0, daily: 0 };
                }
              }

              function storeGoals(goals) {
                try {
                  window.localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(goals));
                } catch (_error) {
                  return;
                }
              }

              function readStoredSession() {
                try {
                  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
                  const parsed = raw ? JSON.parse(raw) : null;
                  if (!parsed?.email) {
                    return null;
                  }
                  const email = normalizeSearchToken(parsed.email);
                  return ACCESS_CONTROL.managerEmails.map((value) => normalizeSearchToken(value)).includes(email)
                    ? { email }
                    : null;
                } catch (_error) {
                  return null;
                }
              }

              function storeSession(email) {
                state.session = { email };
                try {
                  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.session));
                } catch (_error) {
                  return;
                }
              }

              function clearSession() {
                state.session = null;
                try {
                  window.localStorage.removeItem(SESSION_STORAGE_KEY);
                } catch (_error) {
                  return;
                }
              }

              function isManagerAuthenticated() {
                return Boolean(state.session?.email);
              }

              function setLoginMessage(message, tone = "") {
                elements.loginMessage.textContent = message;
                elements.loginMessage.className = `login-message text-small${tone ? ` is-${tone}` : ""}`;
              }

              async function hashPassword(value) {
                const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
                return Array.from(new Uint8Array(buffer))
                  .map((item) => item.toString(16).padStart(2, "0"))
                  .join("");
              }

              function setPage(page) {
                const nextPage = page === "admin" || page === "rules" || page === "privacy" ? page : "prizes";
                state.ui.page = nextPage;
                const pageMap = {
                  prizes: elements.pagePrizes,
                  rules: elements.pageRules,
                  privacy: elements.pagePrivacy,
                  admin: elements.pageAdmin,
                };
                Object.entries(pageMap).forEach(([key, element]) => {
                  element.classList.toggle("is-active", key === nextPage);
                });
                elements.navButtons.forEach((button) => {
                  button.classList.toggle("is-active", button.dataset.pageTarget === nextPage);
                });
                refreshAccessUi();
              }

              function refreshAccessUi() {
                const isManager = isManagerAuthenticated();
                elements.sessionStatus.textContent = isManager ? `מחובר/ת כמנהל/ת: ${state.session.email}` : "מצב ניהול: אורח/ת";
                elements.logoutButton.hidden = !isManager;
                elements.goAdminLogin.hidden = isManager;
                elements.adminLock.hidden = isManager;
                elements.adminContent.hidden = !isManager;
                if (state.ui.page === "admin" && !isManager) {
                  setLoginMessage("יש להזין מייל מורשה וסיסמה כדי לצפות בדשבורד הניהולי.");
                }
              }

              function formatAmount(value) {
                return currencyFormatter.format(value || 0);
              }

              function formatNumber(value) {
                return numberFormatter.format(value || 0);
              }

              function formatDate(value) {
                return value ? dateFormatter.format(new Date(`${value}T00:00:00`)) : "";
              }

              function formatShortDate(value) {
                return value ? dateShortFormatter.format(new Date(`${value}T00:00:00`)) : "";
              }

              function formatDateTime(value) {
                return value ? dateTimeFormatter.format(new Date(value)) : "";
              }

              function formatHourLabel(value) {
                return `${String(value).padStart(2, "0")}:00`;
              }

              function getWeekdayLabel(dateString) {
                return weekdayFormatter.format(new Date(`${dateString}T00:00:00`));
              }

              function normalizeSearchToken(value) {
                return String(value || "")
                  .trim()
                  .toLocaleLowerCase("he-IL");
              }

              function escapeHtml(value) {
                return String(value)
                  .replaceAll("&", "&amp;")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;")
                  .replaceAll('"', "&quot;");
              }

              function escapeAttribute(value) {
                return escapeHtml(value).replaceAll("'", "&#39;");
              }

              function ensureMeta(rows) {
                const uniqueDates = [...new Set(rows.map((row) => row.date))].sort();
                const projectDates = uniqueDates.slice(0, 10);
                return {
                  uniqueDates,
                  projectDates,
                  minDate: uniqueDates[0] || "",
                  maxDate: uniqueDates[uniqueDates.length - 1] || "",
                  defaultFrom: projectDates[0] || uniqueDates[0] || "",
                  defaultTo: projectDates[projectDates.length - 1] || uniqueDates[uniqueDates.length - 1] || "",
                  rowCount: rows.length,
                  projectWindowLabel: projectDates.length ? `${projectDates[0]} עד ${projectDates[projectDates.length - 1]}` : "",
                };
              }

              function getFilterMeta() {
                const metas = [state.meta, state.compare.meta].filter(Boolean);
                const uniqueDates = [...new Set(metas.flatMap((meta) => meta.uniqueDates || []))].sort();
                const projectDates = (state.meta?.projectDates?.length ? state.meta.projectDates : state.compare.meta?.projectDates) || [];
                return {
                  uniqueDates,
                  projectDates,
                  minDate: uniqueDates[0] || "",
                  maxDate: uniqueDates[uniqueDates.length - 1] || "",
                };
              }

              function enrichRows(rows, meta) {
                const projectIndex = new Map(meta.projectDates.map((date, index) => [date, index + 1]));
                return rows.map((row) => {
                  const date = row.date;
                  const dayIndex = projectIndex.get(date) || null;
                  return {
                    ...row,
                    ambassador: row.ambassador && row.ambassador.trim() ? row.ambassador.trim() : "ללא שיוך",
                    donor: row.donor && row.donor.trim() ? row.donor.trim() : "ללא שם",
                    city: row.city && row.city.trim() ? row.city.trim() : "ללא עיר",
                    projectDay: dayIndex,
                    projectDayLabel: dayIndex ? `יום ${dayIndex}` : "מחוץ לחלון",
                  };
                });
              }

              function parseCsv(text) {
                const rows = [];
                let row = [];
                let field = "";
                let inQuotes = false;

                for (let index = 0; index < text.length; index += 1) {
                  const char = text[index];

                  if (inQuotes) {
                    if (char === '"') {
                      if (text[index + 1] === '"') {
                        field += '"';
                        index += 1;
                      } else {
                        inQuotes = false;
                      }
                    } else {
                      field += char;
                    }
                  } else if (char === '"') {
                    inQuotes = true;
                  } else if (char === ",") {
                    row.push(field);
                    field = "";
                  } else if (char === "\\n") {
                    row.push(field);
                    rows.push(row);
                    row = [];
                    field = "";
                  } else if (char !== "\\r") {
                    field += char;
                  }
                }

                if (field.length || row.length) {
                  row.push(field);
                  rows.push(row);
                }

                return rows.filter((cells) => cells.some((cell) => String(cell || "").trim()));
              }

              function csvMatrixToRecords(matrix) {
                if (!matrix.length) {
                  return [];
                }
                const headers = matrix[0].map((header, index) => (index === 0 ? String(header || "").replace(/^\\uFEFF/, "") : String(header || "")));
                return matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
              }

              function validateRawRows(rawRows, label) {
                const requiredColumns = ["id", "created_at", "full_name", "total", "Ambassador name", "charged_success", "charge_result"];
                const availableColumns = rawRows.length ? Object.keys(rawRows[0]) : [];
                const missingColumns = requiredColumns.filter((column) => !availableColumns.includes(column));
                const invalidDateRows = [];
                const invalidAmountRows = [];
                const missingAmbassadorRows = [];
                const missingEmailRows = [];
                const duplicateIds = new Map();
                const validRows = [];

                rawRows.forEach((row, index) => {
                  const rowNumber = index + 2;
                  const createdAt = String(row["created_at"] || "").trim();
                  const totalText = String(row["total"] || "").trim();
                  const ambassador = String(row["Ambassador name"] || "").trim();
                  const email = String(row["email"] || "").trim();
                  const id = String(row["id"] || "").trim();

                  if (!createdAt) {
                    invalidDateRows.push(rowNumber);
                  }
                  if (!createdAt || !/^\\d{2}\\/\\d{2}\\/\\d{2}\\s\\d{2}:\\d{2}$/.test(createdAt)) {
                    if (!invalidDateRows.includes(rowNumber)) {
                      invalidDateRows.push(rowNumber);
                    }
                  }

                  const amount = Number.parseFloat(totalText || "0");
                  if (!totalText || Number.isNaN(amount)) {
                    invalidAmountRows.push(rowNumber);
                  }

                  if (!ambassador) {
                    missingAmbassadorRows.push(rowNumber);
                  }

                  if (!email) {
                    missingEmailRows.push(rowNumber);
                  }

                  if (id) {
                    duplicateIds.set(id, (duplicateIds.get(id) || 0) + 1);
                  }

                  if (createdAt && !Number.isNaN(amount)) {
                    validRows.push(row);
                  }
                });

                const duplicateIdCount = [...duplicateIds.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
                const errors = [];
                const warnings = [];

                if (missingColumns.length) {
                  errors.push(`חסרות עמודות חובה: ${missingColumns.join(", ")}`);
                }
                if (invalidDateRows.length) {
                  errors.push(`${invalidDateRows.length} רשומות עם תאריך/שעה לא תקין בקובץ ${label}.`);
                }
                if (invalidAmountRows.length) {
                  errors.push(`${invalidAmountRows.length} רשומות עם סכום חסר או לא מספרי בקובץ ${label}.`);
                }
                if (missingAmbassadorRows.length) {
                  warnings.push(`${missingAmbassadorRows.length} רשומות ללא שיוך שגריר/ה.`);
                }
                if (missingEmailRows.length) {
                  warnings.push(`${missingEmailRows.length} רשומות ללא אימייל תורם.`);
                }
                if (duplicateIdCount) {
                  warnings.push(`${duplicateIdCount} רשומות עם מזהי עסקה כפולים אפשריים.`);
                }

                return {
                  label,
                  totalRows: rawRows.length,
                  validRows,
                  errors,
                  warnings,
                  missingColumns,
                  invalidDateRows: invalidDateRows.length,
                  invalidAmountRows: invalidAmountRows.length,
                  missingAmbassadorRows: missingAmbassadorRows.length,
                  missingEmailRows: missingEmailRows.length,
                  duplicateIdCount,
                };
              }

              function ingestCsvText(text, label) {
                const rawRows = csvMatrixToRecords(parseCsv(text));
                const validation = validateRawRows(rawRows, label);
                const normalized = normalizeUploadRows(validation.validRows);
                const meta = ensureMeta(normalized);
                return {
                  rawRows,
                  validation,
                  normalized,
                  meta,
                };
              }

              function normalizeUploadRows(rawRows) {
                return rawRows
                  .map((raw) => {
                    const createdAt = String(raw["created_at"] || "").trim();
                    if (!createdAt) {
                      return null;
                    }
                    const [datePart, timePart] = createdAt.split(" ");
                    const [day, month, year] = datePart.split("/");
                    const isoYear = Number(year) < 70 ? `20${year}` : `19${year}`;
                    const createdIso = `${isoYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timePart}:00`;
                    return {
                      id: String(raw["id"] || "").trim(),
                      createdIso,
                      date: createdIso.slice(0, 10),
                      hour: Number(timePart.split(":")[0]),
                      email: String(raw["email"] || "").trim().toLowerCase(),
                      donor: String(raw["full_name"] || "").trim() || "ללא שם",
                      ambassador: String(raw["Ambassador name"] || "").trim() || "ללא שיוך",
                      amount: Number.parseFloat(String(raw["total"] || "0").trim() || "0") || 0,
                      city: String(raw["city"] || "").trim() || "ללא עיר",
                      status: String(raw["charged_success"] || "").trim().toLowerCase() === "true" ? "success" : "failed",
                      chargeResult: String(raw["charge_result"] || "").trim(),
                    };
                  })
                  .filter(Boolean);
              }

              function coerceNumber(value) {
                const text = String(value ?? "").replaceAll(",", "").trim();
                if (!text) {
                  return null;
                }
                const numeric = Number(text);
                return Number.isFinite(numeric) ? numeric : null;
              }

              function normalizePrizeModel(model) {
                const placePrizes = (model.placePrizes || [])
                  .map((item) => ({
                    place: Number(item.place),
                    label: String(item.label || `מקום ${item.place}`),
                    prize: String(item.prize || "").trim(),
                  }))
                  .filter((item) => item.place && item.prize)
                  .sort((left, right) => left.place - right.place);

                const tierPrizes = (model.tierPrizes || [])
                  .map((item) => ({
                    threshold: Number(item.threshold),
                    prize: String(item.prize || "").trim(),
                  }))
                  .filter((item) => Number.isFinite(item.threshold) && item.prize)
                  .sort((left, right) => left.threshold - right.threshold);

                return {
                  placePrizes,
                  tierPrizes,
                  tierRuleNote: String(model.tierRuleNote || "").trim(),
                };
              }

              function buildPrizeModelFromMatrix(matrix) {
                const rows = matrix.map((cells) => cells.map((cell) => String(cell ?? "").trim()));
                if (!rows.length || !rows[0].length) {
                  return normalizePrizeModel({ placePrizes: [], tierPrizes: [], tierRuleNote: "" });
                }

                const placePrizes = [];
                const firstRow = rows[0];
                if (firstRow[0] && firstRow[1]) {
                  placePrizes.push({ place: 1, label: firstRow[0], prize: firstRow[1] });
                }

                let tierRuleNote = "";
                let inTiers = false;

                rows.slice(1).forEach((cells) => {
                  const left = cells[0] || "";
                  const right = cells[1] || "";

                  if (!inTiers && left.startsWith("מקום")) {
                    const digits = left.replace(/\\D+/g, "");
                    if (digits) {
                      placePrizes.push({ place: Number(digits), label: left, prize: right });
                    }
                    return;
                  }

                  if (left === "מדרגות פרס") {
                    inTiers = true;
                    return;
                  }

                  if (inTiers) {
                    const threshold = coerceNumber(left);
                    if (threshold !== null && right) {
                      placePrizes.sort((a, b) => a.place - b.place);
                    } else if (left.includes("לא ניתן לקבל יותר מפרס אחד")) {
                      tierRuleNote = left;
                    }
                  }
                });

                const tierPrizes = [];
                inTiers = false;
                rows.slice(1).forEach((cells) => {
                  const left = cells[0] || "";
                  const right = cells[1] || "";
                  if (left === "מדרגות פרס") {
                    inTiers = true;
                    return;
                  }
                  if (!inTiers) {
                    return;
                  }
                  const threshold = coerceNumber(left);
                  if (threshold !== null && right) {
                    tierPrizes.push({ threshold, prize: right });
                  }
                });

                return normalizePrizeModel({ placePrizes, tierPrizes, tierRuleNote });
              }

              function resetFilterOptions() {
                const allRows = [...state.rows, ...state.compare.rows];
                const filterMeta = getFilterMeta();
                const ambassadors = [...new Set(allRows.map((row) => row.ambassador))].sort((left, right) =>
                  left.localeCompare(right, "he")
                );
                const hourOptions = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${formatHourLabel(hour)}</option>`);
                const dayOptions = [
                  { value: "all", label: "כל הימים" },
                  ...filterMeta.projectDates.map((date, index) => ({
                    value: String(index + 1),
                    label: `יום ${index + 1} · ${formatShortDate(date)}`,
                  })),
                ];

                if (filterMeta.uniqueDates.length > filterMeta.projectDates.length) {
                  dayOptions.push({ value: "overflow", label: "מחוץ לעשרת הימים" });
                }

                elements.ambassador.innerHTML = [
                  `<option value="all">כל השגרירים</option>`,
                  ...ambassadors.map((value) => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`),
                ].join("");

                elements.projectDay.innerHTML = dayOptions
                  .map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`)
                  .join("");

                elements.dateExact.innerHTML = [
                  `<option value="all">כל התאריכים</option>`,
                  ...filterMeta.uniqueDates.map((date) => `<option value="${date}">${escapeHtml(formatDate(date))}</option>`),
                ].join("");

                elements.hour.innerHTML = [
                  `<option value="all">כל השעות</option>`,
                  ...hourOptions,
                ].join("");

                elements.hourFrom.innerHTML = [
                  `<option value="all">משעה כלשהי</option>`,
                  ...hourOptions,
                ].join("");

                elements.hourTo.innerHTML = [
                  `<option value="all">עד שעה כלשהי</option>`,
                  ...hourOptions,
                ].join("");

                elements.dateFrom.min = filterMeta.minDate;
                elements.dateFrom.max = filterMeta.maxDate;
                elements.dateTo.min = filterMeta.minDate;
                elements.dateTo.max = filterMeta.maxDate;
                elements.dateExact.value = state.filters.dateExact;
                elements.dateFrom.value = state.filters.dateFrom;
                elements.dateTo.value = state.filters.dateTo;
                elements.ambassador.value = state.filters.ambassador;
                elements.projectDay.value = state.filters.projectDay;
                elements.hour.value = state.filters.hour;
                elements.hourFrom.value = state.filters.hourFrom;
                elements.hourTo.value = state.filters.hourTo;
                elements.donor.value = state.filters.donor;
                elements.amountMin.value = state.filters.amountMin;
                elements.amountMax.value = state.filters.amountMax;
                elements.dailyMetric.value = state.view.dailyMetric;
                elements.heatmapMetric.value = state.view.heatmapMetric;
                elements.movementMetric.value = state.view.movementMetric;
              }

              function syncFiltersFromInputs() {
                state.filters.ambassador = elements.ambassador.value;
                state.filters.projectDay = elements.projectDay.value;
                state.filters.dateExact = elements.dateExact.value;
                state.filters.hour = elements.hour.value;
                state.filters.hourFrom = elements.hourFrom.value;
                state.filters.hourTo = elements.hourTo.value;
                state.filters.dateFrom = elements.dateFrom.value;
                state.filters.dateTo = elements.dateTo.value;
                state.filters.donor = elements.donor.value;
                state.filters.amountMin = elements.amountMin.value;
                state.filters.amountMax = elements.amountMax.value;
              }

              function filterRows(rows, options = {}) {
                const { includeAmbassador = true } = options;
                const { ambassador, projectDay, dateExact, hour, hourFrom, hourTo, dateFrom, dateTo, donor, amountMin, amountMax } = state.filters;
                const donorQuery = normalizeSearchToken(donor);
                const minimumAmount = amountMin === "" ? null : Number(amountMin);
                const maximumAmount = amountMax === "" ? null : Number(amountMax);
                return rows.filter((row) => {
                  if (includeAmbassador && ambassador !== "all" && row.ambassador !== ambassador) {
                    return false;
                  }
                  if (projectDay !== "all") {
                    if (projectDay === "overflow" && row.projectDay !== null) {
                      return false;
                    }
                    if (projectDay !== "overflow" && String(row.projectDay) !== projectDay) {
                      return false;
                    }
                  }
                  if (dateExact !== "all" && row.date !== dateExact) {
                    return false;
                  }
                  if (hour !== "all" && row.hour !== Number(hour)) {
                    return false;
                  }
                  if (hourFrom !== "all" && row.hour < Number(hourFrom)) {
                    return false;
                  }
                  if (hourTo !== "all" && row.hour > Number(hourTo)) {
                    return false;
                  }
                  if (dateFrom && row.date < dateFrom) {
                    return false;
                  }
                  if (dateTo && row.date > dateTo) {
                    return false;
                  }
                  if (minimumAmount !== null && row.amount < minimumAmount) {
                    return false;
                  }
                  if (maximumAmount !== null && row.amount > maximumAmount) {
                    return false;
                  }
                  if (donorQuery && !normalizeSearchToken(row.donor).includes(donorQuery)) {
                    return false;
                  }
                  return true;
                });
              }

              function getFilteredRows() {
                return filterRows(state.rows);
              }

              function getComparisonRows() {
                return filterRows(state.compare.rows);
              }

              function getPrizeScopeRows() {
                return filterRows(state.rows, { includeAmbassador: false });
              }

              function sumAmount(rows) {
                return rows.reduce((sum, row) => sum + row.amount, 0);
              }

              function groupBy(rows, getKey) {
                const map = new Map();
                rows.forEach((row) => {
                  const key = getKey(row);
                  const items = map.get(key) || [];
                  items.push(row);
                  map.set(key, items);
                });
                return map;
              }

              function buildLeaderboard(rows) {
                const grouped = new Map();
                rows.forEach((row) => {
                  if (!row.ambassador || row.ambassador === "ללא שיוך") {
                    return;
                  }
                  const current = grouped.get(row.ambassador) || { ambassador: row.ambassador, total: 0, deals: 0 };
                  current.total += row.amount;
                  current.deals += 1;
                  grouped.set(row.ambassador, current);
                });
                return [...grouped.values()].sort((left, right) => right.total - left.total);
              }

              function formatSignedNumber(value) {
                if (!Number.isFinite(value)) {
                  return "0";
                }
                const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
                return `${prefix}${numberFormatter.format(Math.abs(Math.round(value)))}`;
              }

              function formatSignedCurrency(value) {
                if (!Number.isFinite(value)) {
                  return formatAmount(0);
                }
                const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
                return `${prefix}${formatAmount(Math.abs(value))}`;
              }

              function formatPercent(value) {
                return `${(value * 100).toFixed(1)}%`;
              }

              function formatSignedPercentPoints(value) {
                const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
                return `${prefix}${Math.abs(value * 100).toFixed(1)} נק'`;
              }

              function buildDatasetSummary(rows, label) {
                const total = sumAmount(rows);
                const deals = rows.length;
                const successCount = rows.filter((row) => row.status === "success").length;
                const successRate = deals ? successCount / deals : 0;
                const ambassadorSet = new Set(rows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך"));
                const leaderboard = buildLeaderboard(rows);
                const topAmbassador = leaderboard[0] || null;
                const topAmbassadorShare = topAmbassador && total ? topAmbassador.total / total : 0;
                const topDay =
                  [...groupBy(rows, (row) => row.date).entries()]
                    .map(([date, items]) => ({ date, total: sumAmount(items), count: items.length }))
                    .sort((left, right) => right.total - left.total)[0] || null;
                const peakHour =
                  [...groupBy(rows, (row) => row.hour).entries()]
                    .map(([hour, items]) => ({ hour, total: sumAmount(items), count: items.length }))
                    .sort((left, right) => right.total - left.total)[0] || null;

                return {
                  label,
                  total,
                  deals,
                  average: deals ? total / deals : 0,
                  successRate,
                  ambassadorCount: ambassadorSet.size,
                  ambassadorSet,
                  topAmbassador,
                  topAmbassadorShare,
                  topDay,
                  peakHour,
                };
              }

              function buildComparisonModel(baseRows, compareRows) {
                const base = buildDatasetSummary(baseRows, state.sourceLabel || "קובץ בסיס");
                const compare = buildDatasetSummary(compareRows, state.compare.label || "קובץ השוואה");
                const overlap = [...base.ambassadorSet].filter((ambassador) => compare.ambassadorSet.has(ambassador));
                const totalDelta = compare.total - base.total;
                const dealsDelta = compare.deals - base.deals;
                const averageDelta = compare.average - base.average;
                const successDelta = compare.successRate - base.successRate;
                const ambassadorDelta = compare.ambassadorCount - base.ambassadorCount;
                const strongerLabel = totalDelta >= 0 ? compare.label : base.label;
                const weakerLabel = totalDelta >= 0 ? base.label : compare.label;

                const facts = [
                  `${strongerLabel} מוביל בסך הגיוס בפער של ${formatSignedCurrency(totalDelta)} לעומת ${weakerLabel}.`,
                  `${compare.label} מציג ${formatSignedNumber(dealsDelta)} עסקאות ביחס ל-${base.label}, וממוצע לעסקה של ${formatAmount(compare.average)} מול ${formatAmount(base.average)}.`,
                  `יש ${formatNumber(overlap.length)} שגרירים משותפים בין שני הקבצים, מתוך ${formatNumber(base.ambassadorCount)} ו-${formatNumber(compare.ambassadorCount)} שגרירים פעילים.`,
                ];

                const critical = [];
                if (base.total > 0 && compare.total < base.total * 0.85) {
                  critical.push(`${compare.label} נמוך ביותר מ-15% בסך הגיוס מול ${base.label}. כדאי לבדוק אם חסרות רשומות, שעות פעילות או שגרירים פעילים.`);
                }
                if (compare.successRate + 0.03 < base.successRate) {
                  critical.push(`שיעור ההצלחה של ${compare.label} נמוך ב-${formatSignedPercentPoints(successDelta)} לעומת ${base.label}. זה פער שמצדיק בדיקת כשלי גבייה.`);
                }
                if (compare.ambassadorCount + 2 < base.ambassadorCount) {
                  critical.push(`${compare.label} מפעיל פחות שגרירים פעילים ב-${formatSignedNumber(ambassadorDelta)} לעומת ${base.label}. זה יכול להסביר האטה בקצב הגיוס.`);
                }
                if (!critical.length) {
                  critical.push(`לא זוהתה חריגה אחת חדה, אבל עדיין יש פער של ${formatSignedCurrency(totalDelta)} בסך הגיוס ו-${formatSignedNumber(dealsDelta)} עסקאות בין שני הקבצים.`);
                }

                const insights = [];
                if (base.topAmbassador && compare.topAmbassador) {
                  insights.push(`השגריר המוביל ב-${base.label} הוא ${base.topAmbassador.ambassador} עם ${formatAmount(base.topAmbassador.total)}, בעוד שב-${compare.label} מוביל/ה ${compare.topAmbassador.ambassador} עם ${formatAmount(compare.topAmbassador.total)}.`);
                }
                if (base.topDay && compare.topDay) {
                  insights.push(`יום השיא ב-${base.label} הוא ${formatDate(base.topDay.date)}, וב-${compare.label} יום השיא הוא ${formatDate(compare.topDay.date)}. זה עוזר לזהות אם המומנטום זז ליום אחר.`);
                }
                if (base.peakHour && compare.peakHour) {
                  insights.push(`שעת השיא השתנתה מ-${String(base.peakHour.hour).padStart(2, "0")}:00 ב-${base.label} ל-${String(compare.peakHour.hour).padStart(2, "0")}:00 ב-${compare.label}.`);
                }
                const concentrationDelta = compare.topAmbassadorShare - base.topAmbassadorShare;
                if (Math.abs(concentrationDelta) >= 0.08) {
                  insights.push(`${compare.label} ${concentrationDelta > 0 ? "תלוי יותר" : "מפוזר יותר"} בשגריר מוביל, עם שינוי של ${formatSignedPercentPoints(concentrationDelta)} בחלקו של המוביל מתוך כלל הגיוס.`);
                }
                if (!insights.length) {
                  insights.push(`שני הקבצים דומים יחסית במבנה הפעילות שלהם, ולכן עיקר הקריאה צריך להתמקד בפערי הסכום, העסקאות ושיעור ההצלחה.`);
                }

                return {
                  base,
                  compare,
                  overlapCount: overlap.length,
                  totalDelta,
                  dealsDelta,
                  averageDelta,
                  successDelta,
                  ambassadorDelta,
                  facts,
                  critical,
                  insights,
                };
              }

              function computePrizeStandings(referenceRows) {
                const prizeModel = normalizePrizeModel(state.prizeModel);
                const leaderboard = buildLeaderboard(referenceRows);
                const placeWinners = prizeModel.placePrizes.map((item) => ({
                  ...item,
                  winner: leaderboard[item.place - 1] || null,
                }));

                const tiers = prizeModel.tierPrizes.map((tier) => ({ ...tier, active: [], carryover: [] }));
                const firstTierThreshold = tiers[0] ? tiers[0].threshold : null;

                leaderboard.forEach((entry) => {
                  let highestTierIndex = -1;
                  tiers.forEach((tier, index) => {
                    if (entry.total >= tier.threshold) {
                      highestTierIndex = index;
                    }
                  });
                  if (highestTierIndex >= 0) {
                    tiers[highestTierIndex].active.push(entry);
                    if (highestTierIndex > 0 && firstTierThreshold !== null && entry.total >= firstTierThreshold) {
                      tiers[0].carryover.push(entry);
                    }
                  }
                });

                tiers.forEach((tier) => {
                  tier.active.sort((left, right) => right.total - left.total);
                  tier.carryover.sort((left, right) => right.total - left.total);
                });

                const selectedAmbassador =
                  state.filters.ambassador !== "all"
                    ? leaderboard.find((entry) => entry.ambassador === state.filters.ambassador) || null
                    : null;

                let selectedFocus = null;
                if (selectedAmbassador) {
                  const currentTier = [...tiers].reverse().find((tier) => selectedAmbassador.total >= tier.threshold) || null;
                  const nextTier = tiers.find((tier) => tier.threshold > selectedAmbassador.total) || null;
                  selectedFocus = {
                    ambassador: selectedAmbassador.ambassador,
                    total: selectedAmbassador.total,
                    currentPrize: currentTier ? currentTier.prize : "עדיין ללא פרס",
                    nextPrize: nextTier ? nextTier.prize : "",
                    gap: nextTier ? nextTier.threshold - selectedAmbassador.total : 0,
                  };
                }

                return {
                  prizeModel,
                  leaderboard,
                  placeWinners,
                  tiers,
                  selectedFocus,
                };
              }

              function getActiveFilterSummary() {
                const summary = [];
                if (state.filters.ambassador !== "all") {
                  summary.push(`שגריר: ${state.filters.ambassador}`);
                }
                if (state.filters.projectDay !== "all") {
                  summary.push(
                    state.filters.projectDay === "overflow"
                      ? "יום פרויקט: מחוץ לעשרת הימים"
                      : `יום פרויקט: ${state.filters.projectDay}`
                  );
                }
                if (state.filters.dateExact !== "all") {
                  summary.push(`תאריך: ${formatDate(state.filters.dateExact)}`);
                }
                if (state.filters.dateFrom || state.filters.dateTo) {
                  summary.push(`טווח תאריכים: ${state.filters.dateFrom || "התחלה פתוחה"} עד ${state.filters.dateTo || "סיום פתוח"}`);
                }
                if (state.filters.hour !== "all") {
                  summary.push(`שעה: ${formatHourLabel(state.filters.hour)}`);
                }
                if (state.filters.hourFrom !== "all" || state.filters.hourTo !== "all") {
                  summary.push(`טווח שעות: ${state.filters.hourFrom !== "all" ? formatHourLabel(state.filters.hourFrom) : "ללא התחלה"} עד ${state.filters.hourTo !== "all" ? formatHourLabel(state.filters.hourTo) : "ללא סוף"}`);
                }
                if (state.filters.amountMin !== "" || state.filters.amountMax !== "") {
                  summary.push(`סכום: ${state.filters.amountMin || "0"} עד ${state.filters.amountMax || "ללא תקרה"} ₪`);
                }
                if (state.filters.donor.trim()) {
                  summary.push(`תורם: ${state.filters.donor.trim()}`);
                }
                return summary.length ? ` | פילוחים פעילים: ${summary.join(" • ")}` : "";
              }

              function setControlNote(filteredRows, prizeRows) {
                const compareText = state.compare.rows.length ? ` | השוואה: ${state.compare.label} (${formatNumber(state.compare.rows.length)} רשומות)` : "";
                elements.controlNote.textContent = `בסיס: ${state.sourceLabel} | חלון ברירת מחדל: ${state.meta.projectWindowLabel || "לא זוהה"} | מוצגות ${formatNumber(filteredRows.length)} עסקאות במסנן | פרסים מחושבים על ${formatNumber(prizeRows.length)} עסקאות בטווח הזמן הנבחר${compareText}${getActiveFilterSummary()}`;
              }

              function renderPublicHeroBadges(prizeRows) {
                const leaderboard = buildLeaderboard(prizeRows);
                const topLeader = leaderboard[0];
                const publicBadges = [
                  `<span class="hero-badge">חלון פרויקט: ${escapeHtml(state.meta.projectWindowLabel || "לא זוהה")}</span>`,
                  `<span class="hero-badge">${escapeHtml(formatNumber(leaderboard.length))} שגרירים מדורגים כרגע</span>`,
                  `<span class="hero-badge">בסיס פרסים: ${escapeHtml(formatAmount(sumAmount(prizeRows)))}</span>`,
                ];
                if (topLeader) {
                  publicBadges.push(`<span class="hero-badge">מוביל/ה כרגע: ${escapeHtml(topLeader.ambassador)} · ${escapeHtml(formatAmount(topLeader.total))}</span>`);
                }
                elements.publicHeroBadges.innerHTML = publicBadges.join("");
              }

              function renderHeroBadges(filteredRows, prizeRows, compareRows) {
                const filteredTotal = sumAmount(filteredRows);
                const prizeTotal = sumAmount(prizeRows);
                const ambassadorCount = new Set(prizeRows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך")).size;

                elements.logo.src = INITIAL_LOGO;
                elements.topbarLogo.src = INITIAL_LOGO;
                const badges = [
                  `<span class="hero-badge">₪ ${escapeHtml(formatNumber(Math.round(filteredTotal)).replace("₪", "").trim())} בגזרת התצוגה</span>`,
                  `<span class="hero-badge">${escapeHtml(formatNumber(ambassadorCount))} שגרירים פעילים בטווח</span>`,
                  `<span class="hero-badge">${escapeHtml(state.meta.projectWindowLabel || "טווח לא זוהה")}</span>`,
                  `<span class="hero-badge">בסיס פרסים: ${escapeHtml(formatAmount(prizeTotal))}</span>`,
                ];
                if (state.compare.rows.length) {
                  badges.push(`<span class="hero-badge">השוואה: ${escapeHtml(state.compare.label)} · ${escapeHtml(formatAmount(sumAmount(compareRows)))}</span>`);
                }
                elements.heroBadges.innerHTML = badges.join("");
              }

              function renderMetrics(rows) {
                const total = sumAmount(rows);
                const ambassadors = new Set(rows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך"));
                const average = rows.length ? total / rows.length : 0;
                const peakHourEntry = Array.from(groupBy(rows, (row) => row.hour).entries())
                  .map(([hour, items]) => [hour, sumAmount(items)])
                  .sort((left, right) => right[1] - left[1])[0];
                const peakHourLabel = peakHourEntry ? `${String(peakHourEntry[0]).padStart(2, "0")}:00` : "אין";

                const stats = [
                  { label: "סך גיוס", value: formatAmount(total), detail: `${formatNumber(rows.length)} עסקאות` },
                  { label: "ממוצע לעסקה", value: formatAmount(average), detail: "לפי הפילוח הנוכחי" },
                  { label: "שגרירים פעילים", value: formatNumber(ambassadors.size), detail: "עם לפחות עסקה אחת" },
                  { label: "שעת שיא", value: peakHourLabel, detail: peakHourEntry ? formatAmount(peakHourEntry[1]) : "אין נתונים" },
                ];

                elements.metrics.innerHTML = stats
                  .map(
                    (stat) => `
                      <article class="metric-card">
                        <div class="metric-label">${escapeHtml(stat.label)}</div>
                        <div class="metric-value">${escapeHtml(stat.value)}</div>
                        <div class="text-small text-muted">${escapeHtml(stat.detail)}</div>
                      </article>
                    `
                  )
                  .join("");
              }

              function renderGoalsBoard(rows) {
                const totalGoal = Number(state.goals.total || 0);
                const dailyGoal = Number(state.goals.daily || 0);
                const totalRaised = sumAmount(rows);
                const uniqueDates = [...new Set(rows.map((row) => row.date))];
                const activeDays = uniqueDates.length;
                const currentDailyAverage = activeDays ? totalRaised / activeDays : 0;
                const totalProgress = totalGoal > 0 ? totalRaised / totalGoal : 0;
                const dailyProgress = dailyGoal > 0 ? currentDailyAverage / dailyGoal : 0;
                const remainingToTotal = Math.max(0, totalGoal - totalRaised);
                const remainingToDaily = Math.max(0, dailyGoal - currentDailyAverage);

                elements.goalTotal.value = totalGoal || "";
                elements.goalDaily.value = dailyGoal || "";
                elements.goalsSummary.textContent =
                  totalGoal || dailyGoal
                    ? `יעד כולל: ${formatAmount(totalGoal)} | יעד יומי: ${formatAmount(dailyGoal)}`
                    : "עדיין לא הוגדרו יעדים. אפשר להזין יעד כולל ויעד יומי בלוח הבקרה.";

                elements.goalsBoard.innerHTML = `
                  <div class="signal-grid">
                    <section class="analysis-card">
                      <h4>יעד כולל</h4>
                      <ul>
                        <li>ביצוע בפועל: ${escapeHtml(formatAmount(totalRaised))}</li>
                        <li>התקדמות מול יעד: ${escapeHtml(totalGoal ? formatPercent(totalProgress) : "לא הוגדר יעד")}</li>
                        <li>יתרה להשגה: ${escapeHtml(totalGoal ? formatAmount(remainingToTotal) : "לא הוגדר יעד")}</li>
                      </ul>
                    </section>
                    <section class="analysis-card">
                      <h4>יעד יומי</h4>
                      <ul>
                        <li>ממוצע יומי במסנן: ${escapeHtml(formatAmount(currentDailyAverage))}</li>
                        <li>התקדמות מול יעד יומי: ${escapeHtml(dailyGoal ? formatPercent(dailyProgress) : "לא הוגדר יעד")}</li>
                        <li>פער יומי נוכחי: ${escapeHtml(dailyGoal ? formatAmount(remainingToDaily) : "לא הוגדר יעד")}</li>
                      </ul>
                    </section>
                    <section class="analysis-card">
                      <h4>קריאה ניהולית</h4>
                      <ul>
                        <li>${escapeHtml(activeDays ? `המסנן מכסה ${formatNumber(activeDays)} ימי פעילות.` : "אין ימי פעילות בטווח הנבחר.")}</li>
                        <li>${escapeHtml(totalGoal ? (totalRaised >= totalGoal ? "היעד הכולל הושג או נעקף." : `נדרש עוד ${formatAmount(remainingToTotal)} כדי להגיע ליעד הכולל.`) : "כדאי להגדיר יעד כולל כדי למדוד פער לביצוע.")}</li>
                        <li>${escapeHtml(dailyGoal ? (currentDailyAverage >= dailyGoal ? "הקצב היומי נמצא מעל היעד." : `הקצב היומי נמוך ב-${formatAmount(remainingToDaily)} מהיעד.`) : "כדאי להגדיר יעד יומי כדי להבין אם הקצב בריא.")}</li>
                      </ul>
                    </section>
                  </div>
                `;
              }

              function renderValidationBoard() {
                const items = [state.validation.base, state.validation.compare].filter(Boolean);
                if (!items.length) {
                  elements.validationSummary.textContent = "";
                  elements.validationBoard.innerHTML = `<div class="empty-state">העלה קובץ כדי לקבל דוח ולידציה, שגיאות ואזהרות.</div>`;
                  return;
                }

                const totalErrors = items.reduce((sum, item) => sum + item.errors.length, 0);
                const totalWarnings = items.reduce((sum, item) => sum + item.warnings.length, 0);
                elements.validationSummary.textContent = `${formatNumber(totalErrors)} שגיאות | ${formatNumber(totalWarnings)} אזהרות | ${items.length} קובצי קלט מנותחים`;

                elements.validationBoard.innerHTML = `
                  <div class="signal-grid">
                    ${items
                      .map(
                        (item) => `
                          <section class="analysis-card quality">
                            <h4>${escapeHtml(item.label)}</h4>
                            <ul>
                              <li>שורות מקור: ${escapeHtml(formatNumber(item.totalRows))} | שורות תקינות לטעינה: ${escapeHtml(formatNumber(item.validRows.length))}</li>
                              <li>שגיאות: ${escapeHtml(item.errors.length ? item.errors.join(" | ") : "לא זוהו שגיאות חסימה")}</li>
                              <li>אזהרות: ${escapeHtml(item.warnings.length ? item.warnings.join(" | ") : "לא זוהו אזהרות")}</li>
                            </ul>
                          </section>
                        `
                      )
                      .join("")}
                  </div>
                `;
              }

              function buildExecutiveModel(rows) {
                const summary = buildDatasetSummary(rows, "current");
                const failedCount = rows.filter((row) => row.status === "failed").length;
                const lastDate = [...new Set(rows.map((row) => row.date))].sort().slice(-1)[0] || "";
                return {
                  ...summary,
                  failedCount,
                  lastDate,
                };
              }

              function renderExecutiveBoard(rows) {
                if (!rows.length) {
                  elements.executiveSummary.textContent = "";
                  elements.executiveBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור הסיכום הניהולי.</div>`;
                  return;
                }

                const model = buildExecutiveModel(rows);
                elements.executiveSummary.textContent = `${formatDate(model.lastDate)} הוא היום המאוחר ביותר במסנן | ${formatNumber(model.ambassadorCount)} שגרירים פעילים`;

                const cards = [
                  {
                    title: "תמונת מצב",
                    items: [
                      `סך הגיוס כרגע הוא ${formatAmount(model.total)} מתוך ${formatNumber(model.deals)} עסקאות.`,
                      `הממוצע לעסקה עומד על ${formatAmount(model.average)}.`,
                      `שיעור ההצלחה הכולל הוא ${formatPercent(model.successRate)}.`,
                    ],
                  },
                  {
                    title: "מנועי צמיחה",
                    items: [
                      model.topAmbassador
                        ? `השגריר המוביל הוא ${model.topAmbassador.ambassador} עם ${formatAmount(model.topAmbassador.total)}.`
                        : "עדיין אין שגריר מוביל מזוהה.",
                      model.topDay ? `יום השיא הוא ${formatDate(model.topDay.date)} עם ${formatAmount(model.topDay.total)}.` : "עדיין אין יום שיא מזוהה.",
                      model.peakHour ? `שעת השיא היא ${String(model.peakHour.hour).padStart(2, "0")}:00 עם ${formatAmount(model.peakHour.total)}.` : "עדיין אין שעת שיא מזוהה.",
                    ],
                  },
                  {
                    title: "ריכוזיות ובקרה",
                    items: [
                      model.topAmbassador ? `חלקו של המוביל מתוך כלל הגיוס הוא ${formatPercent(model.topAmbassadorShare)}.` : "אין ריכוזיות מדידה כרגע.",
                      `יש כרגע ${formatNumber(model.failedCount)} עסקאות שנכשלו בתוך המסנן.`,
                      `נפרסו ${formatNumber(model.ambassadorCount)} שגרירים פעילים בטווח הזמן הנבחר.`,
                    ],
                  },
                ];

                elements.executiveBoard.innerHTML = `
                  <div class="signal-grid">
                    ${cards
                      .map(
                        (card) => `
                          <section class="analysis-card">
                            <h4>${escapeHtml(card.title)}</h4>
                            <ul>
                              ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                            </ul>
                          </section>
                        `
                      )
                      .join("")}
                  </div>
                `;
              }

              function buildDataQualityModel(rows) {
                const failedRows = rows.filter((row) => row.status === "failed");
                const missingAmbassador = rows.filter((row) => row.ambassador === "ללא שיוך");
                const zeroAmount = rows.filter((row) => row.amount <= 0);
                const outOfWindow = rows.filter((row) => row.projectDay === null);
                const duplicateMap = new Map();
                rows.forEach((row) => {
                  const donorKey = `${row.date}|${(row.email || row.donor || "").toLowerCase()}|${row.amount}`;
                  if (!donorKey.includes("||0")) {
                    duplicateMap.set(donorKey, (duplicateMap.get(donorKey) || 0) + 1);
                  }
                });
                const duplicateCandidates = [...duplicateMap.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
                const amounts = rows.map((row) => row.amount).filter((amount) => amount > 0).sort((left, right) => left - right);
                const percentileIndex = amounts.length ? Math.max(0, Math.floor(amounts.length * 0.95) - 1) : 0;
                const p95 = amounts[percentileIndex] || 0;
                const highOutliers = rows.filter((row) => row.amount >= Math.max(2500, p95));
                const failureReasons = [...groupBy(failedRows, (row) => row.chargeResult || "לא סופק קוד").entries()]
                  .map(([reason, items]) => ({ reason, count: items.length }))
                  .sort((left, right) => right.count - left.count)
                  .slice(0, 4);

                return {
                  failedRows,
                  missingAmbassador,
                  zeroAmount,
                  outOfWindow,
                  duplicateCandidates,
                  highOutliers,
                  p95,
                  failureReasons,
                };
              }

              function renderQualityBoard(rows) {
                if (!rows.length) {
                  elements.qualitySummary.textContent = "";
                  elements.qualityBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור איכות הנתונים.</div>`;
                  return;
                }

                const model = buildDataQualityModel(rows);
                elements.qualitySummary.textContent = `כשלים: ${formatNumber(model.failedRows.length)} | שיוך חסר: ${formatNumber(model.missingAmbassador.length)} | כפילויות חשודות: ${formatNumber(model.duplicateCandidates)}`;

                const cards = [
                  {
                    title: "שיוך ושלמות",
                    items: [
                      `ל-${formatNumber(model.missingAmbassador.length)} רשומות אין שיוך שגריר/ה.`,
                      `${formatNumber(model.outOfWindow.length)} רשומות נמצאות מחוץ לחלון עשרת ימי הפרויקט.`,
                      `${formatNumber(model.zeroAmount.length)} רשומות עם סכום אפס או חסר.`,
                    ],
                  },
                  {
                    title: "גבייה וכשלים",
                    items: model.failureReasons.length
                      ? model.failureReasons.map((item) => `${item.reason}: ${formatNumber(item.count)} עסקאות כושלות.`)
                      : [`אין כרגע קודי כשל בולטים בתוך המסנן.`],
                  },
                  {
                    title: "חריגים וכפילויות",
                    items: [
                      `${formatNumber(model.duplicateCandidates)} רשומות נראות כמו כפילויות אפשריות לפי תאריך, מזהה תורם וסכום.`,
                      `${formatNumber(model.highOutliers.length)} עסקאות נמצאות מעל סף חריגות של ${formatAmount(Math.max(2500, model.p95))}.`,
                      model.highOutliers[0] ? `העסקה החריגה הגבוהה ביותר כרגע היא ${formatAmount(Math.max(...model.highOutliers.map((row) => row.amount)))}.` : `אין כרגע עסקאות חריגות.`,
                    ],
                  },
                ];

                elements.qualityBoard.innerHTML = `
                  <div class="signal-grid">
                    ${cards
                      .map(
                        (card) => `
                          <section class="analysis-card quality">
                            <h4>${escapeHtml(card.title)}</h4>
                            <ul>
                              ${card.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                            </ul>
                          </section>
                        `
                      )
                      .join("")}
                  </div>
                `;
              }

              function buildSegmentModel(rows) {
                const bucketDefinitions = [
                  { label: "עד ₪99", min: 0, max: 99.999 },
                  { label: "₪100-249", min: 100, max: 249.999 },
                  { label: "₪250-499", min: 250, max: 499.999 },
                  { label: "₪500-999", min: 500, max: 999.999 },
                  { label: "₪1000+", min: 1000, max: Infinity },
                ];
                const buckets = bucketDefinitions.map((bucket) => {
                  const items = rows.filter((row) => row.amount >= bucket.min && row.amount <= bucket.max);
                  return {
                    ...bucket,
                    count: items.length,
                    total: sumAmount(items),
                  };
                });
                const maxBucketCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
                const topDonors = [...groupBy(rows, (row) => row.donor).entries()]
                  .map(([donor, items]) => ({ donor, total: sumAmount(items), count: items.length }))
                  .filter((item) => item.donor && item.donor !== "ללא שם")
                  .sort((left, right) => right.total - left.total)
                  .slice(0, 5);
                const statusCounts = [...groupBy(rows, (row) => row.status).entries()]
                  .map(([status, items]) => ({ status, count: items.length, total: sumAmount(items) }))
                  .sort((left, right) => right.count - left.count);
                return {
                  buckets,
                  maxBucketCount,
                  topDonors,
                  statusCounts,
                };
              }

              function renderSegmentBoard(rows) {
                if (!rows.length) {
                  elements.segmentSummary.textContent = "";
                  elements.segmentBoard.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור פילוח העסקאות.</div>`;
                  return;
                }

                const model = buildSegmentModel(rows);
                const largeBucket = model.buckets[model.buckets.length - 1];
                elements.segmentSummary.textContent = `עסקאות של ₪1000+ מהוות ${formatNumber(largeBucket.count)} עסקאות ו-${formatAmount(largeBucket.total)} מהמחזור המסונן`;

                elements.segmentBoard.innerHTML = `
                  <div class="segment-grid">
                    <section class="analysis-card">
                      <h4>התפלגות סכומי תרומה</h4>
                      <div class="bucket-row">
                        ${model.buckets
                          .map(
                            (bucket) => `
                              <div class="bucket-item">
                                <div class="bucket-head">
                                  <span>${escapeHtml(bucket.label)}</span>
                                  <span class="text-small text-muted">${escapeHtml(formatNumber(bucket.count))} עסקאות · ${escapeHtml(formatAmount(bucket.total))}</span>
                                </div>
                                <div class="bucket-bar"><div class="bucket-fill" style="width:${(bucket.count / model.maxBucketCount) * 100}%"></div></div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </section>
                    <section class="analysis-card">
                      <h4>תורמים מובילים</h4>
                      <ul>
                        ${model.topDonors.length
                          ? model.topDonors.map((item) => `<li>${escapeHtml(item.donor)} · ${escapeHtml(formatAmount(item.total))} · ${escapeHtml(formatNumber(item.count))} עסקאות</li>`).join("")
                          : `<li>אין מספיק נתונים לזיהוי תורמים מובילים.</li>`}
                      </ul>
                    </section>
                    <section class="analysis-card">
                      <h4>פיצול לפי סטטוס</h4>
                      <ul>
                        ${model.statusCounts
                          .map((item) => `<li>${escapeHtml(item.status === "success" ? "חויב" : "נכשל")} · ${escapeHtml(formatNumber(item.count))} עסקאות · ${escapeHtml(formatAmount(item.total))}</li>`)
                          .join("")}
                      </ul>
                    </section>
                  </div>
                `;
              }

              function renderComparisonBoard(baseRows, compareRows) {
                if (!state.compare.rows.length) {
                  elements.comparisonSummary.textContent = "";
                  elements.comparisonBoard.innerHTML = `<div class="empty-state">העלה קובץ השוואה שני כדי לקבל תקציר, עובדות, נקודות קריטיות ותובנות בין שני הקבצים.</div>`;
                  return;
                }

                if (!baseRows.length && !compareRows.length) {
                  elements.comparisonSummary.textContent = "";
                  elements.comparisonBoard.innerHTML = `<div class="empty-state">שני הקבצים ריקים בטווח שנבחר.</div>`;
                  return;
                }

                const comparison = buildComparisonModel(baseRows, compareRows);
                elements.comparisonSummary.textContent = `${comparison.base.label} מול ${comparison.compare.label} | חפיפת שגרירים: ${formatNumber(comparison.overlapCount)}`;

                const deltaClass = (value) => (value > 0 ? "is-up" : value < 0 ? "is-down" : "");
                const metricCards = [
                  {
                    label: "סך גיוס",
                    base: formatAmount(comparison.base.total),
                    compare: formatAmount(comparison.compare.total),
                    delta: formatSignedCurrency(comparison.totalDelta),
                    className: deltaClass(comparison.totalDelta),
                  },
                  {
                    label: "מספר עסקאות",
                    base: formatNumber(comparison.base.deals),
                    compare: formatNumber(comparison.compare.deals),
                    delta: formatSignedNumber(comparison.dealsDelta),
                    className: deltaClass(comparison.dealsDelta),
                  },
                  {
                    label: "ממוצע לעסקה",
                    base: formatAmount(comparison.base.average),
                    compare: formatAmount(comparison.compare.average),
                    delta: formatSignedCurrency(comparison.averageDelta),
                    className: deltaClass(comparison.averageDelta),
                  },
                  {
                    label: "שיעור הצלחה",
                    base: formatPercent(comparison.base.successRate),
                    compare: formatPercent(comparison.compare.successRate),
                    delta: formatSignedPercentPoints(comparison.successDelta),
                    className: deltaClass(comparison.successDelta),
                  },
                ];

                elements.comparisonBoard.innerHTML = `
                  <div class="comparison-metric-grid">
                    ${metricCards
                      .map(
                        (card) => `
                          <article class="comparison-card">
                            <h4>${escapeHtml(card.label)}</h4>
                            <div class="comparison-main">
                              <div class="comparison-value">${escapeHtml(card.compare)}</div>
                              <span class="comparison-delta ${card.className}">${escapeHtml(card.delta)}</span>
                            </div>
                            <div class="text-small text-muted">${escapeHtml(comparison.compare.label)} מול ${escapeHtml(comparison.base.label)}</div>
                            <div class="text-small text-muted">בסיס: ${escapeHtml(card.base)}</div>
                          </article>
                        `
                      )
                      .join("")}
                  </div>
                  <div class="comparison-lists">
                    <section class="comparison-list">
                      <h4>תקציר ועובדות</h4>
                      <ul>
                        ${comparison.facts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                      </ul>
                    </section>
                    <section class="comparison-list critical">
                      <h4>נקודות קריטיות</h4>
                      <ul>
                        ${comparison.critical.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                      </ul>
                    </section>
                    <section class="comparison-list insights">
                      <h4>תובנות בין הקבצים</h4>
                      <ul>
                        ${comparison.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                      </ul>
                    </section>
                  </div>
                `;
              }

              function renderPrizeBoard(prizeRows) {
                const standings = computePrizeStandings(prizeRows);
                const { placeWinners, tiers, prizeModel, selectedFocus } = standings;

                elements.prizeSummary.textContent = selectedFocus
                  ? `${selectedFocus.ambassador}: ${formatAmount(selectedFocus.total)} | פרס פעיל: ${selectedFocus.currentPrize}${selectedFocus.nextPrize ? ` | חסרים ${formatAmount(selectedFocus.gap)} ל-${selectedFocus.nextPrize}` : " | נמצא במדרגה העליונה"}` : `${formatNumber(standings.leaderboard.length)} שגרירים מדורגים בטווח הזמן הנבחר`;

                const podiumMarkup = placeWinners.length
                  ? `
                      <div class="dashboard-section">
                        <div class="section-head">
                          <h3>פרסי מקומות</h3>
                          <div class="text-small text-muted">מקומות 1-3 מחושבים לפי סכום הגיוס המצטבר בטווח המסונן.</div>
                        </div>
                        <div class="podium-grid">
                          ${placeWinners
                            .map((item) => {
                              const winner = item.winner;
                              const isFocus = winner && state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                              return `
                                <article class="prize-card place-card">
                                  <div class="prize-visual">
                                    <div class="podium-mark">
                                      <svg viewBox="0 0 220 120" role="img" aria-label="${escapeAttribute(item.label)}">
                                        <rect x="24" y="64" width="48" height="34" rx="8" fill="rgba(255,217,61,0.95)"></rect>
                                        <rect x="86" y="38" width="48" height="60" rx="8" fill="rgba(255,255,255,0.96)"></rect>
                                        <rect x="148" y="54" width="48" height="44" rx="8" fill="rgba(255,217,61,0.72)"></rect>
                                        <text x="110" y="26" text-anchor="middle" fill="white" font-size="22" font-weight="700">${escapeHtml(String(item.place))}</text>
                                      </svg>
                                    </div>
                                  </div>
                                  <div class="prize-content">
                                    <div class="prize-title-row">
                                      <div class="prize-title">${escapeHtml(item.label)}</div>
                                      <span class="prize-pill">${escapeHtml(item.prize)}</span>
                                    </div>
                                    ${
                                      winner
                                        ? `
                                          <div class="winner-list">
                                            <div class="winner-item${isFocus ? " is-focus" : ""}">
                                              <span class="winner-rank">${escapeHtml(String(item.place))}</span>
                                              <div>
                                                <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                                <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                              </div>
                                              <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                                            </div>
                                          </div>
                                        `
                                        : `<div class="empty-state">עדיין אין זוכה למקום הזה בטווח שנבחר.</div>`
                                    }
                                  </div>
                                </article>
                              `;
                            })
                            .join("")}
                        </div>
                      </div>
                    `
                  : "";

                const tiersMarkup = tiers.length
                  ? `
                      <div class="dashboard-section">
                        <div class="section-head">
                          <h3>מדרגות פרס</h3>
                          <div class="text-small text-muted">${escapeHtml(prizeModel.tierRuleNote || "שדרוג מדרגה מחליף את הפרס הפעיל, ובמדרגה הראשונה נשמרת זכאות למרצ' העמותה.")}</div>
                        </div>
                        <div class="tier-grid">
                          ${tiers
                            .map((tier, index) => {
                              const winners = tier.active.slice(0, 5);
                              const carryoverNote =
                                index === 0 && tier.carryover.length
                                  ? `<div class="status-note text-small">נשארים זכאים גם אחרי שדרוג: ${escapeHtml(formatNumber(tier.carryover.length))} שגרירים</div>`
                                  : "";
                              return `
                                <article class="prize-card">
                                  <div class="prize-visual">
                                    <div class="tier-mark">
                                      <svg viewBox="0 0 240 132" role="img" aria-label="${escapeAttribute(tier.prize)}">
                                        <rect x="24" y="${82 - index * 6}" width="48" height="${30 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                                        <rect x="86" y="${56 - index * 6}" width="48" height="${56 + index * 6}" rx="10" fill="rgba(19,23,80,0.96)"></rect>
                                        <rect x="148" y="${34 - index * 6}" width="48" height="${78 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                                        <circle cx="120" cy="24" r="14" fill="rgba(255,217,61,0.96)"></circle>
                                      </svg>
                                    </div>
                                  </div>
                                  <div class="prize-content">
                                    <div class="prize-title-row">
                                      <div class="prize-title">${escapeHtml(formatAmount(tier.threshold))}</div>
                                      <span class="prize-pill">${escapeHtml(tier.prize)}</span>
                                    </div>
                                    <div class="text-small text-muted">זוכים פעילים כרגע: ${escapeHtml(formatNumber(tier.active.length))}</div>
                                    ${carryoverNote}
                                    ${
                                      winners.length
                                        ? `
                                          <div class="winner-list">
                                            ${winners
                                              .map((winner, winnerIndex) => {
                                                const isFocus = state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                                                return `
                                                  <div class="winner-item${isFocus ? " is-focus" : ""}">
                                                    <span class="winner-rank">${escapeHtml(String(winnerIndex + 1))}</span>
                                                    <div>
                                                      <div class="winner-name">${escapeHtml(winner.ambassador)}</div>
                                                      <div class="text-small text-muted">${escapeHtml(formatNumber(winner.deals))} עסקאות</div>
                                                    </div>
                                                    <div class="winner-amount">${escapeHtml(formatAmount(winner.total))}</div>
                                                  </div>
                                                `;
                                              })
                                              .join("")}
                                          </div>
                                        `
                                        : `<div class="empty-state">עדיין אין זכאים פעילים במדרגה הזאת.</div>`
                                    }
                                  </div>
                                </article>
                              `;
                            })
                            .join("")}
                        </div>
                      </div>
                    `
                  : `<div class="empty-state">לא נטענה טבלת פרסים תקפה. אפשר להעלות קובץ פרסים חדש ב-CSV או Excel.</div>`;

                elements.prizeBoard.innerHTML = `${podiumMarkup}${tiersMarkup}`;
              }

              function createSvg(width, height, ariaLabel) {
                return `
                  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(ariaLabel)}">
                    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
                  </svg>
                `;
              }

              function showTooltip(target, tooltip, html, clientX, clientY) {
                tooltip.innerHTML = html;
                tooltip.classList.add("is-visible");
                const rect = target.getBoundingClientRect();
                const tipRect = tooltip.getBoundingClientRect();
                const left = Math.min(Math.max(clientX - rect.left - tipRect.width / 2, 8), rect.width - tipRect.width - 8);
                const top = Math.max(clientY - rect.top - tipRect.height - 14, 8);
                tooltip.style.transform = `translate(${left}px, ${top}px)`;
              }

              function hideTooltip(tooltip) {
                tooltip.classList.remove("is-visible");
                tooltip.style.transform = "translate(-9999px, -9999px)";
              }

              function renderDailyChart(rows) {
                if (!rows.length) {
                  elements.dailyChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
                  elements.dailySummary.textContent = "";
                  return;
                }

                const metricMode = state.view.dailyMetric;
                const metricLabel = metricMode === "count" ? "מספר עסקאות" : metricMode === "average" ? "ממוצע לעסקה" : "סכום גיוס";
                const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));
                const aggregates = state.meta.uniqueDates
                  .filter((date) => !state.filters.dateFrom || date >= state.filters.dateFrom)
                  .filter((date) => !state.filters.dateTo || date <= state.filters.dateTo)
                  .map((date) => {
                    const dayRows = rows.filter((row) => row.date === date);
                    return {
                      date,
                      total: sumAmount(dayRows),
                      count: dayRows.length,
                      average: dayRows.length ? sumAmount(dayRows) / dayRows.length : 0,
                    };
                  })
                  .filter((entry) => entry.count > 0);

                const getValue = (entry) => (metricMode === "count" ? entry.count : metricMode === "average" ? entry.average : entry.total);

                const width = 920;
                const height = 280;
                const margin = { top: 24, right: 16, bottom: 60, left: 76 };
                const plotWidth = width - margin.left - margin.right;
                const plotHeight = height - margin.top - margin.bottom;
                const maxValue = Math.max(...aggregates.map((entry) => getValue(entry)), 1);
                const barWidth = plotWidth / Math.max(aggregates.length, 1) - 10;
                const baseline = margin.top + plotHeight;

                const parser = new DOMParser();
                const doc = parser.parseFromString(createSvg(width, height, "תרשים עמודות של גיוס יומי"), "image/svg+xml");
                const svgNode = doc.documentElement;

                for (let tick = 0; tick <= 4; tick += 1) {
                  const value = (maxValue / 4) * tick;
                  const y = margin.top + plotHeight - (value / maxValue) * plotHeight;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(19,23,80,0.14)" stroke-width="1"></line>
                     <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="rgba(16,16,16,0.6)" font-size="11">${escapeHtml(formatNumber(Math.round(value)))}</text>`
                  );
                }

                aggregates.forEach((entry, index) => {
                  const x = margin.left + index * (barWidth + 10) + 5;
                  const metricValue = getValue(entry);
                  const heightValue = (metricValue / maxValue) * plotHeight;
                  const y = baseline - heightValue;
                  const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                  bar.setAttribute("x", String(x));
                  bar.setAttribute("y", String(y));
                  bar.setAttribute("width", String(Math.max(barWidth, 12)));
                  bar.setAttribute("height", String(Math.max(heightValue, 2)));
                  bar.setAttribute("rx", "8");
                  bar.setAttribute("fill", "rgba(28,35,104,0.94)");
                  bar.classList.add("clickable-cell");
                  const tooltipHtml = `<strong>${escapeHtml(formatDate(entry.date))}</strong><br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(metricValue))}<br>${escapeHtml(formatNumber(entry.count))} עסקאות`;
                  bar.addEventListener("mouseenter", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
                  bar.addEventListener("mousemove", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
                  bar.addEventListener("mouseleave", () => hideTooltip(elements.dailyTooltip));
                  bar.addEventListener("click", () => {
                    state.filters.dateFrom = entry.date;
                    state.filters.dateTo = entry.date;
                    resetFilterOptions();
                    renderAll();
                  });
                  svgNode.appendChild(bar);

                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${x + Math.max(barWidth, 12) / 2}" y="${baseline + 20}" text-anchor="middle" fill="rgba(16,16,16,0.78)" font-size="11">${escapeHtml(formatShortDate(entry.date))}</text>
                     <text x="${x + Math.max(barWidth, 12) / 2}" y="${baseline + 36}" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(entry.date))}</text>`
                  );
                });

                elements.dailyChart.innerHTML = "";
                elements.dailyChart.appendChild(svgNode);
                const bestDay = [...aggregates].sort((left, right) => getValue(right) - getValue(left))[0];
                elements.dailySummary.textContent = bestDay ? `${metricLabel}: ${formatDate(bestDay.date)} · ${formatMetricValue(getValue(bestDay))}` : "";
              }

              function renderHeatmap(rows) {
                const dates = state.meta.uniqueDates
                  .filter((date) => !state.filters.dateFrom || date >= state.filters.dateFrom)
                  .filter((date) => !state.filters.dateTo || date <= state.filters.dateTo);
                if (!rows.length || !dates.length) {
                  elements.heatmapChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
                  return;
                }

                const metricMode = state.view.heatmapMetric;
                const metricLabel = metricMode === "count" ? "מספר עסקאות" : "סכום גיוס";
                const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));
                const hours = Array.from({ length: 24 }, (_, hour) => hour);
                const aggregates = new Map();
                rows.forEach((row) => {
                  const key = `${row.date}|${row.hour}`;
                  aggregates.set(key, (aggregates.get(key) || 0) + (metricMode === "count" ? 1 : row.amount));
                });

                const maxValue = Math.max(...aggregates.values(), 1);
                const cellWidth = 52;
                const cellHeight = 18;
                const width = Math.max(700, 110 + dates.length * cellWidth);
                const height = 82 + hours.length * cellHeight;
                const margin = { top: 48, right: 12, bottom: 12, left: 84 };

                const parser = new DOMParser();
                const doc = parser.parseFromString(createSvg(width, height, "מפת חום של גיוס לפי תאריך ושעה"), "image/svg+xml");
                const svgNode = doc.documentElement;

                dates.forEach((date, index) => {
                  const x = margin.left + index * cellWidth;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${x + cellWidth / 2}" y="18" text-anchor="middle" fill="rgba(16,16,16,0.78)" font-size="11">${escapeHtml(formatShortDate(date))}</text>
                     <text x="${x + cellWidth / 2}" y="34" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
                  );
                });

                hours.forEach((hour, rowIndex) => {
                  const y = margin.top + rowIndex * cellHeight;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${margin.left - 10}" y="${y + 12}" text-anchor="end" fill="rgba(16,16,16,0.55)" font-size="10">${String(hour).padStart(2, "0")}:00</text>`
                  );
                });

                dates.forEach((date, dateIndex) => {
                  hours.forEach((hour, hourIndex) => {
                    const value = aggregates.get(`${date}|${hour}`) || 0;
                    const intensity = value / maxValue;
                    const cell = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                    cell.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
                    cell.setAttribute("y", String(margin.top + hourIndex * cellHeight + 1));
                    cell.setAttribute("width", String(cellWidth - 3));
                    cell.setAttribute("height", String(cellHeight - 3));
                    cell.setAttribute("rx", "4");
                    cell.setAttribute("fill", "rgba(255,217,61,1)");
                    cell.setAttribute("fill-opacity", value ? String(0.14 + intensity * 0.86) : "0.08");
                    cell.setAttribute("stroke", "rgba(19,23,80,0.08)");
                    cell.classList.add("clickable-cell");
                    const tooltipHtml = `<strong>${escapeHtml(formatDate(date))}</strong><br>${String(hour).padStart(2, "0")}:00<br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(value))}`;
                    cell.addEventListener("mouseenter", (event) => showTooltip(elements.heatmapChart, elements.heatmapTooltip, tooltipHtml, event.clientX, event.clientY));
                    cell.addEventListener("mousemove", (event) => showTooltip(elements.heatmapChart, elements.heatmapTooltip, tooltipHtml, event.clientX, event.clientY));
                    cell.addEventListener("mouseleave", () => hideTooltip(elements.heatmapTooltip));
                    cell.addEventListener("click", () => {
                      state.filters.dateFrom = date;
                      state.filters.dateTo = date;
                      state.filters.hour = String(hour);
                      resetFilterOptions();
                      renderAll();
                    });
                    svgNode.appendChild(cell);
                  });
                });

                elements.heatmapChart.innerHTML = "";
                elements.heatmapChart.appendChild(svgNode);
              }

              function renderMovement(rows) {
                const focusRows = state.filters.ambassador === "all" ? rows : rows.filter((row) => row.ambassador === state.filters.ambassador);
                const projectDates = state.meta.projectDates.filter(
                  (date) => (!state.filters.dateFrom || date >= state.filters.dateFrom) && (!state.filters.dateTo || date <= state.filters.dateTo)
                );
                const metricMode = state.view.movementMetric;
                const metricLabel = metricMode === "count" ? "מספר עסקאות" : "סכום גיוס";
                const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));

                if (!focusRows.length || !projectDates.length) {
                  elements.movementChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
                  elements.movementSummary.textContent = "";
                  return;
                }

                const totalsByAmbassador = new Map();
                focusRows.forEach((row) => {
                  if (!row.projectDay || row.ambassador === "ללא שיוך") {
                    return;
                  }
                  totalsByAmbassador.set(row.ambassador, (totalsByAmbassador.get(row.ambassador) || 0) + (metricMode === "count" ? 1 : row.amount));
                });

                const selectedAmbassadors =
                  state.filters.ambassador === "all"
                    ? [...totalsByAmbassador.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([name]) => name)
                    : [state.filters.ambassador];

                const cellWidth = 58;
                const rowHeight = 24;
                const width = Math.max(720, 180 + projectDates.length * cellWidth);
                const height = 78 + selectedAmbassadors.length * rowHeight;
                const margin = { top: 46, right: 16, bottom: 12, left: 190 };
                const parser = new DOMParser();
                const doc = parser.parseFromString(createSvg(width, height, "מטריצת פעילות שגרירים לאורך ימי הפרויקט"), "image/svg+xml");
                const svgNode = doc.documentElement;
                const matrixValues = new Map();

                focusRows.forEach((row) => {
                  if (!row.projectDay || row.ambassador === "ללא שיוך") {
                    return;
                  }
                  const key = `${row.ambassador}|${row.date}`;
                  matrixValues.set(key, (matrixValues.get(key) || 0) + (metricMode === "count" ? 1 : row.amount));
                });

                const maxValue = Math.max(...matrixValues.values(), 1);

                projectDates.forEach((date, index) => {
                  const x = margin.left + index * cellWidth;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${x + cellWidth / 2}" y="18" text-anchor="middle" fill="rgba(16,16,16,0.78)" font-size="11">${escapeHtml(formatShortDate(date))}</text>
                     <text x="${x + cellWidth / 2}" y="34" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
                  );
                });

                selectedAmbassadors.forEach((ambassador, rowIndex) => {
                  const y = margin.top + rowIndex * rowHeight;
                  const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
                  label.setAttribute("x", String(margin.left - 10));
                  label.setAttribute("y", String(y + 14));
                  label.setAttribute("text-anchor", "end");
                  label.setAttribute("font-size", "11");
                  label.setAttribute("class", `matrix-label${state.filters.ambassador === ambassador ? " is-active" : ""}`);
                  label.textContent = ambassador;
                  label.addEventListener("click", () => {
                    state.filters.ambassador = state.filters.ambassador === ambassador ? "all" : ambassador;
                    resetFilterOptions();
                    renderAll();
                  });
                  svgNode.appendChild(label);

                  projectDates.forEach((date, dateIndex) => {
                    const value = matrixValues.get(`${ambassador}|${date}`) || 0;
                    const intensity = value / maxValue;
                    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                    rect.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
                    rect.setAttribute("y", String(y + 1));
                    rect.setAttribute("width", String(cellWidth - 4));
                    rect.setAttribute("height", String(rowHeight - 4));
                    rect.setAttribute("rx", "5");
                    rect.setAttribute("fill", "rgba(28,35,104,1)");
                    rect.setAttribute("fill-opacity", value ? String(0.14 + intensity * 0.86) : "0.08");
                    rect.classList.add("clickable-cell");
                    const tooltipHtml = `<strong>${escapeHtml(ambassador)}</strong><br>${escapeHtml(formatDate(date))}<br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(value))}`;
                    rect.addEventListener("mouseenter", (event) => showTooltip(elements.movementChart, elements.movementTooltip, tooltipHtml, event.clientX, event.clientY));
                    rect.addEventListener("mousemove", (event) => showTooltip(elements.movementChart, elements.movementTooltip, tooltipHtml, event.clientX, event.clientY));
                    rect.addEventListener("mouseleave", () => hideTooltip(elements.movementTooltip));
                    rect.addEventListener("click", () => {
                      state.filters.ambassador = ambassador;
                      state.filters.dateFrom = date;
                      state.filters.dateTo = date;
                      resetFilterOptions();
                      renderAll();
                    });
                    svgNode.appendChild(rect);
                  });
                });

                elements.movementChart.innerHTML = "";
                elements.movementChart.appendChild(svgNode);
                elements.movementSummary.textContent =
                  state.filters.ambassador === "all"
                    ? `מוצגים 12 השגרירים המובילים לפי ${metricLabel} במסנן הנוכחי`
                    : `מוצגת תנועת ${state.filters.ambassador} לפי ${metricLabel}`;
              }

              function renderTable(rows) {
                if (!rows.length) {
                  elements.tableRoot.innerHTML = `<div class="empty-state">אין רשומות להצגה.</div>`;
                  elements.tableSummary.textContent = "";
                  return;
                }

                const sortedRows = [...rows].sort((left, right) => right.createdIso.localeCompare(left.createdIso));
                const visibleRows = sortedRows.slice(0, 150);

                elements.tableRoot.innerHTML = `
                  <table>
                    <thead>
                      <tr>
                        <th>תאריך ושעה</th>
                        <th>יום</th>
                        <th>שגריר/ה</th>
                        <th>תורם/ת</th>
                        <th>סכום</th>
                        <th>עיר</th>
                        <th>סטטוס</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${visibleRows
                        .map(
                          (row) => `
                            <tr>
                              <td>${escapeHtml(formatDateTime(row.createdIso))}</td>
                              <td>${escapeHtml(`${row.projectDayLabel} · ${getWeekdayLabel(row.date)}`)}</td>
                              <td>${escapeHtml(row.ambassador)}</td>
                              <td>${escapeHtml(row.donor)}</td>
                              <td class="amount-cell">${escapeHtml(formatAmount(row.amount))}</td>
                              <td>${escapeHtml(row.city)}</td>
                              <td><span class="status-badge ${row.status === "failed" ? "failed" : ""}">${escapeHtml(row.status === "success" ? "חויב" : "נכשל")}</span></td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                `;

                elements.tableSummary.textContent =
                  rows.length > visibleRows.length
                    ? `מוצגות ${formatNumber(visibleRows.length)} מתוך ${formatNumber(rows.length)} רשומות`
                    : `${formatNumber(rows.length)} רשומות`;
              }

              async function loadPrizeModelFromFile(file) {
                if (file.name.toLowerCase().endsWith(".csv")) {
                  const text = await file.text();
                  return buildPrizeModelFromMatrix(parseCsv(text));
                }

                const buffer = await file.arrayBuffer();
                const XLSX = await import(XLSX_MODULE_URL);
                const workbook = XLSX.read(buffer, { type: "array" });
                const firstSheetName = workbook.SheetNames[0];
                const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
                  header: 1,
                  raw: false,
                  defval: "",
                });
                return buildPrizeModelFromMatrix(matrix);
              }

              function exportRowsToCsv(rows, fileName) {
                const headers = ["id", "createdIso", "date", "hour", "ambassador", "donor", "email", "amount", "city", "status", "chargeResult"];
                const lines = [headers.join(",")];
                rows.forEach((row) => {
                  const values = headers.map((header) => {
                    const value = row[header] ?? "";
                    const text = String(value).replaceAll('"', '""');
                    return `"${text}"`;
                  });
                  lines.push(values.join(","));
                });
                const blob = new Blob(["\\uFEFF" + lines.join("\\n")], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }

              function renderAll() {
                syncFiltersFromInputs();
                state.view.dailyMetric = elements.dailyMetric.value;
                state.view.heatmapMetric = elements.heatmapMetric.value;
                state.view.movementMetric = elements.movementMetric.value;
                const filteredRows = getFilteredRows();
                const compareRows = getComparisonRows();
                const prizeRows = getPrizeScopeRows();
                refreshAccessUi();
                setControlNote(filteredRows, prizeRows);
                renderPublicHeroBadges(prizeRows);
                renderHeroBadges(filteredRows, prizeRows, compareRows);
                renderMetrics(filteredRows);
                renderGoalsBoard(filteredRows);
                renderValidationBoard();
                renderExecutiveBoard(filteredRows);
                renderQualityBoard(filteredRows);
                renderSegmentBoard(filteredRows);
                renderComparisonBoard(filteredRows, compareRows);
                renderPrizeBoard(prizeRows);
                renderDailyChart(filteredRows);
                renderHeatmap(filteredRows);
                renderMovement(filteredRows);
                renderTable(filteredRows);
              }

              function bindEvents() {
                elements.navButtons.forEach((button) => {
                  button.addEventListener("click", () => {
                    const targetPage = button.dataset.pageTarget || "prizes";
                    setPage(targetPage);
                    if (targetPage === "admin" && !isManagerAuthenticated()) {
                      elements.loginEmail.focus();
                    }
                  });
                });

                elements.goAdminLogin.addEventListener("click", () => {
                  setPage("admin");
                  elements.loginEmail.focus();
                });

                elements.logoutButton.addEventListener("click", () => {
                  clearSession();
                  elements.loginPassword.value = "";
                  setLoginMessage("");
                  setPage("prizes");
                  renderAll();
                });

                elements.loginForm.addEventListener("submit", async (event) => {
                  event.preventDefault();
                  const email = normalizeSearchToken(elements.loginEmail.value);
                  const password = elements.loginPassword.value;
                  const allowedEmails = ACCESS_CONTROL.managerEmails.map((value) => normalizeSearchToken(value));
                  if (!email || !password) {
                    setLoginMessage("יש למלא גם מייל וגם סיסמה.", "error");
                    return;
                  }
                  if (!allowedEmails.includes(email)) {
                    setLoginMessage("המייל שהוזן אינו מורשה לגישה לפאנל הניהול.", "error");
                    return;
                  }
                  const passwordHash = await hashPassword(password);
                  if (passwordHash !== ACCESS_CONTROL.adminPasswordHash) {
                    setLoginMessage("הסיסמה שגויה. נסו שוב.", "error");
                    return;
                  }
                  storeSession(email);
                  elements.loginPassword.value = "";
                  setLoginMessage("הכניסה הצליחה. הדשבורד הניהולי נפתח.", "success");
                  setPage("admin");
                  renderAll();
                });

                [
                  elements.ambassador,
                  elements.projectDay,
                  elements.dateExact,
                  elements.dateFrom,
                  elements.dateTo,
                  elements.hour,
                  elements.hourFrom,
                  elements.hourTo,
                  elements.donor,
                  elements.amountMin,
                  elements.amountMax,
                  elements.dailyMetric,
                  elements.heatmapMetric,
                  elements.movementMetric,
                ].forEach((element) => {
                  element.addEventListener("change", renderAll);
                  if (element.tagName === "INPUT") {
                    element.addEventListener("input", renderAll);
                  }
                });

                [elements.goalTotal, elements.goalDaily].forEach((element) => {
                  element.addEventListener("change", () => {
                    state.goals = {
                      total: Number(elements.goalTotal.value || 0),
                      daily: Number(elements.goalDaily.value || 0),
                    };
                    storeGoals(state.goals);
                    renderAll();
                  });
                });

                elements.exportFiltered.addEventListener("click", () => {
                  const rows = getFilteredRows();
                  exportRowsToCsv(rows, "filtered-donations-export.csv");
                });

                elements.clearCompare.addEventListener("click", () => {
                  state.compare = {
                    rows: [],
                    meta: null,
                    label: "",
                  };
                  state.validation.compare = null;
                  elements.compareUpload.value = "";
                  resetFilterOptions();
                  renderAll();
                });

                elements.upload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  const text = await file.text();
                  const ingested = ingestCsvText(text, file.name);
                  state.meta = ingested.meta;
                  state.rows = enrichRows(ingested.normalized, ingested.meta);
                  state.sourceLabel = file.name;
                  state.validation.base = ingested.validation;
                  state.filters = {
                    ambassador: "all",
                    projectDay: "all",
                    dateExact: "all",
                    hour: "all",
                    hourFrom: "all",
                    hourTo: "all",
                    dateFrom: ingested.meta.defaultFrom || "",
                    dateTo: ingested.meta.defaultTo || "",
                    donor: "",
                    amountMin: "",
                    amountMax: "",
                  };
                  resetFilterOptions();
                  renderAll();
                });

                elements.compareUpload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  const text = await file.text();
                  const ingested = ingestCsvText(text, file.name);
                  state.compare = {
                    rows: enrichRows(ingested.normalized, ingested.meta),
                    meta: ingested.meta,
                    label: file.name,
                  };
                  state.validation.compare = ingested.validation;
                  resetFilterOptions();
                  renderAll();
                });

                elements.prizeUpload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  const model = await loadPrizeModelFromFile(file);
                  state.prizeModel = model;
                  storePrizeModel(model);
                  renderAll();
                });
              }

              state.rows = enrichRows(state.rows, state.meta);
              state.validation.base = {
                label: state.sourceLabel,
                totalRows: state.rows.length,
                validRows: state.rows,
                errors: [],
                warnings: [],
                missingColumns: [],
                invalidDateRows: 0,
                invalidAmountRows: 0,
                missingAmbassadorRows: state.rows.filter((row) => row.ambassador === "ללא שיוך").length,
                missingEmailRows: state.rows.filter((row) => !row.email).length,
                duplicateIdCount: 0,
              };
              state.prizeModel = normalizePrizeModel(state.prizeModel);
              resetFilterOptions();
              setPage(state.session ? "admin" : "prizes");
              setLoginMessage("");
              bindEvents();
              renderAll();
            })();
          </script>
        </div>
        """
    ).strip()

    return (
        template.replace("__INITIAL_ROWS__", rows_json)
        .replace("__INITIAL_META__", meta_json)
        .replace("__INITIAL_LOGO__", logo_json)
        .replace("__INITIAL_PRIZES__", prize_json)
        .replace("__ACCESS_CONTROL__", access_json)
    )


def export_browser_friendly_html() -> None:
    shell_html = OUTPUT_HTML.read_text(encoding="utf-8")
    start_token = 'srcdoc="'
    end_token = '"></iframe>'
    start_index = shell_html.find(start_token)
    if start_index == -1:
        return
    start_index += len(start_token)
    end_index = shell_html.rfind(end_token)
    if end_index == -1 or end_index <= start_index:
        return
    browser_html = unescape(shell_html[start_index:end_index])
    BROWSER_OUTPUT_HTML.write_text(browser_html, encoding="utf-8")


def main() -> None:
    rows = load_rows()
    meta = build_meta(rows)
    logo_data_uri = load_logo_data_uri()
    prize_model = load_prize_model()
    fragment = build_fragment(rows, meta, logo_data_uri, prize_model)
    VIS_DIR.mkdir(parents=True, exist_ok=True)
    FRAGMENT_PATH.write_text(fragment, encoding="utf-8")

    subprocess.run(
        [
            str(PYTHON_EXE),
            str(RENDER_SCRIPT),
            str(FRAGMENT_PATH),
            str(OUTPUT_HTML),
        ],
        check=True,
    )
    export_browser_friendly_html()


if __name__ == "__main__":
    main()
