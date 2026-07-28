from __future__ import annotations

import base64
import csv
import json
import os
import re
import subprocess
import sys
import textwrap
from datetime import datetime
from html import unescape
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parent.parent
WORK_DIR = Path(os.getenv("YELLOW_DASHBOARD_WORK_DIR", str(ROOT_DIR / "work"))).resolve()
ASSETS_DIR = WORK_DIR / "assets"
SAMPLES_DIR = WORK_DIR / "samples"
SOURCE_CSV = Path(os.getenv("YELLOW_DASHBOARD_SOURCE_CSV", str(WORK_DIR / "source.csv"))).resolve()
SAMPLE_SOURCE_CSV = Path(os.getenv("YELLOW_DASHBOARD_SAMPLE_SOURCE_CSV", str(SAMPLES_DIR / "sample-source.csv"))).resolve()
PRIZES_XLSX = Path(os.getenv("YELLOW_DASHBOARD_PRIZES_XLSX", str(WORK_DIR / "prizes.xlsx"))).resolve()
PRIZES_CSV = Path(os.getenv("YELLOW_DASHBOARD_PRIZES_CSV", str(WORK_DIR / "prizes.csv"))).resolve()
ORG_LOGO_PATH = ASSETS_DIR / "achim-lasemel-logo.png"
CAMPAIGN_LOGO_PATH = ASSETS_DIR / "osim-tov-betzahov-logo.png"
BACKDROP_PATH = ASSETS_DIR / "dashboard-backdrop.png"
LEGACY_LOGO_PATH = WORK_DIR / "brand-logo.png"
OUTPUTS_DIR = Path(os.getenv("YELLOW_DASHBOARD_OUTPUT_DIR", str(ROOT_DIR / "outputs"))).resolve()
VIS_DIR = Path(os.getenv("YELLOW_DASHBOARD_VIS_DIR", str(OUTPUTS_DIR / ".render-cache"))).resolve()
FRAGMENT_PATH = VIS_DIR / "yellow-project-dashboard-fragment.html"
OUTPUT_HTML = Path(os.getenv("YELLOW_DASHBOARD_OUTPUT_HTML", str(OUTPUTS_DIR / "yellow-project-dashboard.html"))).resolve()
BROWSER_OUTPUT_HTML = Path(
    os.getenv("YELLOW_DASHBOARD_BROWSER_OUTPUT_HTML", str(OUTPUTS_DIR / "yellow-project-dashboard-browser.html"))
).resolve()
PUBLIC_BROWSER_OUTPUT_HTML = Path(
    os.getenv("YELLOW_DASHBOARD_PUBLIC_OUTPUT_HTML", str(OUTPUTS_DIR / "yellow-project-public-dashboard.html"))
).resolve()
DEFAULT_RENDER_SCRIPT = (
    Path.home()
    / ".codex"
    / "plugins"
    / "cache"
    / "openai-bundled"
    / "visualize"
    / "1.0.11"
    / "skills"
    / "visualize"
    / "scripts"
    / "render.py"
)
RENDER_SCRIPT = Path(os.getenv("YELLOW_DASHBOARD_RENDER_SCRIPT", str(DEFAULT_RENDER_SCRIPT))).resolve()
PYTHON_EXE = Path(os.getenv("YELLOW_DASHBOARD_PYTHON_EXE", sys.executable)).resolve()
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


def get_source_csv_path() -> Path | None:
    if SOURCE_CSV.exists():
        return SOURCE_CSV
    if SAMPLE_SOURCE_CSV.exists():
        return SAMPLE_SOURCE_CSV
    return None


def load_rows() -> list[dict]:
    source_path = get_source_csv_path()
    if source_path is None:
        return []

    rows: list[dict] = []
    with source_path.open("r", encoding="utf-8", newline="") as handle:
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


def build_leaderboard(rows: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for row in rows:
        ambassador = (row.get("ambassador") or "").strip()
        if not ambassador or ambassador == "×œ×œ× ×©×™×•×š":
            continue
        current = grouped.setdefault(ambassador, {"ambassador": ambassador, "total": 0.0, "deals": 0})
        current["total"] += float(row.get("amount") or 0)
        current["deals"] += 1
    return sorted(grouped.values(), key=lambda item: item["total"], reverse=True)


def compute_public_snapshot(rows: list[dict], meta: dict, prize_model: dict) -> dict:
    leaderboard = build_leaderboard(rows)
    total_raised = sum(float(row.get("amount") or 0) for row in rows)
    latest_created = max((row.get("createdIso") or "" for row in rows), default="")
    active_ambassadors = len(leaderboard)
    place_prizes = sorted(prize_model.get("placePrizes", []), key=lambda item: item.get("place", 0))
    tier_prizes = sorted(prize_model.get("tierPrizes", []), key=lambda item: item.get("threshold", 0))

    podium = []
    for item in place_prizes[:3]:
        winner = leaderboard[item["place"] - 1] if len(leaderboard) >= item["place"] else None
        podium.append(
            {
                "place": item["place"],
                "label": item.get("label") or f"מקום {item['place']}",
                "prize": item.get("prize") or "",
                "winner": winner["ambassador"] if winner else "טרם נקבע",
                "amount": winner["total"] if winner else 0,
                "deals": winner["deals"] if winner else 0,
            }
        )

    tiers = []
    for tier in tier_prizes:
        winners = [entry for entry in leaderboard if entry["total"] >= tier["threshold"]]
        next_up = next((entry for entry in leaderboard if entry["total"] < tier["threshold"]), None)
        tiers.append(
            {
                "threshold": tier["threshold"],
                "prize": tier["prize"],
                "winnerCount": len(winners),
                "winnerNames": [entry["ambassador"] for entry in winners[:5]],
                "nextUpName": next_up["ambassador"] if next_up else "",
                "nextUpGap": max(tier["threshold"] - next_up["total"], 0) if next_up else 0,
            }
        )

    return {
        "projectWindowLabel": meta.get("projectWindowLabel", ""),
        "totalRaised": total_raised,
        "latestCreated": latest_created,
        "activeAmbassadors": active_ambassadors,
        "leaderboard": leaderboard[:12],
        "podium": podium,
        "tiers": tiers,
    }


def load_logo_data_uri(path: Path) -> str:
    if not path.exists():
        return ""
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return str(value).strip()


def load_prize_model() -> dict:
    if PRIZES_XLSX.exists():
        df = pd.read_excel(PRIZES_XLSX)
    elif PRIZES_CSV.exists():
        df = pd.read_csv(PRIZES_CSV)
    else:
        return {"placePrizes": [], "tierPrizes": [], "tierRuleNote": ""}
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


def build_fragment(
    rows: list[dict],
    meta: dict,
    org_logo_data_uri: str,
    campaign_logo_data_uri: str,
    backdrop_data_uri: str,
    prize_model: dict,
) -> str:
    rows_json = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    org_logo_json = json.dumps(org_logo_data_uri, ensure_ascii=False)
    campaign_logo_json = json.dumps(campaign_logo_data_uri, ensure_ascii=False)
    backdrop_json = json.dumps(backdrop_data_uri, ensure_ascii=False)
    prize_json = json.dumps(prize_model, ensure_ascii=False, separators=(",", ":"))
    auth_config_json = json.dumps(
        {
            "mode": "backend",
            "statusEndpoint": "/api/auth/status",
            "loginEndpoint": "/api/auth/login",
            "setupEndpoint": "/api/auth/setup",
            "logoutEndpoint": "/api/auth/logout",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )

    template = textwrap.dedent(
        """
        <div id="yellow-dashboard-root" dir="rtl">
          <style>
            @import url("https://fonts.googleapis.com/css2?family=Assistant:wght@300;400;500;600;700;800&display=swap");

            #yellow-dashboard-root {
              --navy-1000: #070D24;
              --navy-950: #0B1435;
              --navy-900: #111D4A;
              --navy-800: #19275F;
              --navy-700: #24377C;
              --yolk-600: #F4C900;
              --yolk-500: #FFD629;
              --yolk-400: #FFE266;
              --yolk-200: #FFF2AD;
              --white: #FFFFFF;
              --off-white: #F6F7FA;
              --surface-soft: #EEF0F5;
              --black: #090B10;
              --graphite: #252934;
              --text-muted: #697080;
              --border-light: rgba(17, 29, 74, 0.12);
              --space-1: 4px;
              --space-2: 8px;
              --space-3: 12px;
              --space-4: 16px;
              --space-5: 24px;
              --space-6: 32px;
              --space-7: 48px;
              --radius-sm: 8px;
              --radius-md: 12px;
              --radius-lg: 18px;
              --radius-xl: 24px;
              --shadow-soft: 0 20px 48px rgba(11, 20, 53, 0.08);
              --shadow-card: 0 12px 30px rgba(11, 20, 53, 0.08);
              --brand-pattern-campaign: none;
              --brand-pattern-organization: none;
              --dashboard-backdrop: none;
              position: relative;
              isolation: isolate;
              color: var(--graphite);
              font-family: "Assistant", Arial, sans-serif;
              font-size: var(--font-size-base);
              background:
                linear-gradient(180deg, rgba(246, 247, 250, 0.84), rgba(246, 247, 250, 0.96)),
                radial-gradient(circle at top left, rgba(255, 214, 41, 0.16), transparent 24rem),
                radial-gradient(circle at top right, rgba(17, 29, 74, 0.07), transparent 28rem),
                var(--dashboard-backdrop),
                linear-gradient(180deg, rgba(17, 29, 74, 0.05), var(--off-white) 18%);
              background-size: auto, auto, auto, cover, auto;
              background-position: center, top left, top right, center top, center;
              background-repeat: no-repeat, no-repeat, no-repeat, no-repeat, no-repeat;
              padding: var(--space-4);
              min-height: 100%;
            }

            #yellow-dashboard-root::before {
              content: "";
              position: absolute;
              inset: 0;
              z-index: 0;
              pointer-events: none;
              background-image: var(--brand-pattern-campaign), var(--brand-pattern-organization);
              background-size: 160px 160px, 128px 128px;
              background-position: 3rem 8rem, 10rem 15rem;
              background-repeat: repeat;
              opacity: 0.03;
            }

            #yellow-dashboard-root,
            #yellow-dashboard-root button,
            #yellow-dashboard-root input,
            #yellow-dashboard-root select,
            #yellow-dashboard-root textarea {
              font-family: "Assistant", Arial, sans-serif;
            }

            #yellow-dashboard-root * {
              box-sizing: border-box;
            }

            #yellow-dashboard-root svg text,
            #yellow-dashboard-root .metric-value,
            #yellow-dashboard-root .comparison-value,
            #yellow-dashboard-root .amount-cell,
            #yellow-dashboard-root .winner-amount,
            #yellow-dashboard-root .hero-meta strong,
            #yellow-dashboard-root .status-chip,
            #yellow-dashboard-root .prize-pill,
            #yellow-dashboard-root .tooltip,
            #yellow-dashboard-root input[type="number"],
            #yellow-dashboard-root input[type="date"] {
              font-variant-numeric: tabular-nums;
            }

            #yellow-dashboard-root .app-shell {
              position: relative;
              z-index: 1;
              display: grid;
              gap: var(--space-5);
              max-width: 1600px;
              margin: 0 auto;
            }

            #yellow-dashboard-root .app-content,
            #yellow-dashboard-root .dashboard-shell,
            #yellow-dashboard-root .page-shell,
            #yellow-dashboard-root .prize-shell,
            #yellow-dashboard-root .analysis-shell,
            #yellow-dashboard-root .comparison-shell {
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .page-shell {
              display: none;
              animation: pageFade 180ms ease;
            }

            #yellow-dashboard-root .page-shell.is-active {
              display: grid;
            }

            @keyframes pageFade {
              from {
                opacity: 0;
                transform: translateY(6px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            #yellow-dashboard-root .app-card,
            #yellow-dashboard-root .app-topbar,
            #yellow-dashboard-root .page-panel,
            #yellow-dashboard-root .chart-panel,
            #yellow-dashboard-root .comparison-card,
            #yellow-dashboard-root .comparison-list,
            #yellow-dashboard-root .analysis-card,
            #yellow-dashboard-root .metric-card,
            #yellow-dashboard-root .prize-card,
            #yellow-dashboard-root .admin-lock,
            #yellow-dashboard-root .legal-document,
            #yellow-dashboard-root .legal-sidebar,
            #yellow-dashboard-root .public-hero,
            #yellow-dashboard-root .legal-hero {
              background: rgba(255, 255, 255, 0.96);
              border: 1px solid var(--border-light);
              border-radius: var(--radius-xl);
              box-shadow: var(--shadow-card);
            }

            #yellow-dashboard-root .app-card--elevated {
              box-shadow: var(--shadow-soft);
            }

            #yellow-dashboard-root .app-card--dark,
            #yellow-dashboard-root .public-hero,
            #yellow-dashboard-root .brand-command,
            #yellow-dashboard-root .login-visual {
              background:
                linear-gradient(135deg, rgba(7, 13, 36, 0.98), rgba(17, 29, 74, 0.96) 54%, rgba(36, 55, 124, 0.95) 100%);
              color: var(--white);
              border-color: rgba(255, 214, 41, 0.16);
            }

            #yellow-dashboard-root .app-topbar {
              position: sticky;
              top: var(--space-4);
              z-index: 20;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-5);
              padding: var(--space-4) var(--space-5);
              background: rgba(11, 20, 53, 0.96);
              border-color: rgba(255, 214, 41, 0.14);
              backdrop-filter: blur(14px);
            }

            #yellow-dashboard-root .brand-header::after {
              content: "";
              position: absolute;
              inset-inline: var(--space-5);
              inset-block-end: 0;
              height: 1px;
              background: linear-gradient(90deg, transparent, rgba(255, 214, 41, 0.55), transparent);
            }

            #yellow-dashboard-root .topbar-brand,
            #yellow-dashboard-root .topbar-actions,
            #yellow-dashboard-root .session-box,
            #yellow-dashboard-root .brand-row,
            #yellow-dashboard-root .prize-title-row,
            #yellow-dashboard-root .brand-command-head,
            #yellow-dashboard-root .control-group-header,
            #yellow-dashboard-root .bucket-head,
            #yellow-dashboard-root .comparison-main,
            #yellow-dashboard-root .login-brand-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-4);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .topbar-brand {
              justify-content: flex-end;
              text-align: right;
            }

            #yellow-dashboard-root .brand-logo-cluster,
            #yellow-dashboard-root .public-brand-cluster,
            #yellow-dashboard-root .brand-command-logos,
            #yellow-dashboard-root .login-logos {
              display: flex;
              align-items: center;
              gap: var(--space-4);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .topbar-campaign-logo,
            #yellow-dashboard-root .topbar-logo {
              object-fit: contain;
              display: block;
            }

            #yellow-dashboard-root .topbar-campaign-logo {
              height: 54px;
              width: auto;
              max-width: 156px;
            }

            #yellow-dashboard-root .topbar-logo {
              height: 62px;
              width: auto;
              max-width: 144px;
              transform: scale(1.55);
              transform-origin: center;
            }

            #yellow-dashboard-root .brand-divider {
              inline-size: 1px;
              block-size: 52px;
              background: rgba(255, 255, 255, 0.22);
              flex: 0 0 auto;
            }

            #yellow-dashboard-root .topbar-meta {
              display: grid;
              gap: var(--space-1);
              color: var(--white);
            }

            #yellow-dashboard-root .topbar-title {
              font-size: 1.12rem;
              font-weight: 700;
              letter-spacing: 0.01em;
            }

            #yellow-dashboard-root .topbar-subtitle {
              color: rgba(255, 255, 255, 0.7);
              font-size: 0.94rem;
              font-weight: 400;
            }

            #yellow-dashboard-root .topbar-actions {
              justify-content: flex-end;
            }

            #yellow-dashboard-root .top-nav,
            #yellow-dashboard-root .action-row,
            #yellow-dashboard-root .data-toolbar,
            #yellow-dashboard-root .public-badges,
            #yellow-dashboard-root .hero-badges,
            #yellow-dashboard-root .legend-row,
            #yellow-dashboard-root .control-actions {
              display: flex;
              align-items: center;
              gap: var(--space-3);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .nav-button,
            #yellow-dashboard-root .button-primary,
            #yellow-dashboard-root .button-secondary,
            #yellow-dashboard-root .button-ghost,
            #yellow-dashboard-root .action-button {
              border-radius: 999px;
              border: 1px solid transparent;
              padding: 0.72rem 1.05rem;
              font: inherit;
              font-weight: 700;
              line-height: 1;
              cursor: pointer;
              transition:
                background-color 180ms ease,
                color 180ms ease,
                border-color 180ms ease,
                box-shadow 180ms ease,
                transform 180ms ease;
            }

            #yellow-dashboard-root .nav-button {
              background: transparent;
              color: rgba(255, 255, 255, 0.74);
              border-color: transparent;
              border-radius: var(--radius-md);
              font-weight: 600;
              padding-inline: 0.9rem;
              position: relative;
            }

            #yellow-dashboard-root .nav-button::after {
              content: "";
              position: absolute;
              inset-inline: 0.9rem;
              inset-block-end: 0.22rem;
              height: 2px;
              border-radius: 999px;
              background: transparent;
            }

            #yellow-dashboard-root .nav-button.is-active {
              color: var(--white);
              background: rgba(255, 255, 255, 0.06);
            }

            #yellow-dashboard-root .nav-button.is-active::after {
              background: var(--yolk-500);
            }

            #yellow-dashboard-root .button-primary,
            #yellow-dashboard-root .action-button,
            #yellow-dashboard-root .action-button.primary {
              background: var(--yolk-500);
              color: var(--navy-950);
              box-shadow: 0 10px 24px rgba(255, 214, 41, 0.24);
            }

            #yellow-dashboard-root .button-secondary,
            #yellow-dashboard-root .action-button.secondary {
              background: var(--navy-950);
              color: var(--white);
              border-color: rgba(255, 255, 255, 0.14);
            }

            #yellow-dashboard-root .button-ghost {
              background: transparent;
              color: var(--navy-900);
              border-color: rgba(17, 29, 74, 0.14);
            }

            #yellow-dashboard-root .app-topbar .button-ghost {
              color: var(--white);
              border-color: rgba(255, 255, 255, 0.16);
              background: rgba(255, 255, 255, 0.05);
            }

            #yellow-dashboard-root .session-chip,
            #yellow-dashboard-root .status-chip,
            #yellow-dashboard-root .hero-badge,
            #yellow-dashboard-root .prize-pill {
              display: inline-flex;
              align-items: center;
              gap: 0.45rem;
              padding: 0.48rem 0.82rem;
              border-radius: 999px;
              font-size: 0.92rem;
              font-weight: 600;
              white-space: nowrap;
            }

            #yellow-dashboard-root .session-chip {
              background: rgba(255, 214, 41, 0.16);
              color: var(--white);
              border: 1px solid rgba(255, 214, 41, 0.18);
              max-width: 100%;
              white-space: normal;
            }

            #yellow-dashboard-root .status-chip,
            #yellow-dashboard-root .status-note {
              background: rgba(255, 214, 41, 0.12);
              color: var(--navy-950);
              border: 1px solid rgba(17, 29, 74, 0.12);
            }

            #yellow-dashboard-root .status-note.is-error,
            #yellow-dashboard-root .status-chip.is-error {
              background: rgba(255, 214, 41, 0.18);
              border-inline-start: 4px solid var(--black);
              color: var(--navy-950);
            }

            #yellow-dashboard-root .status-note.is-success,
            #yellow-dashboard-root .status-chip.is-success {
              background: rgba(17, 29, 74, 0.08);
              border-inline-start: 4px solid var(--yolk-500);
              color: var(--navy-950);
            }

            #yellow-dashboard-root .status-note.is-warning,
            #yellow-dashboard-root .status-chip.is-warning {
              background: rgba(255, 226, 102, 0.22);
              border-inline-start: 4px solid var(--navy-900);
              color: var(--navy-950);
            }

            #yellow-dashboard-root .hero-badge {
              background: rgba(255, 255, 255, 0.1);
              color: rgba(255, 255, 255, 0.92);
              border: 1px solid rgba(255, 255, 255, 0.1);
            }

            #yellow-dashboard-root .text-small {
              font-size: 0.92rem;
            }

            #yellow-dashboard-root .text-muted,
            #yellow-dashboard-root .view-note,
            #yellow-dashboard-root .control-note {
              color: var(--text-muted);
            }

            #yellow-dashboard-root .public-hero,
            #yellow-dashboard-root .brand-command,
            #yellow-dashboard-root .legal-hero,
            #yellow-dashboard-root .admin-lock {
              position: relative;
              overflow: hidden;
            }

            #yellow-dashboard-root .public-hero::after,
            #yellow-dashboard-root .brand-command::after,
            #yellow-dashboard-root .login-visual::after {
              content: "";
              position: absolute;
              inset-inline-end: -8%;
              inset-block-end: -14%;
              width: 280px;
              height: 280px;
              border-radius: 50%;
              background: radial-gradient(circle, rgba(255, 214, 41, 0.26), transparent 72%);
            }

            #yellow-dashboard-root .public-hero,
            #yellow-dashboard-root .legal-hero,
            #yellow-dashboard-root .brand-command,
            #yellow-dashboard-root .control-panel,
            #yellow-dashboard-root .page-panel,
            #yellow-dashboard-root .admin-lock {
              padding: var(--space-6);
            }

            #yellow-dashboard-root .public-hero-grid,
            #yellow-dashboard-root .admin-overview-grid,
            #yellow-dashboard-root .login-shell,
            #yellow-dashboard-root .legal-layout {
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .public-hero-grid {
              grid-template-columns: minmax(0, 1fr);
              align-items: start;
            }

            #yellow-dashboard-root .public-hero-copy,
            #yellow-dashboard-root .brand-copy,
            #yellow-dashboard-root .login-copy {
              display: grid;
              gap: var(--space-4);
            }

            #yellow-dashboard-root .public-hero-copy {
              min-width: 0;
              position: relative;
              z-index: 1;
            }

            #yellow-dashboard-root .brand-kicker {
              display: inline-flex;
              align-items: center;
              width: fit-content;
              padding: 0.42rem 0.85rem;
              border-radius: 999px;
              background: rgba(255, 214, 41, 0.16);
              color: var(--yolk-200);
              font-weight: 700;
              font-size: 0.92rem;
            }

            #yellow-dashboard-root .hero-title,
            #yellow-dashboard-root .public-hero-title {
              margin: 0;
              line-height: 1.02;
              font-size: clamp(2rem, 3.6vw, 3.2rem);
              font-weight: 800;
            }

            #yellow-dashboard-root .public-hero-title {
              color: var(--white);
              max-width: 11ch;
              font-size: clamp(2.2rem, 4vw, 4.25rem);
            }

            #yellow-dashboard-root .hero-subtitle,
            #yellow-dashboard-root .public-hero p,
            #yellow-dashboard-root .login-copy p {
              margin: 0;
              max-width: 48rem;
              color: rgba(255, 255, 255, 0.82);
              line-height: 1.75;
            }

            #yellow-dashboard-root .public-hero-watermark {
              position: absolute;
              inset-inline-start: var(--space-6);
              inset-block-start: 50%;
              transform: translateY(-50%);
              width: clamp(180px, 18vw, 280px);
              opacity: 0.4;
              pointer-events: none;
              z-index: 0;
            }

            #yellow-dashboard-root .public-hero-watermark img {
              width: 100%;
              height: auto;
              display: block;
              object-fit: contain;
            }

            #yellow-dashboard-root .public-badges,
            #yellow-dashboard-root .public-snapshot-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              align-items: stretch;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .public-snapshot-grid {
              margin-top: var(--space-2);
            }

            #yellow-dashboard-root .public-snapshot-card {
              display: grid;
              gap: var(--space-2);
              min-height: 134px;
              padding: 1rem 1.1rem;
              border-radius: var(--radius-xl);
              background: rgba(255, 255, 255, 0.09);
              border: 1px solid rgba(255, 255, 255, 0.1);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
            }

            #yellow-dashboard-root .public-snapshot-card--primary {
              background: linear-gradient(180deg, rgba(255, 214, 41, 0.16), rgba(255, 214, 41, 0.08));
              border-color: rgba(255, 214, 41, 0.22);
            }

            #yellow-dashboard-root .public-snapshot-card--wide {
              grid-column: span 2;
            }

            #yellow-dashboard-root .public-snapshot-label {
              color: rgba(255, 255, 255, 0.7);
              font-size: 0.88rem;
              font-weight: 600;
            }

            #yellow-dashboard-root .public-snapshot-value {
              color: var(--white);
              font-size: clamp(1.3rem, 2vw, 2rem);
              font-weight: 800;
              line-height: 1.15;
              font-variant-numeric: tabular-nums;
            }

            #yellow-dashboard-root .public-snapshot-card--primary .public-snapshot-value {
              color: var(--yolk-200);
              font-size: clamp(1.6rem, 2.6vw, 2.4rem);
            }

            #yellow-dashboard-root .public-snapshot-meta {
              color: rgba(255, 255, 255, 0.82);
              font-size: 0.92rem;
              line-height: 1.5;
            }

            #yellow-dashboard-root .public-snapshot-status {
              display: inline-flex;
              width: fit-content;
              align-items: center;
              gap: 0.45rem;
              padding: 0.42rem 0.78rem;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.08);
              color: var(--white);
              font-size: 0.86rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .public-logo-frame,
            #yellow-dashboard-root .logo-wrap,
            #yellow-dashboard-root .login-logo-frame {
              display: grid;
              place-items: center;
              padding: var(--space-2);
              background: transparent;
              border-radius: var(--radius-lg);
              box-shadow: none;
              border: 1px solid rgba(255, 255, 255, 0.08);
            }

            #yellow-dashboard-root .public-logo-frame img,
            #yellow-dashboard-root .logo-wrap img,
            #yellow-dashboard-root .login-logo-frame img {
              display: block;
              max-width: 100%;
              max-height: 92px;
              object-fit: contain;
            }

            #yellow-dashboard-root .section-header,
            #yellow-dashboard-root .section-head {
              display: flex;
              align-items: baseline;
              justify-content: space-between;
              gap: var(--space-4);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .section-header h2,
            #yellow-dashboard-root .section-header h3,
            #yellow-dashboard-root .section-head h3,
            #yellow-dashboard-root .legal-document h2,
            #yellow-dashboard-root .legal-document h3,
            #yellow-dashboard-root .legal-document h4,
            #yellow-dashboard-root .analysis-card h4,
            #yellow-dashboard-root .comparison-card h4,
            #yellow-dashboard-root .comparison-list h4,
            #yellow-dashboard-root .prize-card h4,
            #yellow-dashboard-root .control-panel h3,
            #yellow-dashboard-root .login-card h2 {
              margin: 0;
              color: var(--navy-950);
            }

            #yellow-dashboard-root .section-header h3,
            #yellow-dashboard-root .section-head h3 {
              font-size: 1.25rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .admin-content[hidden] {
              display: none !important;
            }

            #yellow-dashboard-root .admin-overview-grid {
              grid-template-columns: minmax(0, 1.15fr) minmax(380px, 0.85fr);
              align-items: start;
            }

            #yellow-dashboard-root .brand-command {
              display: grid;
              gap: var(--space-5);
              padding: var(--space-6);
            }

            #yellow-dashboard-root .brand-command-head {
              align-items: start;
            }

            #yellow-dashboard-root .brand-command .hero-title,
            #yellow-dashboard-root .brand-command .hero-subtitle,
            #yellow-dashboard-root .brand-command .hero-badge,
            #yellow-dashboard-root .brand-command .brand-kicker,
            #yellow-dashboard-root .login-visual .brand-kicker,
            #yellow-dashboard-root .login-visual h2,
            #yellow-dashboard-root .login-visual p {
              color: var(--white);
            }

            #yellow-dashboard-root .hero-meta-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: var(--space-3);
            }

            #yellow-dashboard-root .hero-meta {
              padding: var(--space-4);
              border-radius: var(--radius-lg);
              background: rgba(255, 255, 255, 0.08);
              border: 1px solid rgba(255, 255, 255, 0.08);
              display: grid;
              gap: var(--space-1);
            }

            #yellow-dashboard-root .hero-meta span {
              color: rgba(255, 255, 255, 0.72);
              font-size: 0.9rem;
            }

            #yellow-dashboard-root .hero-meta strong {
              color: var(--white);
              font-size: 1.02rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .control-panel {
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .control-groups {
              display: grid;
              gap: var(--space-4);
            }

            #yellow-dashboard-root .control-group {
              display: grid;
              gap: var(--space-4);
              padding: var(--space-4);
              border-radius: var(--radius-lg);
              background: var(--off-white);
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .control-group-header {
              align-items: baseline;
            }

            #yellow-dashboard-root .control-group-header h4 {
              margin: 0;
              color: var(--navy-950);
              font-size: 1.02rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .control-group-header p {
              margin: 0;
              color: var(--text-muted);
              font-size: 0.9rem;
            }

            #yellow-dashboard-root .filters-grid {
              display: grid;
              gap: var(--space-4);
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            #yellow-dashboard-root .filters-grid.filters-grid--three {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }

            #yellow-dashboard-root .form-label {
              display: grid;
              gap: var(--space-2);
              color: var(--navy-900);
              font-size: 0.96rem;
              font-weight: 600;
            }

            #yellow-dashboard-root .form-control,
            #yellow-dashboard-root .form-select {
              width: 100%;
              min-height: 52px;
              padding: 0.82rem 0.95rem;
              border-radius: var(--radius-md);
              border: 1px solid rgba(17, 29, 74, 0.16);
              background: var(--white);
              color: var(--graphite);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
            }

            #yellow-dashboard-root .form-control::placeholder {
              color: rgba(105, 112, 128, 0.76);
            }

            #yellow-dashboard-root .form-control:focus-visible,
            #yellow-dashboard-root .form-select:focus-visible,
            #yellow-dashboard-root .nav-button:focus-visible,
            #yellow-dashboard-root .button-primary:focus-visible,
            #yellow-dashboard-root .button-secondary:focus-visible,
            #yellow-dashboard-root .button-ghost:focus-visible,
            #yellow-dashboard-root .action-button:focus-visible,
            #yellow-dashboard-root .metric-toggle:focus-visible {
              outline: 2px solid var(--navy-950);
              outline-offset: 2px;
              box-shadow: 0 0 0 4px rgba(255, 214, 41, 0.48);
            }

            #yellow-dashboard-root input[type="file"]::file-selector-button {
              margin-inline-end: var(--space-3);
              border: 1px solid rgba(17, 29, 74, 0.12);
              border-radius: 999px;
              padding: 0.58rem 0.9rem;
              background: var(--navy-950);
              color: var(--white);
              font: inherit;
              font-weight: 700;
              cursor: pointer;
            }

            #yellow-dashboard-root .control-actions {
              justify-content: flex-start;
            }

            #yellow-dashboard-root .active-filter-summary {
              min-height: 50px;
              display: flex;
              align-items: center;
            }

            #yellow-dashboard-root .metric-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: var(--space-4);
            }

            #yellow-dashboard-root .kpi-card,
            #yellow-dashboard-root .metric-card {
              padding: var(--space-5);
              display: grid;
              gap: var(--space-2);
              position: relative;
              overflow: hidden;
            }

            #yellow-dashboard-root .kpi-card::before,
            #yellow-dashboard-root .metric-card::before {
              content: "";
              position: absolute;
              inset-inline: var(--space-4);
              inset-block-start: 0;
              height: 4px;
              border-radius: 999px;
              background: linear-gradient(90deg, var(--yolk-500), rgba(255, 214, 41, 0.1));
            }

            #yellow-dashboard-root .metric-label {
              color: var(--text-muted);
              font-size: 0.9rem;
              font-weight: 600;
            }

            #yellow-dashboard-root .metric-value {
              color: var(--navy-950);
              font-size: clamp(1.65rem, 2.6vw, 2.5rem);
              font-weight: 800;
            }

            #yellow-dashboard-root .metric-detail {
              color: var(--text-muted);
              font-size: 0.92rem;
            }

            #yellow-dashboard-root .analysis-card,
            #yellow-dashboard-root .comparison-card,
            #yellow-dashboard-root .comparison-list {
              padding: var(--space-5);
              display: grid;
              gap: var(--space-3);
              background: rgba(255, 255, 255, 0.98);
            }

            #yellow-dashboard-root .analysis-card ul,
            #yellow-dashboard-root .comparison-list ul {
              margin: 0;
              padding: 0;
              list-style: none;
              display: grid;
              gap: var(--space-2);
            }

            #yellow-dashboard-root .analysis-card li,
            #yellow-dashboard-root .comparison-list li {
              padding: var(--space-3);
              border-radius: var(--radius-md);
              background: rgba(17, 29, 74, 0.05);
              color: var(--graphite);
            }

            #yellow-dashboard-root .analysis-card.quality li,
            #yellow-dashboard-root .comparison-list.critical li {
              border-inline-start: 4px solid var(--yolk-500);
              background: rgba(255, 214, 41, 0.16);
            }

            #yellow-dashboard-root .comparison-delta {
              display: inline-flex;
              align-items: center;
              padding: 0.38rem 0.7rem;
              border-radius: 999px;
              background: rgba(17, 29, 74, 0.07);
              color: var(--navy-950);
              font-weight: 700;
            }

            #yellow-dashboard-root .comparison-delta.is-up {
              background: rgba(255, 214, 41, 0.22);
            }

            #yellow-dashboard-root .comparison-delta.is-down {
              background: rgba(9, 11, 16, 0.08);
            }

            #yellow-dashboard-root .signal-grid,
            #yellow-dashboard-root .segment-grid,
            #yellow-dashboard-root .comparison-metric-grid,
            #yellow-dashboard-root .comparison-lists {
              display: grid;
              gap: var(--space-4);
              grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            }

            #yellow-dashboard-root .bucket-row,
            #yellow-dashboard-root .bucket-item,
            #yellow-dashboard-root .winner-list {
              display: grid;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .bucket-bar,
            #yellow-dashboard-root .progress-track {
              height: 10px;
              border-radius: 999px;
              background: rgba(17, 29, 74, 0.08);
              overflow: hidden;
            }

            #yellow-dashboard-root .bucket-fill,
            #yellow-dashboard-root .progress-fill {
              height: 100%;
              border-radius: inherit;
              background: linear-gradient(90deg, var(--yolk-500), var(--navy-800));
            }

            #yellow-dashboard-root .chart-frame {
              position: relative;
            }

            #yellow-dashboard-root .chart-card,
            #yellow-dashboard-root .chart-panel {
              padding: var(--space-5);
            }

            #yellow-dashboard-root .chart-card {
              display: grid;
              gap: var(--space-4);
              background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 247, 250, 0.94)),
                var(--white);
              border: 1px solid rgba(17, 29, 74, 0.08);
              box-shadow:
                0 20px 42px rgba(11, 20, 53, 0.08),
                inset 0 1px 0 rgba(255, 255, 255, 0.74);
            }

            #yellow-dashboard-root .chart-surface {
              width: 100%;
              min-height: 320px;
              overflow-x: auto;
              overflow-y: hidden;
              border-radius: var(--radius-lg);
              border: 1px solid rgba(17, 29, 74, 0.08);
              background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(238, 240, 245, 0.92)),
                var(--white);
              padding: var(--space-4);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
            }

            #yellow-dashboard-root .chart-surface--wide {
              min-height: 520px;
            }

            #yellow-dashboard-root .chart-surface > svg {
              min-width: 100%;
            }

            #yellow-dashboard-root .metric-toolbar {
              justify-content: flex-end;
            }

            #yellow-dashboard-root .chart-header-copy {
              display: grid;
              gap: 0.45rem;
            }

            #yellow-dashboard-root .chart-overline {
              display: inline-flex;
              align-items: center;
              gap: 0.45rem;
              color: var(--navy-700);
              font-size: 0.8rem;
              font-weight: 700;
              letter-spacing: 0.03em;
            }

            #yellow-dashboard-root .chart-overline::before {
              content: "";
              inline-size: 0.7rem;
              block-size: 0.7rem;
              border-radius: 999px;
              background: var(--yolk-500);
              box-shadow: 0 0 0 4px rgba(255, 214, 41, 0.2);
            }

            #yellow-dashboard-root .chart-insights {
              display: flex;
              align-items: center;
              gap: var(--space-3);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .insight-chip {
              display: inline-flex;
              align-items: center;
              gap: 0.45rem;
              min-height: 2rem;
              padding: 0.45rem 0.8rem;
              border-radius: 999px;
              border: 1px solid rgba(17, 29, 74, 0.1);
              background: rgba(17, 29, 74, 0.04);
              color: var(--navy-900);
              font-size: 0.84rem;
              font-weight: 600;
              line-height: 1.2;
            }

            #yellow-dashboard-root .insight-chip strong {
              color: var(--navy-950);
              font-weight: 800;
            }

            #yellow-dashboard-root .insight-chip--accent {
              background: rgba(255, 214, 41, 0.22);
              border-color: rgba(244, 201, 0, 0.42);
            }

            #yellow-dashboard-root .insight-chip--dark {
              background: rgba(17, 29, 74, 0.94);
              border-color: rgba(17, 29, 74, 0.94);
              color: rgba(255, 255, 255, 0.92);
            }

            #yellow-dashboard-root .insight-chip--dark strong {
              color: var(--yolk-500);
            }

            #yellow-dashboard-root .chart-footnote {
              color: var(--text-muted);
              font-size: 0.82rem;
            }

            #yellow-dashboard-root .metric-toggle {
              border: 1px solid rgba(17, 29, 74, 0.14);
              border-radius: 999px;
              padding: 0.6rem 0.9rem;
              background: rgba(17, 29, 74, 0.04);
              color: var(--navy-900);
              font: inherit;
              font-weight: 700;
              cursor: pointer;
              transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease;
            }

            #yellow-dashboard-root .metric-toggle.is-active {
              background: var(--navy-950);
              color: var(--yolk-500);
              border-color: var(--navy-950);
            }

            #yellow-dashboard-root .visually-hidden-select {
              position: absolute;
              inline-size: 1px;
              block-size: 1px;
              overflow: hidden;
              clip-path: inset(50%);
              white-space: nowrap;
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
              inset-block-start: 0;
              transform: translate(-9999px, -9999px);
              visibility: hidden;
              pointer-events: none;
              max-width: 18rem;
              padding: 0.75rem 0.85rem;
              border: 1px solid rgba(17, 29, 74, 0.14);
              border-radius: var(--radius-md);
              background: rgba(255, 255, 255, 0.98);
              color: var(--graphite);
              box-shadow: 0 18px 36px rgba(11, 20, 53, 0.16);
              z-index: 12;
            }

            #yellow-dashboard-root .tooltip.is-visible {
              visibility: visible;
            }

            #yellow-dashboard-root .matrix-label {
              cursor: pointer;
              fill: var(--navy-900);
              font-weight: 700;
            }

            #yellow-dashboard-root .matrix-label.is-active {
              fill: var(--navy-700);
            }

            #yellow-dashboard-root .clickable-cell {
              cursor: pointer;
            }

            #yellow-dashboard-root .legend-item {
              display: inline-flex;
              align-items: center;
              gap: var(--space-2);
            }

            #yellow-dashboard-root .legend-swatch {
              width: 14px;
              height: 14px;
              border-radius: 4px;
              display: inline-block;
            }

            #yellow-dashboard-root .podium-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: var(--space-4);
              align-items: end;
            }

            #yellow-dashboard-root .tier-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
              gap: var(--space-4);
            }

            #yellow-dashboard-root .prize-card {
              overflow: hidden;
              display: grid;
              gap: 0;
            }

            #yellow-dashboard-root .prize-visual {
              min-height: 132px;
              padding: var(--space-4);
              background: linear-gradient(165deg, rgba(17, 29, 74, 0.96), rgba(36, 55, 124, 0.96) 58%, rgba(255, 214, 41, 0.94));
            }

            #yellow-dashboard-root .place-card--1 {
              order: 2;
              transform: translateY(-18px);
            }

            #yellow-dashboard-root .place-card--2 {
              order: 1;
            }

            #yellow-dashboard-root .place-card--3 {
              order: 3;
            }

            #yellow-dashboard-root .place-card--1 .prize-visual {
              min-height: 164px;
            }

            #yellow-dashboard-root .place-card--2 .prize-visual,
            #yellow-dashboard-root .place-card--3 .prize-visual {
              min-height: 142px;
            }

            #yellow-dashboard-root .podium-mark,
            #yellow-dashboard-root .tier-mark {
              width: 100%;
              height: 100%;
              display: grid;
              place-items: center;
            }

            #yellow-dashboard-root .prize-content {
              padding: var(--space-5);
              display: grid;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .prize-title {
              font-size: 1.12rem;
              font-weight: 700;
              color: var(--navy-950);
            }

            #yellow-dashboard-root .prize-pill {
              background: rgba(255, 214, 41, 0.18);
              color: var(--navy-950);
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .winner-item {
              display: grid;
              grid-template-columns: auto 1fr auto;
              gap: var(--space-3);
              align-items: center;
              padding: var(--space-3) var(--space-4);
              border-radius: var(--radius-md);
              background: rgba(17, 29, 74, 0.05);
              border: 1px solid transparent;
            }

            #yellow-dashboard-root .winner-item.is-focus {
              background: rgba(255, 214, 41, 0.18);
              border-color: rgba(17, 29, 74, 0.14);
            }

            #yellow-dashboard-root .winner-rank {
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: grid;
              place-items: center;
              background: var(--navy-950);
              color: var(--yolk-500);
              font-size: 0.94rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .winner-name {
              color: var(--navy-950);
              font-weight: 700;
            }

            #yellow-dashboard-root .winner-amount {
              color: var(--graphite);
              white-space: nowrap;
              font-weight: 700;
            }

            #yellow-dashboard-root .prize-meta {
              display: flex;
              gap: var(--space-3);
              flex-wrap: wrap;
              color: var(--text-muted);
              font-size: 0.92rem;
            }

            #yellow-dashboard-root .table-wrap {
              overflow: auto;
              border-radius: var(--radius-lg);
              border: 1px solid rgba(17, 29, 74, 0.12);
              background: rgba(255, 255, 255, 0.98);
              max-inline-size: 100%;
            }

            #yellow-dashboard-root .table-panel[hidden] {
              display: none;
            }

            #yellow-dashboard-root table {
              width: 100%;
              min-width: 760px;
              border-collapse: collapse;
            }

            #yellow-dashboard-root th,
            #yellow-dashboard-root td {
              padding: 0.92rem 0.82rem;
              text-align: right;
              vertical-align: top;
              border-bottom: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root thead th {
              position: sticky;
              top: 0;
              z-index: 2;
              background: rgba(17, 29, 74, 0.04);
              color: var(--navy-950);
              font-weight: 700;
            }

            #yellow-dashboard-root tbody tr:nth-child(even) {
              background: rgba(246, 247, 250, 0.9);
            }

            #yellow-dashboard-root tbody tr:hover {
              background: rgba(255, 214, 41, 0.12);
            }

            #yellow-dashboard-root .amount-cell {
              color: var(--navy-950);
              font-weight: 700;
              white-space: nowrap;
            }

            #yellow-dashboard-root .status-badge {
              display: inline-flex;
              align-items: center;
              padding: 0.3rem 0.62rem;
              border-radius: 999px;
              background: rgba(17, 29, 74, 0.09);
              color: var(--navy-950);
              font-size: 0.88rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .status-badge.failed {
              background: rgba(9, 11, 16, 0.08);
              color: var(--black);
            }

            #yellow-dashboard-root .empty-state {
              padding: var(--space-5);
              border-radius: var(--radius-lg);
              border: 1px dashed rgba(17, 29, 74, 0.18);
              background: rgba(246, 247, 250, 0.88);
              color: var(--text-muted);
            }

            #yellow-dashboard-root .legal-hero {
              padding: var(--space-6);
            }

            #yellow-dashboard-root .legal-hero h2 {
              margin: 0 0 var(--space-3);
              color: var(--navy-950);
              font-size: 2rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .legal-hero p {
              margin: 0;
              color: var(--text-muted);
              line-height: 1.8;
              max-width: 60rem;
            }

            #yellow-dashboard-root .legal-layout {
              grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
              align-items: start;
            }

            #yellow-dashboard-root .legal-sidebar,
            #yellow-dashboard-root .legal-document {
              padding: var(--space-6);
            }

            #yellow-dashboard-root .legal-sidebar {
              position: sticky;
              top: 112px;
              display: grid;
              gap: var(--space-4);
            }

            #yellow-dashboard-root .legal-sidebar nav {
              display: grid;
              gap: var(--space-2);
            }

            #yellow-dashboard-root .legal-sidebar a {
              color: var(--navy-900);
              text-decoration: none;
              padding: 0.52rem 0.7rem;
              border-radius: var(--radius-md);
              background: rgba(17, 29, 74, 0.04);
              font-weight: 600;
            }

            #yellow-dashboard-root .legal-document {
              max-width: 900px;
              justify-self: center;
              width: 100%;
              display: grid;
              gap: var(--space-6);
            }

            #yellow-dashboard-root .legal-document section {
              display: grid;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .legal-document h3 {
              font-size: 1.28rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .legal-document h4 {
              font-size: 1.02rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .legal-document p,
            #yellow-dashboard-root .legal-document li {
              margin: 0;
              line-height: 1.9;
              color: var(--graphite);
            }

            #yellow-dashboard-root .legal-document ol,
            #yellow-dashboard-root .legal-document ul {
              margin: 0;
              padding-inline-start: 1.35rem;
              display: grid;
              gap: var(--space-2);
            }

            #yellow-dashboard-root .admin-lock {
              padding: var(--space-4);
            }

            #yellow-dashboard-root .login-shell {
              grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
            }

            #yellow-dashboard-root .login-visual {
              padding: var(--space-6);
              border-radius: var(--radius-xl);
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .login-logo-frame {
              min-height: 96px;
            }

            #yellow-dashboard-root .login-card {
              display: grid;
              gap: var(--space-4);
              align-content: center;
              padding: var(--space-6);
            }

            #yellow-dashboard-root .login-card h2 {
              font-size: 1.75rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .password-field {
              position: relative;
            }

            #yellow-dashboard-root .password-field .form-control {
              padding-inline-end: 5.5rem;
            }

            #yellow-dashboard-root .password-toggle {
              position: absolute;
              inset-inline-end: var(--space-2);
              inset-block-end: var(--space-2);
              min-height: 38px;
              padding: 0.45rem 0.8rem;
            }

            #yellow-dashboard-root .login-message {
              min-height: 1.4rem;
              padding: 0.75rem 0.9rem;
              border-radius: var(--radius-md);
              border-inline-start: 4px solid transparent;
            }

            #yellow-dashboard-root .login-message.is-error {
              color: var(--navy-950);
              background: rgba(255, 214, 41, 0.16);
              border-inline-start-color: var(--black);
            }

            #yellow-dashboard-root .login-message.is-success {
              color: var(--navy-950);
              background: rgba(17, 29, 74, 0.08);
              border-inline-start-color: var(--yolk-500);
            }

            #yellow-dashboard-root .login-message.is-warning {
              color: var(--navy-950);
              background: rgba(255, 214, 41, 0.12);
              border-inline-start-color: var(--yolk-500);
            }

            #yellow-dashboard-root .public-panel-header {
              display: flex;
              align-items: baseline;
              justify-content: space-between;
              gap: var(--space-4);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .public-panel-header h3 {
              margin: 0;
              color: var(--navy-950);
              font-size: 1.38rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .manager-entry-card {
              display: grid;
              grid-template-columns: minmax(0, 1.4fr) auto;
              gap: var(--space-4);
              align-items: center;
            }

            #yellow-dashboard-root .manager-entry-card {
              display: none !important;
            }

            #yellow-dashboard-root .manager-entry-copy h3 {
              margin: 0 0 var(--space-2);
              color: var(--navy-950);
              font-size: 1.15rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .manager-entry-copy p {
              margin: 0;
              color: var(--graphite);
              line-height: 1.75;
            }

            #yellow-dashboard-root .manager-entry-actions {
              display: flex;
              justify-content: flex-end;
              align-items: center;
              gap: var(--space-3);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .manager-entry-note {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-height: 48px;
              padding: 0 var(--space-4);
              border-radius: 999px;
              background: rgba(17, 29, 74, 0.06);
              color: var(--navy-900);
              font-size: 0.94rem;
              font-weight: 700;
              white-space: nowrap;
            }

            #yellow-dashboard-root .action-button:hover,
            #yellow-dashboard-root .button-primary:hover {
              background: var(--yolk-600);
              transform: translateY(-1px);
            }

            #yellow-dashboard-root .button-secondary:hover,
            #yellow-dashboard-root .action-button.secondary:hover {
              background: var(--navy-900);
            }

            #yellow-dashboard-root .button-ghost:hover,
            #yellow-dashboard-root .nav-button:hover {
              background: rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .app-card:hover,
            #yellow-dashboard-root .metric-card:hover,
            #yellow-dashboard-root .analysis-card:hover,
            #yellow-dashboard-root .comparison-card:hover,
            #yellow-dashboard-root .prize-card:hover {
              box-shadow: 0 18px 36px rgba(11, 20, 53, 0.11);
            }

            @media (max-width: 1440px) {
              #yellow-dashboard-root .metric-grid {
                grid-template-columns: repeat(4, minmax(0, 1fr));
              }

              #yellow-dashboard-root .hero-meta-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }
            }

            @media (max-width: 1200px) {
              #yellow-dashboard-root .admin-overview-grid,
              #yellow-dashboard-root .login-shell,
              #yellow-dashboard-root .public-hero-grid,
              #yellow-dashboard-root .legal-layout,
              #yellow-dashboard-root .manager-entry-card {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .metric-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              #yellow-dashboard-root .public-snapshot-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              #yellow-dashboard-root .public-snapshot-card--wide {
                grid-column: span 2;
              }

              #yellow-dashboard-root .public-hero-brand,
              #yellow-dashboard-root .brand-command-logos {
                justify-items: start;
                justify-content: flex-start;
              }

              #yellow-dashboard-root .legal-sidebar {
                position: static;
              }
            }

            @media (max-width: 1024px) {
              #yellow-dashboard-root {
                padding: var(--space-3);
              }

              #yellow-dashboard-root .public-hero-watermark {
                width: 180px;
                inset-inline-start: var(--space-4);
                opacity: 0.28;
              }

              #yellow-dashboard-root .filters-grid,
              #yellow-dashboard-root .filters-grid.filters-grid--three {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              #yellow-dashboard-root .podium-grid {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .place-card--1 {
                transform: none;
              }
            }

            @media (max-width: 768px) {
              #yellow-dashboard-root::before {
                opacity: 0.018;
                background-size: 112px 112px, 96px 96px;
              }

              #yellow-dashboard-root .app-topbar {
                padding: var(--space-4);
                gap: var(--space-4);
              }

              #yellow-dashboard-root .topbar-brand,
              #yellow-dashboard-root .topbar-actions,
              #yellow-dashboard-root .session-box,
              #yellow-dashboard-root .section-header,
              #yellow-dashboard-root .section-head,
              #yellow-dashboard-root .brand-command-head,
              #yellow-dashboard-root .control-group-header {
                align-items: stretch;
              }

              #yellow-dashboard-root .topbar-actions,
              #yellow-dashboard-root .session-box {
                width: 100%;
                justify-content: flex-start;
              }

              #yellow-dashboard-root .topbar-brand,
              #yellow-dashboard-root .topbar-meta,
              #yellow-dashboard-root .brand-logo-cluster {
                width: 100%;
              }

              #yellow-dashboard-root .manager-entry-actions {
                justify-content: flex-start;
              }

              #yellow-dashboard-root .brand-logo-cluster {
                justify-content: flex-end;
                gap: var(--space-3);
              }

              #yellow-dashboard-root .topbar-meta {
                gap: var(--space-2);
              }

              #yellow-dashboard-root .session-chip,
              #yellow-dashboard-root .hero-badge {
                white-space: normal;
              }

              #yellow-dashboard-root .top-nav {
                width: 100%;
                overflow-x: auto;
                padding-block-end: 2px;
              }

              #yellow-dashboard-root .nav-button {
                flex: 0 0 auto;
              }

              #yellow-dashboard-root .hero-meta-grid,
              #yellow-dashboard-root .metric-grid,
              #yellow-dashboard-root .public-snapshot-grid,
              #yellow-dashboard-root .filters-grid,
              #yellow-dashboard-root .filters-grid.filters-grid--three {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .public-snapshot-card--wide {
                grid-column: span 1;
              }

              #yellow-dashboard-root .public-hero,
              #yellow-dashboard-root .legal-hero,
              #yellow-dashboard-root .brand-command,
              #yellow-dashboard-root .control-panel,
              #yellow-dashboard-root .page-panel,
              #yellow-dashboard-root .login-card,
              #yellow-dashboard-root .login-visual,
              #yellow-dashboard-root .legal-sidebar,
              #yellow-dashboard-root .legal-document {
                padding: var(--space-5);
              }

              #yellow-dashboard-root .public-hero-watermark {
                display: none;
              }
            }

            @media (max-width: 390px) {
              #yellow-dashboard-root .topbar-campaign-logo {
                max-width: 118px;
                height: 42px;
              }

              #yellow-dashboard-root .topbar-logo {
                max-width: 102px;
                height: 46px;
                transform: scale(1.38);
              }

              #yellow-dashboard-root .brand-divider {
                block-size: 40px;
              }

              #yellow-dashboard-root .topbar-title {
                font-size: 1rem;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              #yellow-dashboard-root .page-shell,
              #yellow-dashboard-root .action-button,
              #yellow-dashboard-root .button-primary,
              #yellow-dashboard-root .button-secondary,
              #yellow-dashboard-root .button-ghost,
              #yellow-dashboard-root .metric-toggle,
              #yellow-dashboard-root .nav-button,
              #yellow-dashboard-root .app-card {
                animation: none !important;
                transition: none !important;
              }
            }
          </style>

          <div class="app-shell">
            <header class="app-topbar brand-header">
              <div class="topbar-actions">
                <nav class="top-nav" aria-label="ניווט עמודים">
                  <button class="nav-button" type="button" data-page-target="prizes">פרסים ותחרות</button>
                  <button class="nav-button" type="button" data-page-target="rules">תקנון השתתפות</button>
                  <button class="nav-button" type="button" data-page-target="privacy">פרטיות</button>
                  <button class="nav-button" type="button" data-page-target="admin">דשבורד ניהולי</button>
                </nav>
                <div class="session-box">
                  <div id="session-status" class="session-chip" aria-live="polite">מצב ניהול: אורח/ת</div>
                  <button id="go-admin-login" class="button-secondary action-button secondary" type="button" data-admin-login data-legacy-id="public-admin-login">כניסת מנהלים</button>
                  <button id="logout-button" class="button-ghost" type="button" hidden>התנתקות</button>
                </div>
              </div>
              <div class="topbar-brand">
                <div class="brand-logo-cluster">
                  <img id="topbar-campaign-logo" class="topbar-campaign-logo" alt="לוגו עושים טוב בצהוב" />
                  <span class="brand-divider" aria-hidden="true"></span>
                  <img id="topbar-logo" class="topbar-logo" alt="לוגו אחים לסמל" />
                </div>
                <div class="topbar-meta">
                  <div class="topbar-title">מערכת ניהול קמפיין</div>
                  <div class="topbar-subtitle">עושים טוב בצהוב · אחים לסמל · בקרה, תחרות ותובנות מנהלים</div>
                </div>
              </div>
            </header>

            <main class="app-content">
              <section id="page-prizes" class="page-shell is-active">
                <article class="public-hero app-card--dark">
                  <div class="public-hero-watermark" aria-hidden="true">
                    <img id="public-org-logo" alt="לוגו אחים לסמל" />
                  </div>
                  <div class="public-hero-grid">
                    <div class="public-hero-copy">
                      <span class="brand-kicker">תמונת מצב מיידית של הפרויקט</span>
                      <h1 class="public-hero-title">מצב הקמפיין ברגע זה</h1>
                      <p>כל מה שחשוב להבין בשנייה הראשונה: כמה גויס, מי מוביל, כמה שגרירים פעילים ומהו חלון הנתונים הפעיל כרגע.</p>
                      <div id="public-hero-badges" class="public-badges" aria-live="polite"></div>
                    </div>
                  </div>
                </article>

                <section class="page-panel app-card app-card--elevated">
                  <div class="public-panel-header">
                    <h3>פודיום, מדרגות פרס וזוכים חיים</h3>
                    <div id="prize-summary" class="text-small text-muted"></div>
                  </div>
                  <div id="prize-board" class="prize-shell"></div>
                </section>
              </section>

              <section id="page-rules" class="page-shell">
                <article class="legal-hero app-card app-card--elevated">
                  <h2>תקנון השתתפות</h2>
                  <p>עמוד זה מרכז את נוסח העבודה הנוכחי עבור השתתפות, פרסים, זכאות, הכרעות ועדכונים. לפני פרסום חיצוני יש לאשר את הנוסח הסופי מול הייעוץ המשפטי של הארגון.</p>
                </article>
                <div class="legal-layout">
                  <aside class="legal-sidebar app-card">
                    <div class="section-header">
                      <h3>תוכן עניינים</h3>
                    </div>
                    <nav aria-label="תוכן עניינים - תקנון">
                      <a href="#rules-section-1">1. זכאות להשתתפות</a>
                      <a href="#rules-section-2">2. רישום ונתונים</a>
                      <a href="#rules-section-3">3. חישוב תוצאות וזכייה</a>
                      <a href="#rules-section-4">4. שוויון, תיקונים וחריגים</a>
                      <a href="#rules-section-5">5. עדכונים ואישור משפטי</a>
                    </nav>
                  </aside>
                  <article class="legal-document app-card legal-layout__content">
                    <div class="status-note text-small">הערה: זהו נוסח עבודה המצורף למערכת ודורש אישור משפטי לפני עלייה לאוויר.</div>
                    <section id="rules-section-1">
                      <h3>1. זכאות להשתתפות</h3>
                      <p>השתתפות בתחרות ובמסלולי הפרסים כפופה לרישום כשגריר או שגרירה במערכת ולפעילות במהלך ימי הקמפיין כפי שהוגדרו על ידי הנהלת הקמפיין.</p>
                      <ol>
                        <li>הארגון רשאי להגדיר תנאי סף, שיוך לקבוצות או החרגת משתמשים שאינם עומדים בכללי הפעילות.</li>
                        <li>רק עסקאות שנקלטו במערכת באופן תקין ושויכו בהתאם לכללי הקמפיין ייחשבו לצורך התחרות.</li>
                        <li>השתתפות פעילה כפופה לנתוני הקלט שמוזנים למערכת ולבדיקות הבקרה של הנהלת הקמפיין.</li>
                      </ol>
                    </section>
                    <section id="rules-section-2">
                      <h3>2. רישום ונתונים</h3>
                      <p>המערכת מבוססת על קובצי המקור שהועלו על ידי מנהלי הקמפיין ולכן מציגה תמונת מצב עדכנית בהתאם לנתונים שנקלטו באותו רגע.</p>
                      <ol>
                        <li>שדות כמו שם שגריר, שם תורם, תאריך, שעה, סכום וסטטוס עסקה משפיעים על החישובים והדירוגים.</li>
                        <li>הארגון רשאי לבצע טיוב נתונים, איחוד כפילויות, השלמת שיוך או נטרול עסקאות לא תקינות.</li>
                      </ol>
                    </section>
                    <section id="rules-section-3">
                      <h3>3. חישוב תוצאות וזכייה</h3>
                      <p>הדירוגים והזכאות לפרסים נקבעים לפי טבלת הפרסים ומדרגות הפרס המעודכנות במערכת.</p>
                      <ol>
                        <li>הנהלת הקמפיין רשאית לקבוע אם הזכאות מבוססת על סכום גיוס, מספר עסקאות או שילוב של שניהם.</li>
                        <li>עסקאות שבוטלו, נכשלו, הוחזרו או סומנו כלא תקינות עשויות שלא להיכלל בחישוב הסופי.</li>
                        <li>במקרה של פערי מידע, הכרעת הנהלת הקמפיין היא הקובעת.</li>
                      </ol>
                    </section>
                    <section id="rules-section-4">
                      <h3>4. שוויון, תיקונים וחריגים</h3>
                      <p>ייתכנו מצבים של שוויון, כפילויות, השהיית עסקאות או תיקוני נתונים במהלך הקמפיין.</p>
                      <ol>
                        <li>במקרה של שוויון, הארגון רשאי להפעיל כללי הכרעה משלימים.</li>
                        <li>הארגון רשאי לבצע בדיקה חוזרת של עסקאות חריגות או רשומות חסרות לפני הכרזה על זכייה.</li>
                        <li>עדכוני נתונים עשויים להשפיע על הדירוג והמדרגות המוצגות במערכת.</li>
                      </ol>
                    </section>
                    <section id="rules-section-5">
                      <h3>5. עדכונים ואישור משפטי</h3>
                      <p>הארגון שומר לעצמו את הזכות לעדכן את התקנון, את מדרגות הפרסים או את מנגנון החישוב, בכפוף לדין ולהודעה מתאימה.</p>
                      <ol>
                        <li>תאריך עדכון נוכחי: טיוטת מערכת ליום 28.07.2026.</li>
                        <li>לפני פרסום חיצוני יש לאשר את הנוסח הסופי מול הייעוץ המשפטי של הארגון.</li>
                      </ol>
                    </section>
                  </article>
                </div>
              </section>

              <section id="page-privacy" class="page-shell">
                <article class="legal-hero app-card app-card--elevated">
                  <h2>מדיניות פרטיות</h2>
                  <p>עמוד זה מציג את מבנה הפרטיות והמידע עבור גרסת הפיילוט של המערכת, בלי להוסיף התחייבויות משפטיות חדשות מעבר לנוסח שכבר הוגדר.</p>
                </article>
                <div class="legal-layout">
                  <aside class="legal-sidebar app-card">
                    <div class="section-header">
                      <h3>תוכן עניינים</h3>
                    </div>
                    <nav aria-label="תוכן עניינים - פרטיות">
                      <a href="#privacy-section-1">1. מידע שנאסף</a>
                      <a href="#privacy-section-2">2. מטרות השימוש</a>
                      <a href="#privacy-section-3">3. הרשאות וגישה</a>
                      <a href="#privacy-section-4">4. שמירת מידע</a>
                      <a href="#privacy-section-5">5. אבטחת מידע</a>
                      <a href="#privacy-section-6">6. זכויות המשתמשים</a>
                      <a href="#privacy-section-7">7. יצירת קשר</a>
                      <a href="#privacy-section-8">8. תאריך עדכון</a>
                    </nav>
                  </aside>
                  <article class="legal-document app-card legal-layout__content">
                    <div class="status-note text-small">הערה: לפני פרסום ציבורי יש לאמת את מדיניות הפרטיות עם אבטחת מידע והייעוץ המשפטי.</div>
                    <section id="privacy-section-1">
                      <h3>1. מידע שנאסף</h3>
                      <p>המערכת עשויה לקלוט נתוני תרומה ותפעול לצורך בקרה ודשבורד, לרבות שם תורם, כתובת דוא״ל, סכום, זמן ביצוע, שיוך לשגריר וסטטוס עסקה.</p>
                    </section>
                    <section id="privacy-section-2">
                      <h3>2. מטרות השימוש</h3>
                      <ul>
                        <li>הצגת נתונים ניהוליים בזמן אמת.</li>
                        <li>זיהוי מגמות גיוס, זוכים, שגרירים מובילים, תקלות וחריגות.</li>
                        <li>השוואות בין קבצים, בין תקופות ובין מחזורי קמפיין שונים.</li>
                      </ul>
                    </section>
                    <section id="privacy-section-3">
                      <h3>3. הרשאות וגישה</h3>
                      <ul>
                        <li>עמודי התקנון, הפרטיות והפרסים זמינים גם למשתתפים וגם למנהלים.</li>
                        <li>הדשבורד הניהולי זמין למשתמשים מורשים לפי מייל שהוגדר מראש ובאמצעות סיסמה.</li>
                        <li>לפני עלייה לאוויר יש להעביר את מנגנון הזיהוי לאימות שרת אמיתי.</li>
                      </ul>
                    </section>
                    <section id="privacy-section-4">
                      <h3>4. שמירת מידע</h3>
                      <p>בגרסת הפיילוט המערכת עובדת מקומית ולכן מצמצמת חשיפה, אך עדיין יש לנהוג בזהירות בקובצי המקור ובהרשאות הגישה אליהם.</p>
                    </section>
                    <section id="privacy-section-5">
                      <h3>5. אבטחת מידע</h3>
                      <ul>
                        <li>מומלץ להגדיר מדיניות שמירה, מחיקה, גיבוי והרשאות צפייה לפי תפקיד.</li>
                        <li>בעתיד יש להוסיף שכבת Backend, ניהול משתמשים ורישום פעולות לצורכי בקרה.</li>
                      </ul>
                    </section>
                    <section id="privacy-section-6">
                      <h3>6. זכויות המשתמשים</h3>
                      <p>כל בקשה לעדכון, מחיקה, תיקון או בירור נתונים צריכה להתבצע לפי נהלי הארגון והדין החל.</p>
                    </section>
                    <section id="privacy-section-7">
                      <h3>7. יצירת קשר</h3>
                      <p>לצורכי בקרה, פרטיות או אבטחת מידע יש לפנות לארגון המנהל את הקמפיין ולגורמים המורשים מטעמו.</p>
                    </section>
                    <section id="privacy-section-8">
                      <h3>8. תאריך עדכון</h3>
                      <p>טיוטת מערכת ליום 28.07.2026. לפני שימוש חיצוני יש להשלים אישור סופי.</p>
                    </section>
                  </article>
                </div>
              </section>

              <section id="page-admin" class="page-shell">
                <section id="admin-lock" class="admin-lock app-card app-card--elevated">
                  <div class="login-shell">
                    <div class="login-visual app-card--dark">
                      <div class="login-brand-row">
                        <div class="login-copy">
                          <span class="brand-kicker">גישה למנהלים מורשים בלבד</span>
                          <h2>כניסה למערכת הניהול</h2>
                          <p>מסך הכניסה מספק גישה לפאנל הניהול, לבקרה על קבצי המקור, לפילוחים המתקדמים, להשוואות הקבצים ולכל שכבת האנליטיקה של הקמפיין.</p>
                        </div>
                        <div class="login-logos">
                          <div class="login-logo-frame">
                            <img id="login-campaign-logo" alt="לוגו עושים טוב בצהוב" />
                          </div>
                          <div class="login-logo-frame">
                            <img id="login-org-logo" alt="לוגו אחים לסמל" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <form id="login-form" class="login-card app-card">
                      <div class="section-header">
                        <div>
                          <h2>כניסה למערכת הניהול</h2>
                          <div class="text-small text-muted">כניסה באמצעות מייל מורשה מראש. בכניסה הראשונה תתבקשו להגדיר סיסמה אישית.</div>
                        </div>
                      </div>
                      <label class="form-label">
                        מייל מנהל/ת
                        <input id="login-email" class="form-control" type="email" autocomplete="username" placeholder="name@example.org" />
                      </label>
                      <label class="form-label">
                        סיסמה
                        <div class="password-field">
                          <input id="login-password" class="form-control" type="password" autocomplete="current-password" placeholder="הקלד/י סיסמה" />
                          <button id="login-password-toggle" class="button-ghost password-toggle" type="button" aria-label="הצג או הסתר סיסמה">הצג</button>
                        </div>
                      </label>
                      <label id="login-password-confirm-label" class="form-label" hidden>
                        אימות סיסמה
                        <input id="login-password-confirm" class="form-control" type="password" autocomplete="new-password" placeholder="הקלד/י שוב את הסיסמה" />
                      </label>
                      <button id="login-button" class="button-primary action-button" type="submit">כניסה לפאנל הניהול</button>
                      <div id="login-mode-hint" class="text-small text-muted">הכניסה נשמרת ב-session מקומי מאובטח בשרת. בפריסה ציבורית יש להפעיל HTTPS וניהול secrets מסודר.</div>
                      <div id="login-message" class="login-message text-small" aria-live="polite"></div>
                    </form>
                  </div>
                </section>

                <div id="admin-content" class="admin-content" hidden>
                  <div class="dashboard-shell">
                    <section class="admin-overview-grid">
                      <article class="brand-command app-card app-card--dark">
                        <div class="brand-command-head">
                          <div class="brand-copy">
                            <span class="brand-kicker">Executive campaign operations</span>
                            <h1 class="hero-title">מרכז השליטה של עושים טוב בצהוב</h1>
                            <p class="hero-subtitle">מסך ניהולי מרוכז לפילוח לפי תאריך, שעה, טווח שעות, יום פרויקט, שגריר/ה, תורם/ת וסכום, כולל השוואת קבצים, יעדים, גרפים, טבלאות וייצוא.</p>
                          </div>
                          <div class="brand-command-logos">
                            <div class="logo-wrap logo-wrap--campaign">
                              <img id="brand-logo" alt="לוגו עושים טוב בצהוב" />
                            </div>
                            <div class="logo-wrap logo-wrap--organization">
                              <img id="brand-org-logo" alt="לוגו אחים לסמל" />
                            </div>
                          </div>
                        </div>
                        <div class="hero-meta-grid" aria-label="נתוני כותרת">
                          <div class="hero-meta">
                            <span>טווח נתונים פעיל</span>
                            <strong id="admin-window-label">-</strong>
                          </div>
                          <div class="hero-meta">
                            <span>עדכון אחרון</span>
                            <strong id="admin-last-updated">-</strong>
                          </div>
                          <div class="hero-meta">
                            <span>קובץ מקור</span>
                            <strong id="admin-source-file">-</strong>
                          </div>
                          <div class="hero-meta">
                            <span>רשומות פעילות</span>
                            <strong id="admin-record-count">-</strong>
                          </div>
                        </div>
                        <div id="hero-badges" class="hero-badges" aria-live="polite"></div>
                      </article>

                      <aside class="control-panel app-card app-card--elevated">
                        <div class="section-header">
                          <div>
                            <h3>Control Center</h3>
                            <div class="text-small text-muted">מרכז שליטה לקבצים, למסננים וליעדים. כל היכולות הקיימות נשמרות, רק מוצגות בצורה מדויקת ונוחה יותר.</div>
                          </div>
                        </div>
                        <div class="control-groups">
                          <section class="control-group">
                            <div class="control-group-header">
                              <h4>נתונים</h4>
                              <p>קבצי הבסיס, ההשוואה והפרסים</p>
                            </div>
                            <div class="filters-grid filters-grid--three">
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
                            </div>
                            <div id="import-status" class="status-note text-small" aria-live="polite">המערכת מוכנה לקבלת קבצים. קובץ לא תקין לא ידרוס את הנתונים הפעילים.</div>
                          </section>

                          <section class="control-group">
                            <div class="control-group-header">
                              <h4>זמן</h4>
                              <p>יום פרויקט, תאריך מדויק, טווח תאריכים ושעות</p>
                            </div>
                            <div class="filters-grid filters-grid--three">
                              <label class="form-label">
                                יום פרויקט
                                <select id="project-day-filter" class="form-select"></select>
                              </label>
                              <label class="form-label">
                                תאריך מדויק
                                <select id="date-exact" class="form-select"></select>
                              </label>
                              <label class="form-label">
                                שעה
                                <select id="hour-filter" class="form-select"></select>
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
                                משעה
                                <select id="hour-from-filter" class="form-select"></select>
                              </label>
                              <label class="form-label">
                                עד שעה
                                <select id="hour-to-filter" class="form-select"></select>
                              </label>
                            </div>
                          </section>

                          <section class="control-group">
                            <div class="control-group-header">
                              <h4>אנשים וסכומים</h4>
                              <p>פילוח לפי שגריר, תורם וסכום</p>
                            </div>
                            <div class="filters-grid">
                              <label class="form-label">
                                שגריר/ה
                                <select id="ambassador-filter" class="form-select"></select>
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
                            </div>
                          </section>

                          <section class="control-group">
                            <div class="control-group-header">
                              <h4>יעדים</h4>
                              <p>מדדי יעד כוללים ויומיים</p>
                            </div>
                            <div class="filters-grid">
                              <label class="form-label">
                                יעד כולל
                                <input id="goal-total" class="form-control" type="number" min="0" step="100" placeholder="למשל 1500000" />
                              </label>
                              <label class="form-label">
                                יעד יומי
                                <input id="goal-daily" class="form-control" type="number" min="0" step="100" placeholder="למשל 150000" />
                              </label>
                            </div>
                          </section>
                        </div>
                        <div class="control-actions">
                          <button id="export-filtered" class="button-primary action-button" type="button">ייצוא הנתונים המסוננים</button>
                          <button id="clear-compare" class="button-secondary action-button secondary" type="button">ניקוי קובץ ההשוואה</button>
                          <button id="clear-filters" class="button-ghost" type="button">ניקוי מסננים</button>
                        </div>
                        <div id="active-filter-summary" class="status-chip active-filter-summary" aria-live="polite">אין מסננים פעילים</div>
                        <div id="control-note" class="status-note text-small" aria-live="polite"></div>
                      </aside>
                    </section>

                    <section id="metrics-grid" class="metric-grid" aria-label="מדדי סיכום"></section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>יעדים מול ביצוע</h3>
                        <div id="goals-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="goals-board" class="analysis-shell"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>מה דורש תשומת לב עכשיו</h3>
                        <div id="executive-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="executive-board" class="analysis-shell"></div>
                    </section>

                    <section class="dashboard-section chart-frame">
                      <div class="chart-panel chart-card app-card">
                        <div class="section-header">
                          <div class="chart-header-copy">
                            <span class="chart-overline">מבט מגמה</span>
                            <h3>מגמה יומית</h3>
                            <div id="daily-chart-summary" class="chart-insights" aria-live="polite"></div>
                          </div>
                          <div class="data-toolbar metric-toolbar" data-metric-group="daily" aria-label="בחירת מדד לגרף היומי">
                            <button class="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="amount">סכום גיוס</button>
                            <button class="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="count">מספר עסקאות</button>
                            <button class="metric-toggle" type="button" data-metric-select="daily-metric-select" data-value="average">ממוצע לעסקה</button>
                          </div>
                        </div>
                        <select id="daily-metric-select" class="visually-hidden-select" aria-label="בחירת מדד לגרף יומי">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                          <option value="average">ממוצע לעסקה</option>
                        </select>
                        <div id="daily-chart" class="chart-surface"></div>
                        <div class="chart-footnote">לחיצה על עמוד או נקודה בגרף תסנן את הדשבורד לאותו יום.</div>
                      </div>
                      <div id="daily-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                    </section>

                    <section class="dashboard-section chart-frame">
                      <div class="chart-panel chart-card app-card">
                        <div class="section-header">
                          <div class="chart-header-copy">
                            <span class="chart-overline">עומסים לפי זמן</span>
                            <h3>מפת חום לגיוס כספים</h3>
                            <div id="heatmap-summary" class="chart-insights" aria-live="polite"></div>
                            <div class="legend-row text-small text-muted">
                              <span class="legend-item"><span class="legend-swatch" style="background: rgba(255, 214, 41, 0.18); border: 1px solid rgba(17, 29, 74, 0.14);"></span>עוצמה נמוכה</span>
                              <span class="legend-item"><span class="legend-swatch" style="background: rgba(255, 214, 41, 0.95); border: 1px solid rgba(17, 29, 74, 0.14);"></span>עוצמה גבוהה</span>
                            </div>
                          </div>
                          <div class="data-toolbar metric-toolbar" data-metric-group="heatmap" aria-label="בחירת מדד למפת החום">
                            <button class="metric-toggle" type="button" data-metric-select="heatmap-metric-select" data-value="amount">סכום גיוס</button>
                            <button class="metric-toggle" type="button" data-metric-select="heatmap-metric-select" data-value="count">מספר עסקאות</button>
                          </div>
                        </div>
                        <select id="heatmap-metric-select" class="visually-hidden-select" aria-label="בחירת מדד למפת החום">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                        </select>
                        <div id="heatmap-chart" class="chart-surface chart-surface--wide"></div>
                        <div class="chart-footnote">לחיצה על תא במפה תפעיל פילוח משולב של יום ושעה.</div>
                      </div>
                      <div id="heatmap-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                    </section>

                    <section class="dashboard-section chart-frame">
                      <div class="chart-panel chart-card app-card">
                        <div class="section-header">
                          <div class="chart-header-copy">
                            <span class="chart-overline">פעילות שגרירים</span>
                            <h3>תנועת שגרירים</h3>
                            <div id="movement-summary" class="chart-insights" aria-live="polite"></div>
                          </div>
                          <div class="data-toolbar metric-toolbar" data-metric-group="movement" aria-label="בחירת מדד לתנועת השגרירים">
                            <button class="metric-toggle" type="button" data-metric-select="movement-metric-select" data-value="amount">סכום גיוס</button>
                            <button class="metric-toggle" type="button" data-metric-select="movement-metric-select" data-value="count">מספר עסקאות</button>
                          </div>
                        </div>
                        <select id="movement-metric-select" class="visually-hidden-select" aria-label="בחירת מדד לתנועת שגרירים">
                          <option value="amount">סכום גיוס</option>
                          <option value="count">מספר עסקאות</option>
                        </select>
                        <div id="movement-chart" class="chart-surface chart-surface--wide"></div>
                        <div class="chart-footnote">לחיצה על שגריר או על תא במטריצה תעדכן את כל המסכים לפי אותו חיתוך.</div>
                      </div>
                      <div id="movement-tooltip" class="tooltip" role="status" aria-live="polite"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>דירוגים ופילוחים</h3>
                        <div id="segment-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="segment-board" class="analysis-shell"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>איכות נתונים וסיכונים</h3>
                        <div id="quality-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="quality-board" class="analysis-shell"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>ולידציה של קבצי הקלט</h3>
                        <div id="validation-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="validation-board" class="analysis-shell"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>השוואת קבצים</h3>
                        <div id="comparison-summary" class="text-small text-muted"></div>
                      </div>
                      <div id="comparison-board" class="comparison-shell"></div>
                    </section>

                    <section class="dashboard-section">
                      <div class="section-header">
                        <h3>טבלת הרשומות</h3>
                        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                          <div id="table-summary" class="text-small text-muted"></div>
                          <button id="table-toggle" class="button-ghost" type="button" aria-expanded="false" aria-controls="table-panel">הצג רשומות</button>
                        </div>
                      </div>
                      <div id="table-panel" class="table-panel" hidden>
                        <div id="table-root" class="table-wrap"></div>
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            </main>
          </div>
          <script>
            (async () => {
              const INITIAL_ROWS = __INITIAL_ROWS__;
              const INITIAL_META = __INITIAL_META__;
              const INITIAL_ORG_LOGO = __INITIAL_ORG_LOGO__;
              const INITIAL_CAMPAIGN_LOGO = __INITIAL_CAMPAIGN_LOGO__;
              const INITIAL_BACKDROP = __INITIAL_BACKDROP__;
              const INITIAL_PRIZES = __INITIAL_PRIZES__;
              const AUTH_CONFIG = __AUTH_CONFIG__;
              const PRIZE_STORAGE_KEY = "yellow-dashboard.prize-model";
              const GOAL_STORAGE_KEY = "yellow-dashboard.goals";
              const XLSX_MODULE_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
              const root = document.getElementById("yellow-dashboard-root");
              root.style.setProperty("--brand-pattern-campaign", `url("${INITIAL_CAMPAIGN_LOGO}")`);
              root.style.setProperty("--brand-pattern-organization", `url("${INITIAL_ORG_LOGO}")`);
              root.style.setProperty("--dashboard-backdrop", INITIAL_BACKDROP ? `url("${INITIAL_BACKDROP}")` : "none");

              const elements = {
                topbarCampaignLogo: root.querySelector("#topbar-campaign-logo"),
                topbarLogo: root.querySelector("#topbar-logo"),
                logo: root.querySelector("#brand-logo"),
                brandOrgLogo: root.querySelector("#brand-org-logo"),
                publicLogo: root.querySelector("#public-logo"),
                publicOrgLogo: root.querySelector("#public-org-logo"),
                loginCampaignLogo: root.querySelector("#login-campaign-logo"),
                loginOrgLogo: root.querySelector("#login-org-logo"),
                navButtons: Array.from(root.querySelectorAll("[data-page-target]")),
                adminEntryButtons: Array.from(root.querySelectorAll("[data-admin-login]")),
                metricButtons: Array.from(root.querySelectorAll("[data-metric-select]")),
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
                loginPasswordConfirmLabel: root.querySelector("#login-password-confirm-label"),
                loginPasswordConfirm: root.querySelector("#login-password-confirm"),
                loginPasswordToggle: root.querySelector("#login-password-toggle"),
                loginButton: root.querySelector("#login-button"),
                loginModeHint: root.querySelector("#login-mode-hint"),
                loginMessage: root.querySelector("#login-message"),
                heroBadges: root.querySelector("#hero-badges"),
                activeFilterSummary: root.querySelector("#active-filter-summary"),
                controlNote: root.querySelector("#control-note"),
                adminWindowLabel: root.querySelector("#admin-window-label"),
                adminLastUpdated: root.querySelector("#admin-last-updated"),
                adminSourceFile: root.querySelector("#admin-source-file"),
                adminRecordCount: root.querySelector("#admin-record-count"),
                upload: root.querySelector("#csv-upload"),
                compareUpload: root.querySelector("#compare-upload"),
                prizeUpload: root.querySelector("#prize-upload"),
                importStatus: root.querySelector("#import-status"),
                goalTotal: root.querySelector("#goal-total"),
                goalDaily: root.querySelector("#goal-daily"),
                dailyMetric: root.querySelector("#daily-metric-select"),
                heatmapMetric: root.querySelector("#heatmap-metric-select"),
                movementMetric: root.querySelector("#movement-metric-select"),
                exportFiltered: root.querySelector("#export-filtered"),
                clearCompare: root.querySelector("#clear-compare"),
                clearFilters: root.querySelector("#clear-filters"),
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
                heatmapSummary: root.querySelector("#heatmap-summary"),
                heatmapChart: root.querySelector("#heatmap-chart"),
                heatmapTooltip: root.querySelector("#heatmap-tooltip"),
                movementChart: root.querySelector("#movement-chart"),
                movementTooltip: root.querySelector("#movement-tooltip"),
                movementSummary: root.querySelector("#movement-summary"),
                tableRoot: root.querySelector("#table-root"),
                tableSummary: root.querySelector("#table-summary"),
                tablePanel: root.querySelector("#table-panel"),
                tableToggle: root.querySelector("#table-toggle"),
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
                session: null,
                auth: {
                  backendAvailable: false,
                  setupMode: false,
                },
                filters: getDefaultFilters(INITIAL_META),
                view: {
                  dailyMetric: "amount",
                  heatmapMetric: "amount",
                  movementMetric: "amount",
                },
                ui: {
                  page: "prizes",
                  tableExpanded: false,
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

              function getDefaultFilters(meta) {
                return {
                  ambassador: "all",
                  projectDay: "all",
                  dateExact: "all",
                  hour: "all",
                  hourFrom: "all",
                  hourTo: "all",
                  dateFrom: meta.defaultFrom || "",
                  dateTo: meta.defaultTo || "",
                  donor: "",
                  amountMin: "",
                  amountMax: "",
                };
              }

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

              function canUseBackendAuth() {
                return AUTH_CONFIG?.mode === "backend" && ["http:", "https:"].includes(window.location.protocol);
              }

              function setSetupMode(enabled) {
                state.auth.setupMode = Boolean(enabled);
                if (elements.loginPasswordConfirmLabel) {
                  elements.loginPasswordConfirmLabel.hidden = !state.auth.setupMode;
                }
                if (elements.loginPasswordConfirm) {
                  elements.loginPasswordConfirm.required = state.auth.setupMode;
                  if (!state.auth.setupMode) {
                    elements.loginPasswordConfirm.value = "";
                  }
                }
                if (elements.loginButton) {
                  elements.loginButton.textContent = state.auth.setupMode ? "שמירת סיסמה וכניסה" : "כניסה לפאנל הניהול";
                }
                if (elements.loginModeHint) {
                  elements.loginModeHint.textContent = state.auth.setupMode
                    ? "זו כניסה ראשונה למייל הזה. בחרו סיסמה אישית, אשרו אותה והמערכת תשמור אותה בשרת המקומי."
                    : "הכניסה נשמרת ב-session מקומי מאובטח בשרת. בפריסה ציבורית יש להפעיל HTTPS וניהול secrets מסודר.";
                }
                if (elements.loginPassword) {
                  elements.loginPassword.autocomplete = state.auth.setupMode ? "new-password" : "current-password";
                }
              }

              function setAuthenticatedSession(email) {
                state.session = email ? { email: normalizeSearchToken(email) } : null;
              }

              function clearSessionState() {
                state.session = null;
                setSetupMode(false);
              }

              function isManagerAuthenticated() {
                return Boolean(state.session?.email);
              }

              async function authRequest(endpoint, options = {}) {
                const response = await fetch(endpoint, {
                  method: options.method || "GET",
                  credentials: "same-origin",
                  headers: {
                    "Content-Type": "application/json",
                    ...(options.headers || {}),
                  },
                  body: options.body ? JSON.stringify(options.body) : undefined,
                });
                let payload = {};
                try {
                  payload = await response.json();
                } catch (_error) {
                  payload = {};
                }
                return { response, payload };
              }

              async function hydrateAuthSession() {
                clearSessionState();
                if (!canUseBackendAuth()) {
                  state.auth.backendAvailable = false;
                  return;
                }
                try {
                  const { response, payload } = await authRequest(AUTH_CONFIG.statusEndpoint);
                  state.auth.backendAvailable = response.ok;
                  if (response.ok && payload?.authenticated && payload?.email) {
                    setAuthenticatedSession(payload.email);
                  }
                } catch (_error) {
                  state.auth.backendAvailable = false;
                }
              }

              function setLoginMessage(message, tone = "") {
                elements.loginMessage.textContent = message;
                elements.loginMessage.className = `login-message text-small${tone ? ` is-${tone}` : ""}`;
              }

              function setImportMessage(message, tone = "") {
                if (!elements.importStatus) {
                  return;
                }
                elements.importStatus.textContent = message;
                elements.importStatus.className = `status-note text-small${tone ? ` is-${tone}` : ""}`;
              }

              function hasBlockingValidation(validation) {
                return Boolean(validation.missingColumns.length || !validation.validRows.length);
              }

              function updateTableVisibility() {
                if (!elements.tablePanel || !elements.tableToggle) {
                  return;
                }
                elements.tablePanel.hidden = !state.ui.tableExpanded;
                elements.tableToggle.setAttribute("aria-expanded", String(state.ui.tableExpanded));
                elements.tableToggle.textContent = state.ui.tableExpanded ? "הסתר רשומות" : "הצג רשומות";
              }

              function renderBrandAssets() {
                if (elements.topbarCampaignLogo) {
                  elements.topbarCampaignLogo.src = INITIAL_CAMPAIGN_LOGO;
                }
                if (elements.topbarLogo) {
                  elements.topbarLogo.src = INITIAL_ORG_LOGO;
                }
                if (elements.publicLogo) {
                  elements.publicLogo.src = INITIAL_CAMPAIGN_LOGO;
                }
                if (elements.publicOrgLogo) {
                  elements.publicOrgLogo.src = INITIAL_ORG_LOGO;
                }
                if (elements.loginCampaignLogo) {
                  elements.loginCampaignLogo.src = INITIAL_CAMPAIGN_LOGO;
                }
                if (elements.loginOrgLogo) {
                  elements.loginOrgLogo.src = INITIAL_ORG_LOGO;
                }
                if (elements.logo) {
                  elements.logo.src = INITIAL_CAMPAIGN_LOGO;
                }
                if (elements.brandOrgLogo) {
                  elements.brandOrgLogo.src = INITIAL_ORG_LOGO;
                }
              }

              function hydrateRulesPage() {
                if (!elements.pageRules) {
                  return;
                }
                elements.pageRules.innerHTML = `
                  <article class="legal-hero app-card app-card--elevated">
                    <h2>תקנון השתתפות</h2>
                    <p>עמוד זה מציג נוסח תקנון שמבוסס על הקובץ "תקנון ראש השנה 2025", אך הותאם כבסיס עבודה לחלון הפרויקט הנוכחי: 23.08.2026 עד 01.09.2026. לפני שימוש חיצוני או פרסום יש להשלים התאמה משפטית סופית.</p>
                  </article>
                  <div class="legal-layout">
                    <aside class="legal-sidebar app-card">
                      <div class="section-header">
                        <h3>תוכן עניינים</h3>
                      </div>
                      <nav aria-label="תוכן עניינים - תקנון">
                        <a href="#rules-section-1">1. כללי התחרות ומטרותיה</a>
                        <a href="#rules-section-2">2. מבנה התחרות והתנהלותה</a>
                        <a href="#rules-section-3">3. ההשתתפות בתחרות</a>
                        <a href="#rules-section-4">4. תנאים ומגבלות</a>
                        <a href="#rules-section-5">5. תנאים ומגבלות - המארגנים</a>
                      </nav>
                    </aside>
                    <article class="legal-document app-card legal-layout__content">
                      <div class="status-note text-small">הערה חשובה: מסמך המקור נכתב עבור קמפיין קודם, ואילו בתצוגת המערכת עודכן חלון הפרויקט הנוכחי ליום 23.08.2026 עד יום 01.09.2026. הנוסח עדיין דורש אישור משפטי לפני שימוש חי.</div>
                      <section id="rules-section-1">
                        <h3>1. כללי התחרות ומטרותיה</h3>
                        <p>מטרת הפרויקט היא איסוף סכום כסף גדול ככל הניתן עבור רכישת מוצרי מזון שייארזו ויחולקו לנזקקים, בהתאם ליעדי הקמפיין הפעיל.</p>
                        <ol>
                          <li>התרומות ייאספו באמצעות פלטפורמת גיוס הכספים <strong>giveback</strong>, באמצעות מתנדבים, להלן: שגרירים, אשר יתרימו כספים דרך לינק, קישור, פרטי לכל שגריר.</li>
                          <li>עם סיום התחרות יוכרז כמנצח השגריר שבאמצעות הקישור הפרטי שלו נתרם סכום הכסף הגבוה ביותר. הבא בתור יוכרז כזוכה במקום השני וכך הלאה.</li>
                          <li>התקנון מנוסח בלשון זכר אך מיועד לשני המינים.</li>
                        </ol>
                      </section>
                      <section id="rules-section-2">
                        <h3>2. מבנה התחרות והתנהלותה</h3>
                        <p>מסמך המקור מגדיר חלון תחרות מפורש, את תקופת הזמינות של הקישורים ואת ההבחנה בין קישורים אישיים לבין הקישור הכללי.</p>
                        <ol>
                          <li>התחרות תתקיים החל מיום א', 23.08.2026, ועד יום ג', 01.09.2026, להלן: זמני התחרות.</li>
                          <li>הקישורים להתרמה יישארו זמינים בהתאם להנחיית הנהלת הקמפיין, אך לצורך דירוג השגרירים בתחרות יילקחו בחשבון רק תרומות שהתקבלו במהלך זמני התחרות המעודכנים.</li>
                          <li>לצד הקישורים האישיים שיוקצו לכל שגריר, ניתן יהיה להעביר תרומות לפרויקט גם דרך קישור שאינו שייך לאף שגריר, להלן: הקישור הכללי.</li>
                          <li>סכום התרומות הכולל בפרויקט יורכב מסך הסכומים שנאספו בקישורים האישיים, בתוספת הסכום שנאסף בקישור הכללי.</li>
                        </ol>
                      </section>
                      <section id="rules-section-3">
                        <h3>3. ההשתתפות בתחרות</h3>
                        <p>רשאים להשתתף בתחרות מי שעומדים בכל התנאים הבאים, וההשתתפות עצמה אינה כרוכה בתשלום.</p>
                        <ol>
                          <li>אוהדי מכבי תל אביב.</li>
                          <li>נרשמו לתחרות כדין ובמועד, על פי תנאי התקנון.</li>
                          <li>גילם 18 ומעלה.</li>
                          <li>קטינים מעל גיל 16, מותנה באישור בכתב מהורה או אפוטרופוס.</li>
                          <li>אינם שופטים בתחרות.</li>
                          <li>קיבלו אישור לכך ממארגני התחרות.</li>
                          <li>כתובת דוא"ל פעילה שבה אפשר ליצור איתם קשר.</li>
                          <li>ההשתתפות בתחרות אינה כרוכה בתשלום.</li>
                        </ol>
                      </section>
                      <section id="rules-section-4">
                        <h3>4. תנאים ומגבלות</h3>
                        <p>סעיף זה מסדיר את אופן שיוך התרומות, את מגבלות ההעברה בין קישורים ואת כללי ההתנהלות של השגרירים מול תורמים, תקשורת וקהלים חיצוניים.</p>
                        <ol>
                          <li>איסוף התרומות הוא אישי לכל שגריר בנפרד, והסכום הקובע לצורך דירוג השגרירים הוא הסכום שנאסף על ידי השגריר כפי שנתרם בקישור האישי.</li>
                          <li>לא ניתן להעביר תרומות בין שגרירים כך ששגריר יסכים שהסכום שנאסף בקישור האישי שלו יופחת לצד הוספת הסכום לקישור האישי של חברו.</li>
                          <li>במקרה של הכפלת סכום התרומה המוצע לפרק זמן מסוים, יתווסף הסכום שנתרם על ידי התורמים לקישור האישי אליו נתרם, וסכום זהה מכל תרומה במהלך תקופת ההכפלה יתווסף לקישור הכללי. לא ייצבר סכום כפול בקישור האישי במהלך תקופת ההכפלה.</li>
                          <li>בפרויקט ייקחו חלק נציגים של קבוצות המועדון השונות וכן ידוענים המזוהים כאוהדי קבוצת מכבי תל אביב בענפי הספורט השונים. פנייה לשחקני מחלקות המועדון השונות או לידוענים בבקשה לתרומה או לפרסום קישור לתרומה לפרויקט תיעשה אך ורק על ידי מארגני התחרות או באישור מי מהם, ואך ורק לתרומה לקישור הכללי.</li>
                          <li>פנייה לאמצעי התקשורת, אתרי ספורט, אתרי חדשות וגופים טלוויזיוניים שונים, או שימוש באמצעי תקשורת מסחריים, ייעשו אך ורק על ידי נציגי העמותה ובפרסומים בשם העמותה יוצג הקישור הכללי בלבד.</li>
                          <li>שגרירים רשאים לבצע פניות לתורמים פוטנציאליים בכל אמצעי תקשורת אישי, ובכלל זה רשתות חברתיות, יישומונים המאפשרים משלוח מסרים מיידיים, שיחות טלפון וכמובן שיחות פנים אל פנים.</li>
                          <li>משתתף שיפריע להתנהלות התקינה של הפרויקט או ינהג בחוסר כבוד כלפי חבריו, השתתפותו בתחרות תיפסל.</li>
                          <li>השגרירים המשתתפים בתחרות מתחייבים לנהוג באופן מכובד ומכבד המייצג את ערכי העמותה ורוח ההתנדבות, ולהימנע מביטויים גזעניים, מבזים או משפילים כלפי כל אדם.</li>
                        </ol>
                      </section>
                      <section id="rules-section-5">
                        <h3>5. תנאים ומגבלות - המארגנים</h3>
                        <p>סעיף זה עוסק בשיקול הדעת של המארגנים, אי האפשרות לערער, שימוש בחומרי תוכן שיפורסמו והגבלת האחריות של הארגון ומנהלי התחרות.</p>
                        <ol>
                          <li>הנהלת הארגון רשאית להפסיק את התחרות או לשנות את תנאיה בכל עת. מארגני התחרות רשאים ליצור קשר עם משתתפי התחרות בהקשר רלוונטי בכל עת.</li>
                          <li>בחירת הפרסים שיחולקו לזוכי התחרות תהיה כפופה לשיקול דעתם של מארגני התחרות בלבד. הפרסים המפורסמים למשתתפי התחרות עשויים להשתנות בהתאם לשיקול דעת מנהלי הארגון והנהלת מועדון הכדורגל מכבי תל אביב, ולא תקום בכך כל זכות או תביעה לשגרירים המשתתפים בתחרות.</li>
                          <li>לא יתאפשר לערער על החלטת השופטים או על כל החלטה מנהלתית של מארגני התחרות או מנהלי הארגון.</li>
                          <li>מארגני התחרות רשאים להשתמש לצרכי הפרויקט בכל תמונה או רשומה ברשתות החברתיות שיפיצו השגרירים המשתתפים בתחרות. אין בכך כדי לפגוע בזכויות הצלם על תמונות שתפורסמנה על ידי השגרירים המשתתפים בתחרות בכל הקשר אחר.</li>
                          <li>מנהלי הארגון ומארגני התחרות אינם נושאים באחריות כלשהי לכל נזקי גוף או רכוש או לכל פגיעה אחרת שתיגרם למשתתפי התחרות. אין בקיום התחרות כדי להרחיב כל אחריות שחלה על מארגני הפרויקט.</li>
                          <li>בהרשמה לתחרות נותנים השגרירים המשתתפים בתחרות הסכמתם המלאה לכל תנאי התחרות המפורטים לעיל, וכן מצהירים כי הם עומדים בכל התנאים הדרושים לצורך השתתפות בתחרות.</li>
                          <li>אין באמור לעיל כדי לפגוע בכל זכות הקנויה למארגני התחרות או באפשרות פנייה לערכאות משפטיות בגין הפרה של כללי התחרות על ידי מי מהמועמדים להשתתף בתחרות, מהמשתתפים בה או מי מטעמם.</li>
                        </ol>
                        <p><strong>כתובת הקשר שמופיעה במסמך המקור:</strong> <a href="mailto:achimlasemel@gmail.com">achimlasemel@gmail.com</a></p>
                      </section>
                    </article>
                  </div>
                `;
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

              function getLatestCreatedIso(rows) {
                return [...rows]
                  .map((row) => row.createdIso)
                  .filter(Boolean)
                  .sort()
                  .slice(-1)[0] || "";
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

              function validatePrizeModelUpload(model, label) {
                const normalized = normalizePrizeModel(model);
                const warnings = [];
                const errors = [];

                if (!normalized.placePrizes.length) {
                  warnings.push("לא זוהו פרסי מיקומים תקפים.");
                }
                if (!normalized.tierPrizes.length) {
                  warnings.push("לא זוהו מדרגות פרס תקפות.");
                }
                if (!normalized.placePrizes.length && !normalized.tierPrizes.length) {
                  errors.push(`לא נמצאו פרסים תקפים בקובץ ${label}.`);
                }

                return {
                  normalized,
                  warnings,
                  errors,
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

              function getActiveFilters() {
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
                return summary;
              }

              function getActiveFilterSummary() {
                const summary = getActiveFilters();
                return summary.length ? ` | פילוחים פעילים: ${summary.join(" • ")}` : "";
              }

              function renderActiveFilterSummary() {
                const summary = getActiveFilters();
                elements.activeFilterSummary.textContent = summary.length ? `מסננים פעילים: ${summary.join(" • ")}` : "אין מסננים פעילים";
              }

              function updateMetricToolbarState() {
                elements.metricButtons.forEach((button) => {
                  const selectId = button.dataset.metricSelect;
                  const targetSelect = root.querySelector(`#${selectId}`);
                  button.classList.toggle("is-active", Boolean(targetSelect) && targetSelect.value === button.dataset.value);
                });
              }

              function setControlNote(filteredRows, prizeRows) {
                const compareText = state.compare.rows.length ? ` | השוואה: ${state.compare.label} (${formatNumber(state.compare.rows.length)} רשומות)` : "";
                elements.controlNote.textContent = `בסיס: ${state.sourceLabel} | חלון ברירת מחדל: ${state.meta.projectWindowLabel || "לא זוהה"} | מוצגות ${formatNumber(filteredRows.length)} עסקאות במסנן | פרסים מחושבים על ${formatNumber(prizeRows.length)} עסקאות בטווח הזמן הנבחר${compareText}${getActiveFilterSummary()}`;
              }

              function renderPublicHeroBadges(prizeRows) {
                const leaderboard = buildLeaderboard(prizeRows);
                const topLeader = leaderboard[0];
                const latestCreated = getLatestCreatedIso(prizeRows);
                const total = sumAmount(prizeRows);
                const campaignStatus = prizeRows.length ? "פעיל על בסיס הקובץ הנוכחי" : "ממתין לנתונים";
                const sourceWindow = state.meta.projectWindowLabel || "לא זוהה";
                const leaderValue = topLeader ? escapeHtml(topLeader.ambassador) : "טרם נקבע";
                const leaderMeta = topLeader
                  ? `הוביל/ה עד כה עם ${escapeHtml(formatAmount(topLeader.total))}`
                  : "ברגע שייקלטו נתונים יופיע כאן מוביל/ה נוכחי/ת";
                const updatedText = latestCreated ? escapeHtml(formatDateTime(latestCreated)) : "אין עדכון";
                const publicBadges = [
                  `
                    <article class="public-snapshot-card public-snapshot-card--primary">
                      <div class="public-snapshot-label">סך גיוס נוכחי</div>
                      <div class="public-snapshot-value">${escapeHtml(formatAmount(total))}</div>
                      <div class="public-snapshot-meta">זהו הסכום המחושב כרגע מתוך טווח הנתונים הפעיל.</div>
                    </article>
                  `,
                  `
                    <article class="public-snapshot-card public-snapshot-card--wide">
                      <div class="public-snapshot-label">מוביל/ה כרגע</div>
                      <div class="public-snapshot-value">${leaderValue}</div>
                      <div class="public-snapshot-meta">${leaderMeta}</div>
                    </article>
                  `,
                  `
                    <article class="public-snapshot-card">
                      <div class="public-snapshot-label">שגרירים פעילים</div>
                      <div class="public-snapshot-value">${escapeHtml(formatNumber(leaderboard.length))}</div>
                      <div class="public-snapshot-meta">מספר השגרירים עם גיוס בפועל בטווח המוצג.</div>
                    </article>
                  `,
                  `
                    <article class="public-snapshot-card">
                      <div class="public-snapshot-label">חלון פרויקט פעיל</div>
                      <div class="public-snapshot-value">${escapeHtml(sourceWindow)}</div>
                      <div class="public-snapshot-meta">הנתונים מוצגים עבור הטווח הפעיל בקובץ הנוכחי.</div>
                    </article>
                  `,
                  `
                    <article class="public-snapshot-card">
                      <div class="public-snapshot-label">סטטוס הפרויקט</div>
                      <div class="public-snapshot-status">${escapeHtml(campaignStatus)}</div>
                      <div class="public-snapshot-meta">התצוגה הציבורית משקפת את מצב הנתונים הזמין כרגע.</div>
                    </article>
                  `,
                  `
                    <article class="public-snapshot-card">
                      <div class="public-snapshot-label">עדכון אחרון</div>
                      <div class="public-snapshot-value">${updatedText}</div>
                      <div class="public-snapshot-meta">זמן הרשומה האחרונה שנקלטה למסך התקציר.</div>
                    </article>
                  `,
                ];
                elements.publicHeroBadges.innerHTML = `<div class="public-snapshot-grid">${publicBadges.join("")}</div>`;
              }

              function renderHeroBadges(filteredRows, prizeRows, compareRows) {
                const filteredTotal = sumAmount(filteredRows);
                const prizeTotal = sumAmount(prizeRows);
                const ambassadorCount = new Set(prizeRows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך")).size;
                const latestCreated = getLatestCreatedIso(filteredRows);
                renderBrandAssets();
                const badges = [
                  `<span class="hero-badge">${escapeHtml(formatAmount(filteredTotal))} בתצוגה הפעילה</span>`,
                  `<span class="hero-badge">${escapeHtml(formatNumber(ambassadorCount))} שגרירים פעילים בטווח</span>`,
                  `<span class="hero-badge">טווח פרויקט: ${escapeHtml(state.meta.projectWindowLabel || "טווח לא זוהה")}</span>`,
                  `<span class="hero-badge">בסיס פרסים: ${escapeHtml(formatAmount(prizeTotal))}</span>`,
                ];
                if (state.compare.rows.length) {
                  badges.push(`<span class="hero-badge">השוואה: ${escapeHtml(state.compare.label)} · ${escapeHtml(formatAmount(sumAmount(compareRows)))}</span>`);
                }
                if (latestCreated) {
                  badges.push(`<span class="hero-badge">עודכן לאחרונה: ${escapeHtml(formatDateTime(latestCreated))}</span>`);
                }
                elements.adminWindowLabel.textContent = state.meta.projectWindowLabel || "לא זוהה";
                elements.adminLastUpdated.textContent = latestCreated ? formatDateTime(latestCreated) : "אין נתונים";
                elements.adminSourceFile.textContent = state.sourceLabel || "קובץ בסיס";
                elements.adminRecordCount.textContent = formatNumber(filteredRows.length);
                elements.heroBadges.innerHTML = badges.join("");
              }

              function renderMetrics(rows) {
                const total = sumAmount(rows);
                const ambassadors = new Set(rows.map((row) => row.ambassador).filter((value) => value && value !== "ללא שיוך"));
                const average = rows.length ? total / rows.length : 0;
                const successCount = rows.filter((row) => row.status === "success").length;
                const successRate = rows.length ? successCount / rows.length : 0;
                const peakHourEntry = Array.from(groupBy(rows, (row) => row.hour).entries())
                  .map(([hour, items]) => [hour, sumAmount(items)])
                  .sort((left, right) => right[1] - left[1])[0];
                const peakHourLabel = peakHourEntry ? `${String(peakHourEntry[0]).padStart(2, "0")}:00` : "אין";
                const topAmbassador = buildLeaderboard(rows)[0] || null;
                const totalGoal = Number(state.goals.total || 0);
                const totalGoalProgress = totalGoal > 0 ? total / totalGoal : 0;

                const stats = [
                  { label: "סך הגיוס", value: formatAmount(total), detail: `${formatNumber(rows.length)} עסקאות בפילוח` },
                  { label: "מספר עסקאות", value: formatNumber(rows.length), detail: `שיעור הצלחה ${formatPercent(successRate)}` },
                  { label: "ממוצע לעסקה", value: formatAmount(average), detail: "לפי התצוגה הפעילה" },
                  { label: "שגרירים פעילים", value: formatNumber(ambassadors.size), detail: "עם לפחות עסקה אחת" },
                  { label: "ביצוע מול יעד", value: totalGoal ? formatPercent(totalGoalProgress) : "ללא יעד", detail: totalGoal ? `${formatAmount(Math.max(totalGoal - total, 0))} נותרו ליעד` : "הגדירו יעד כולל" },
                  { label: "שגריר מוביל", value: topAmbassador ? topAmbassador.ambassador : "אין", detail: topAmbassador ? formatAmount(topAmbassador.total) : "אין נתונים" },
                  { label: "שעת שיא", value: peakHourLabel, detail: peakHourEntry ? formatAmount(peakHourEntry[1]) : "אין נתונים" },
                  { label: "עסקאות מחויבות", value: formatNumber(successCount), detail: `${formatPercent(successRate)} מסך העסקאות` },
                ];

                elements.metrics.innerHTML = stats
                  .map(
                    (stat) => `
                      <article class="metric-card kpi-card app-card">
                        <div class="metric-label">${escapeHtml(stat.label)}</div>
                        <div class="metric-value">${escapeHtml(stat.value)}</div>
                        <div class="metric-detail">${escapeHtml(stat.detail)}</div>
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

              function renderPrizeBoard(prizeRows) {
                const standings = computePrizeStandings(prizeRows);
                const { placeWinners, tiers, prizeModel, selectedFocus } = standings;

                elements.prizeSummary.textContent = selectedFocus
                  ? `${selectedFocus.ambassador}: ${formatAmount(selectedFocus.total)} | פרס פעיל: ${selectedFocus.currentPrize}${selectedFocus.nextPrize ? ` | חסרים ${formatAmount(selectedFocus.gap)} ל-${selectedFocus.nextPrize}` : " | נמצא במדרגה העליונה"}`
                  : `${formatNumber(standings.leaderboard.length)} שגרירים מדורגים בטווח הזמן הנבחר`;

                const podiumMarkup = placeWinners.length
                  ? `
                      <div class="dashboard-section">
                        <div class="section-head">
                          <h3>פודיום מובילים</h3>
                          <div class="text-small text-muted">שלושת המקומות הראשונים מחושבים לפי סכום הגיוס המצטבר בתצוגה הפעילה.</div>
                        </div>
                        <div class="podium-grid">
                          ${placeWinners
                            .map((item, index) => {
                              const winner = item.winner;
                              const nextWinner = placeWinners[index + 1]?.winner || null;
                              const isFocus = winner && state.filters.ambassador !== "all" && winner.ambassador === state.filters.ambassador;
                              const leadGap = winner && nextWinner ? Math.max(winner.total - nextWinner.total, 0) : 0;
                              return `
                                <article class="prize-card place-card place-card--${item.place}">
                                  <div class="prize-visual">
                                    <div class="podium-mark">
                                      <svg viewBox="0 0 220 120" role="img" aria-label="${escapeAttribute(item.label)}">
                                        <rect x="24" y="64" width="48" height="34" rx="8" fill="rgba(255,214,41,0.92)"></rect>
                                        <rect x="86" y="38" width="48" height="60" rx="8" fill="rgba(255,255,255,0.96)"></rect>
                                        <rect x="148" y="54" width="48" height="44" rx="8" fill="rgba(255,214,41,0.62)"></rect>
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
                                          <div class="prize-meta">
                                            <span>פרס: ${escapeHtml(item.prize)}</span>
                                            <span>${escapeHtml(nextWinner ? `פער מהמקום הבא: ${formatAmount(leadGap)}` : "מוביל את הטבלה כרגע")}</span>
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
                              const nearestCandidate =
                                [...standings.leaderboard]
                                  .filter((entry) => entry.total < tier.threshold)
                                  .sort((left, right) => right.total - left.total)[0] || null;
                              const progressBasis = nearestCandidate ? nearestCandidate.total : winners[0]?.total || 0;
                              const progressPct = tier.threshold ? Math.min(progressBasis / tier.threshold, 1) * 100 : 0;
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
                                        <rect x="86" y="${56 - index * 6}" width="48" height="${56 + index * 6}" rx="10" fill="rgba(17,29,74,0.96)"></rect>
                                        <rect x="148" y="${34 - index * 6}" width="48" height="${78 + index * 6}" rx="10" fill="rgba(255,255,255,0.92)"></rect>
                                        <circle cx="120" cy="24" r="14" fill="rgba(255,214,41,0.96)"></circle>
                                      </svg>
                                    </div>
                                  </div>
                                  <div class="prize-content">
                                    <div class="prize-title-row">
                                      <div class="prize-title">${escapeHtml(formatAmount(tier.threshold))}</div>
                                      <span class="prize-pill">${escapeHtml(tier.prize)}</span>
                                    </div>
                                    <div class="text-small text-muted">זוכים פעילים כרגע: ${escapeHtml(formatNumber(tier.active.length))}</div>
                                    <div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${progressPct}%"></div></div>
                                    <div class="prize-meta">
                                      <span>${escapeHtml(tier.active.length ? "המדרגה הושגה" : "עדיין לא הושגה")}</span>
                                      <span>${escapeHtml(nearestCandidate ? `${nearestCandidate.ambassador} קרוב/ה עם פער של ${formatAmount(tier.threshold - nearestCandidate.total)}` : "אין כרגע מועמד/ת קרוב/ה")}</span>
                                    </div>
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
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttribute(ariaLabel)}">
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

              function setInsightSummary(element, items) {
                if (!element) {
                  return;
                }
                const normalized = (items || []).filter((item) => item && item.label && item.value);
                element.innerHTML = normalized
                  .map(
                    (item) => `
                      <span class="insight-chip${item.tone ? ` insight-chip--${escapeAttribute(item.tone)}` : ""}">
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${escapeHtml(item.value)}</strong>
                      </span>
                    `
                  )
                  .join("");
              }

              function interpolateRgb(from, to, factor) {
                const clamped = Math.max(0, Math.min(1, factor));
                const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * clamped));
                return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
              }

              function buildHeatColor(factor) {
                const clamped = Math.max(0, Math.min(1, factor));
                if (clamped <= 0.01) {
                  return "rgba(17, 29, 74, 0.05)";
                }
                if (clamped <= 0.5) {
                  return interpolateRgb([255, 242, 173], [255, 214, 41], clamped / 0.5);
                }
                return interpolateRgb([255, 214, 41], [17, 29, 74], (clamped - 0.5) / 0.5);
              }

              function renderDailyChart(rows) {
                if (!rows.length) {
                  elements.dailyChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
                  setInsightSummary(elements.dailySummary, []);
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

                const width = Math.max(920, 200 + aggregates.length * 88);
                const height = 360;
                const margin = { top: 34, right: 34, bottom: 84, left: 82 };
                const plotWidth = width - margin.left - margin.right;
                const plotHeight = height - margin.top - margin.bottom;
                const maxValue = Math.max(...aggregates.map((entry) => getValue(entry)), 1);
                const averageValue = aggregates.reduce((sum, entry) => sum + getValue(entry), 0) / Math.max(aggregates.length, 1);
                const slotWidth = plotWidth / Math.max(aggregates.length, 1);
                const barWidth = Math.min(42, Math.max(slotWidth * 0.42, 18));
                const baseline = margin.top + plotHeight;
                const bestDay = [...aggregates].sort((left, right) => getValue(right) - getValue(left))[0];
                const latestDay = aggregates[aggregates.length - 1];
                const points = aggregates.map((entry, index) => {
                  const value = getValue(entry);
                  const centerX = margin.left + slotWidth * index + slotWidth / 2;
                  const y = baseline - (value / maxValue) * plotHeight;
                  return { entry, value, centerX, y };
                });
                const areaPath = points
                  .map((point, index) => `${index === 0 ? "M" : "L"} ${point.centerX} ${point.y}`)
                  .join(" ");
                const areaClosedPath = `${areaPath} L ${points[points.length - 1].centerX} ${baseline} L ${points[0].centerX} ${baseline} Z`;
                const linePath = areaPath;

                const parser = new DOMParser();
                const doc = parser.parseFromString(createSvg(width, height, "תרשים מגמה יומי של גיוס"), "image/svg+xml");
                const svgNode = doc.documentElement;
                svgNode.insertAdjacentHTML(
                  "afterbegin",
                  `
                    <defs>
                      <linearGradient id="dailyAreaGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="rgba(36, 55, 124, 0.34)"></stop>
                        <stop offset="100%" stop-color="rgba(36, 55, 124, 0.04)"></stop>
                      </linearGradient>
                      <linearGradient id="dailyBarGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="#24377C"></stop>
                        <stop offset="100%" stop-color="#111D4A"></stop>
                      </linearGradient>
                      <linearGradient id="dailyBarHighlight" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stop-color="#FFE266"></stop>
                        <stop offset="100%" stop-color="#F4C900"></stop>
                      </linearGradient>
                    </defs>
                  `
                );

                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>`
                );

                for (let tick = 0; tick <= 4; tick += 1) {
                  const value = (maxValue / 4) * tick;
                  const y = margin.top + plotHeight - (value / maxValue) * plotHeight;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(19,23,80,0.12)" stroke-width="1" stroke-dasharray="4 6"></line>
                     <text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" fill="rgba(16,16,16,0.6)" font-size="11" font-weight="${tick === 4 ? "700" : "500"}">${escapeHtml(formatNumber(Math.round(value)))}</text>`
                  );
                }

                points.forEach((point, index) => {
                  const isBest = bestDay && point.entry.date === bestDay.date;
                  const bandX = margin.left + slotWidth * index;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<rect x="${bandX + 2}" y="${margin.top + 2}" width="${slotWidth - 4}" height="${plotHeight - 4}" rx="18" fill="${isBest ? "rgba(255, 214, 41, 0.12)" : index % 2 === 0 ? "rgba(17, 29, 74, 0.025)" : "rgba(255,255,255,0)"}"></rect>`
                  );
                });

                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<path d="${areaClosedPath}" fill="url(#dailyAreaGradient)"></path>
                   <path d="${linePath}" fill="none" stroke="rgba(36, 55, 124, 0.88)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"></path>`
                );

                points.forEach((point) => {
                  const x = point.centerX - barWidth / 2;
                  const heightValue = (point.value / maxValue) * plotHeight;
                  const y = baseline - heightValue;
                  const isBest = bestDay && point.entry.date === bestDay.date;
                  const isLatest = latestDay && point.entry.date === latestDay.date;
                  const bar = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                  bar.setAttribute("x", String(x));
                  bar.setAttribute("y", String(y));
                  bar.setAttribute("width", String(Math.max(barWidth, 12)));
                  bar.setAttribute("height", String(Math.max(heightValue, 2)));
                  bar.setAttribute("rx", "14");
                  bar.setAttribute("fill", isBest ? "url(#dailyBarHighlight)" : "url(#dailyBarGradient)");
                  bar.setAttribute("stroke", isBest ? "rgba(244, 201, 0, 0.8)" : "rgba(17, 29, 74, 0.12)");
                  bar.classList.add("clickable-cell");
                  const tooltipHtml = `<strong>${escapeHtml(formatDate(point.entry.date))}</strong><br>${escapeHtml(metricLabel)}: ${escapeHtml(formatMetricValue(point.value))}<br>${escapeHtml(formatNumber(point.entry.count))} עסקאות`;
                  bar.addEventListener("mouseenter", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
                  bar.addEventListener("mousemove", (event) => showTooltip(elements.dailyChart, elements.dailyTooltip, tooltipHtml, event.clientX, event.clientY));
                  bar.addEventListener("mouseleave", () => hideTooltip(elements.dailyTooltip));
                  bar.addEventListener("click", () => {
                    state.filters.dateFrom = point.entry.date;
                    state.filters.dateTo = point.entry.date;
                    resetFilterOptions();
                    renderAll();
                  });
                  svgNode.appendChild(bar);

                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<circle cx="${point.centerX}" cy="${point.y}" r="${isBest ? 7.5 : 5.5}" fill="${isBest ? "#FFD629" : "#111D4A"}" stroke="${isBest ? "#111D4A" : "#FFFFFF"}" stroke-width="${isBest ? "2.5" : "2"}"></circle>`
                  );

                  if (isBest || isLatest) {
                    const pillWidth = isBest ? 120 : 104;
                    const pillX = Math.min(Math.max(point.centerX - pillWidth / 2, margin.left + 8), width - margin.right - pillWidth);
                    const pillY = Math.max(point.y - 38, margin.top + 8);
                    svgNode.insertAdjacentHTML(
                      "beforeend",
                      `<g>
                        <rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="26" rx="13" fill="${isBest ? "rgba(17, 29, 74, 0.96)" : "rgba(255, 255, 255, 0.94)"}" stroke="${isBest ? "rgba(17, 29, 74, 0.96)" : "rgba(17, 29, 74, 0.14)"}"></rect>
                        <text x="${pillX + pillWidth / 2}" y="${pillY + 17}" text-anchor="middle" fill="${isBest ? "#FFD629" : "#111D4A"}" font-size="11" font-weight="800">${escapeHtml(formatMetricValue(point.value))}</text>
                      </g>`
                    );
                  }

                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${point.centerX}" y="${baseline + 26}" text-anchor="middle" fill="rgba(16,16,16,0.78)" font-size="11" font-weight="${isBest ? "800" : "600"}">${escapeHtml(formatShortDate(point.entry.date))}</text>
                     <text x="${point.centerX}" y="${baseline + 44}" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(point.entry.date))}</text>`
                  );
                });

                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<text x="${margin.left}" y="18" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)}</text>
                   <text x="${width - margin.right}" y="18" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">קו המגמה משקף את קצב השינוי בין הימים הפעילים</text>`
                );

                elements.dailyChart.innerHTML = "";
                elements.dailyChart.appendChild(svgNode);
                setInsightSummary(elements.dailySummary, [
                  bestDay
                    ? { label: "יום שיא", value: `${formatShortDate(bestDay.date)} · ${formatMetricValue(getValue(bestDay))}`, tone: "accent" }
                    : null,
                  { label: "ממוצע יומי", value: formatMetricValue(averageValue) },
                  latestDay ? { label: "יום אחרון בטווח", value: `${formatShortDate(latestDay.date)} · ${formatMetricValue(getValue(latestDay))}`, tone: "dark" } : null,
                ]);
              }

              function renderHeatmap(rows) {
                const dates = state.meta.uniqueDates
                  .filter((date) => !state.filters.dateFrom || date >= state.filters.dateFrom)
                  .filter((date) => !state.filters.dateTo || date <= state.filters.dateTo);
                if (!rows.length || !dates.length) {
                  elements.heatmapChart.innerHTML = `<div class="empty-state">אין נתונים להצגה עבור המסנן הנוכחי.</div>`;
                  setInsightSummary(elements.heatmapSummary, []);
                  return;
                }

                const metricMode = state.view.heatmapMetric;
                const metricLabel = metricMode === "count" ? "מספר עסקאות" : "סכום גיוס";
                const formatMetricValue = (value) => (metricMode === "count" ? formatNumber(Math.round(value)) : formatAmount(value));
                const hours = Array.from({ length: 24 }, (_, hour) => hour);
                const aggregates = new Map();
                const totalsByDate = new Map();
                const totalsByHour = new Map();
                rows.forEach((row) => {
                  const key = `${row.date}|${row.hour}`;
                  const metricValue = metricMode === "count" ? 1 : row.amount;
                  aggregates.set(key, (aggregates.get(key) || 0) + metricValue);
                  totalsByDate.set(row.date, (totalsByDate.get(row.date) || 0) + metricValue);
                  totalsByHour.set(row.hour, (totalsByHour.get(row.hour) || 0) + metricValue);
                });

                const maxValue = Math.max(...aggregates.values(), 1);
                const maxDateTotal = Math.max(...dates.map((date) => totalsByDate.get(date) || 0), 1);
                const bestCell = [...aggregates.entries()].sort((left, right) => right[1] - left[1])[0];
                const bestDay = [...totalsByDate.entries()].sort((left, right) => right[1] - left[1])[0];
                const bestHour = [...totalsByHour.entries()].sort((left, right) => right[1] - left[1])[0];
                const cellWidth = 56;
                const cellHeight = 20;
                const width = Math.max(860, 150 + dates.length * cellWidth);
                const height = 168 + hours.length * cellHeight;
                const margin = { top: 110, right: 18, bottom: 24, left: 96 };

                const parser = new DOMParser();
                const doc = parser.parseFromString(createSvg(width, height, "מפת חום של גיוס לפי תאריך ושעה"), "image/svg+xml");
                const svgNode = doc.documentElement;
                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<rect x="${margin.left}" y="${margin.top}" width="${dates.length * cellWidth}" height="${hours.length * cellHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>`
                );

                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<text x="${margin.left}" y="22" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)} לפי חלונות זמן</text>
                   <text x="${width - margin.right}" y="22" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">עמודות עליונות מציגות את הסך היומי, וכל תא מייצג שעה מסוימת ביום</text>`
                );

                dates.forEach((date, index) => {
                  const x = margin.left + index * cellWidth;
                  const total = totalsByDate.get(date) || 0;
                  const barHeight = (total / maxDateTotal) * 34;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<rect x="${x + 11}" y="${64 - barHeight}" width="${cellWidth - 22}" height="${Math.max(barHeight, 4)}" rx="8" fill="${date === bestDay?.[0] ? "rgba(244, 201, 0, 0.82)" : "rgba(36, 55, 124, 0.48)"}"></rect>
                     <text x="${x + cellWidth / 2}" y="78" text-anchor="middle" fill="rgba(17,29,74,0.82)" font-size="11" font-weight="${date === bestDay?.[0] ? "800" : "700"}">${escapeHtml(formatShortDate(date))}</text>
                     <text x="${x + cellWidth / 2}" y="94" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
                  );
                });

                hours.forEach((hour, rowIndex) => {
                  const y = margin.top + rowIndex * cellHeight;
                  if (hour % 6 === 0) {
                    svgNode.insertAdjacentHTML(
                      "beforeend",
                      `<rect x="${margin.left + 1}" y="${y + 1}" width="${dates.length * cellWidth - 2}" height="${cellHeight * Math.min(6, 24 - hour) - 2}" rx="14" fill="rgba(17, 29, 74, 0.025)"></rect>`
                    );
                  }
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${margin.left - 10}" y="${y + 13}" text-anchor="end" fill="rgba(16,16,16,0.6)" font-size="10" font-weight="${hour === Number(bestHour?.[0]) ? "800" : "600"}">${String(hour).padStart(2, "0")}:00</text>`
                  );
                });

                dates.forEach((date, dateIndex) => {
                  hours.forEach((hour, hourIndex) => {
                    const value = aggregates.get(`${date}|${hour}`) || 0;
                    const intensity = value / maxValue;
                    const isPeak = bestCell && bestCell[0] === `${date}|${hour}`;
                    const cell = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                    cell.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
                    cell.setAttribute("y", String(margin.top + hourIndex * cellHeight + 1));
                    cell.setAttribute("width", String(cellWidth - 3));
                    cell.setAttribute("height", String(cellHeight - 3));
                    cell.setAttribute("rx", "7");
                    cell.setAttribute("fill", buildHeatColor(intensity));
                    cell.setAttribute("fill-opacity", value ? "1" : "0.9");
                    cell.setAttribute("stroke", isPeak ? "rgba(17, 29, 74, 0.96)" : "rgba(19,23,80,0.08)");
                    cell.setAttribute("stroke-width", isPeak ? "2.2" : "1");
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

                    if (isPeak) {
                      svgNode.insertAdjacentHTML(
                        "beforeend",
                        `<circle cx="${margin.left + dateIndex * cellWidth + cellWidth / 2}" cy="${margin.top + hourIndex * cellHeight + cellHeight / 2}" r="4" fill="#FFFFFF" stroke="#111D4A" stroke-width="2"></circle>`
                      );
                    }
                  });
                });

                elements.heatmapChart.innerHTML = "";
                elements.heatmapChart.appendChild(svgNode);
                const peakParts = bestCell ? bestCell[0].split("|") : [];
                setInsightSummary(elements.heatmapSummary, [
                  bestCell
                    ? {
                        label: "חלון שיא",
                        value: `${formatShortDate(peakParts[0])} ${formatHourLabel(Number(peakParts[1]))} · ${formatMetricValue(bestCell[1])}`,
                        tone: "accent",
                      }
                    : null,
                  bestDay ? { label: "יום מוביל", value: `${formatShortDate(bestDay[0])} · ${formatMetricValue(bestDay[1])}` } : null,
                  bestHour ? { label: "שעה חזקה", value: `${formatHourLabel(Number(bestHour[0]))} · ${formatMetricValue(bestHour[1])}`, tone: "dark" } : null,
                ]);
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
                  setInsightSummary(elements.movementSummary, []);
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

                const cellWidth = 64;
                const rowHeight = 32;
                const width = Math.max(900, 260 + projectDates.length * cellWidth);
                const height = 122 + selectedAmbassadors.length * rowHeight;
                const margin = { top: 66, right: 26, bottom: 24, left: 238 };
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
                const bestCell = [...matrixValues.entries()].sort((left, right) => right[1] - left[1])[0];
                const leader = selectedAmbassadors[0] ? [selectedAmbassadors[0], totalsByAmbassador.get(selectedAmbassadors[0]) || 0] : null;

                svgNode.insertAdjacentHTML(
                  "beforeend",
                  `<rect x="${margin.left}" y="${margin.top}" width="${projectDates.length * cellWidth}" height="${selectedAmbassadors.length * rowHeight}" rx="22" fill="rgba(17, 29, 74, 0.03)" stroke="rgba(17, 29, 74, 0.08)"></rect>
                   <text x="${margin.left}" y="24" fill="rgba(17, 29, 74, 0.74)" font-size="12" font-weight="700">${escapeHtml(metricLabel)} לאורך ימי הפרויקט</text>
                   <text x="${width - margin.right}" y="24" text-anchor="end" fill="rgba(17, 29, 74, 0.58)" font-size="11">הצגת השגרירים המובילים בטווח שנבחר עם דירוג, היקף ומוקדי פעילות</text>`
                );

                projectDates.forEach((date, index) => {
                  const x = margin.left + index * cellWidth;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<text x="${x + cellWidth / 2}" y="30" text-anchor="middle" fill="rgba(16,16,16,0.82)" font-size="11" font-weight="700">${escapeHtml(formatShortDate(date))}</text>
                     <text x="${x + cellWidth / 2}" y="46" text-anchor="middle" fill="rgba(16,16,16,0.55)" font-size="10">${escapeHtml(getWeekdayLabel(date))}</text>`
                  );
                });

                selectedAmbassadors.forEach((ambassador, rowIndex) => {
                  const y = margin.top + rowIndex * rowHeight;
                  const total = totalsByAmbassador.get(ambassador) || 0;
                  const intensity = total / Math.max(...selectedAmbassadors.map((name) => totalsByAmbassador.get(name) || 0), 1);
                  const labelY = y + rowHeight / 2 + 4;
                  svgNode.insertAdjacentHTML(
                    "beforeend",
                    `<rect x="${margin.left + 1}" y="${y + 1}" width="${projectDates.length * cellWidth - 2}" height="${rowHeight - 2}" rx="16" fill="${rowIndex % 2 === 0 ? "rgba(17, 29, 74, 0.025)" : "rgba(255,255,255,0)"}"></rect>
                     <circle cx="${margin.left - 210}" cy="${y + rowHeight / 2}" r="12" fill="${rowIndex === 0 ? "#FFD629" : "rgba(17,29,74,0.12)"}" stroke="rgba(17,29,74,0.18)"></circle>
                     <text x="${margin.left - 210}" y="${labelY - 1}" text-anchor="middle" fill="${rowIndex === 0 ? "#111D4A" : "#111D4A"}" font-size="11" font-weight="800">${rowIndex + 1}</text>
                     <rect x="${margin.left - 188}" y="${y + 6}" width="10" height="${rowHeight - 12}" rx="5" fill="${interpolateRgb([255, 226, 102], [17, 29, 74], intensity)}"></rect>
                     <text x="${margin.left - 162}" y="${labelY}" text-anchor="end" fill="rgba(17,29,74,0.92)" font-size="11" font-weight="700">${escapeHtml(formatMetricValue(total))}</text>`
                  );
                  const label = doc.createElementNS("http://www.w3.org/2000/svg", "text");
                  label.setAttribute("x", String(margin.left - 30));
                  label.setAttribute("y", String(labelY));
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
                    const cellIntensity = value / maxValue;
                    const isPeak = bestCell && bestCell[0] === `${ambassador}|${date}`;
                    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
                    rect.setAttribute("x", String(margin.left + dateIndex * cellWidth + 1));
                    rect.setAttribute("y", String(y + 1));
                    rect.setAttribute("width", String(cellWidth - 4));
                    rect.setAttribute("height", String(rowHeight - 4));
                    rect.setAttribute("rx", "9");
                    rect.setAttribute("fill", value ? interpolateRgb([255, 242, 173], [17, 29, 74], cellIntensity) : "rgba(17, 29, 74, 0.05)");
                    rect.setAttribute("fill-opacity", "1");
                    rect.setAttribute("stroke", isPeak ? "rgba(244, 201, 0, 0.92)" : "rgba(17, 29, 74, 0.08)");
                    rect.setAttribute("stroke-width", isPeak ? "2.2" : "1");
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

                    if (isPeak) {
                      svgNode.insertAdjacentHTML(
                        "beforeend",
                        `<circle cx="${margin.left + dateIndex * cellWidth + cellWidth / 2}" cy="${y + rowHeight / 2}" r="4" fill="#FFD629" stroke="#111D4A" stroke-width="2"></circle>`
                      );
                    }
                  });
                });

                elements.movementChart.innerHTML = "";
                elements.movementChart.appendChild(svgNode);
                const bestParts = bestCell ? bestCell[0].split("|") : [];
                setInsightSummary(elements.movementSummary, [
                  leader ? { label: "מוביל נוכחי", value: `${leader[0]} · ${formatMetricValue(leader[1])}`, tone: "accent" } : null,
                  bestCell ? { label: "פיק פעילות", value: `${bestParts[0]} · ${formatShortDate(bestParts[1])} · ${formatMetricValue(bestCell[1])}` } : null,
                  state.filters.ambassador === "all"
                    ? { label: "מוצגים כעת", value: `${formatNumber(selectedAmbassadors.length)} שגרירים`, tone: "dark" }
                    : { label: "פילוח פעיל", value: state.filters.ambassador, tone: "dark" },
                ]);
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
                renderBrandAssets();
                refreshAccessUi();
                updateTableVisibility();
                renderActiveFilterSummary();
                updateMetricToolbarState();
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

                elements.adminEntryButtons.forEach((button) => {
                  button.addEventListener("click", () => {
                    setPage("admin");
                    if (!isManagerAuthenticated()) {
                      elements.loginEmail.focus();
                    }
                  });
                });

                elements.logoutButton.addEventListener("click", async () => {
                  if (canUseBackendAuth() && state.auth.backendAvailable) {
                    try {
                      await authRequest(AUTH_CONFIG.logoutEndpoint, { method: "POST" });
                    } catch (_error) {
                      // If the local backend is unavailable, we still clear the local shell state.
                    }
                  }
                  clearSessionState();
                  elements.loginPassword.value = "";
                  if (elements.loginPasswordConfirm) {
                    elements.loginPasswordConfirm.value = "";
                  }
                  setLoginMessage("");
                  setPage("prizes");
                  renderAll();
                });

                elements.loginForm.addEventListener("submit", async (event) => {
                  event.preventDefault();
                  if (!canUseBackendAuth()) {
                    setLoginMessage("כדי להיכנס לפאנל הניהול יש לפתוח את המערכת דרך שרת הניהול המקומי.", "error");
                    return;
                  }
                  const email = normalizeSearchToken(elements.loginEmail.value);
                  const password = elements.loginPassword.value;
                  const confirmPassword = elements.loginPasswordConfirm?.value || "";
                  if (!email || !password) {
                    setLoginMessage("יש למלא גם מייל וגם סיסמה.", "error");
                    return;
                  }
                  if (state.auth.setupMode && !confirmPassword) {
                    setLoginMessage("יש לאשר את הסיסמה כדי להשלים את ההגדרה הראשונית.", "error");
                    return;
                  }
                  try {
                    const endpoint = state.auth.setupMode ? AUTH_CONFIG.setupEndpoint : AUTH_CONFIG.loginEndpoint;
                    const { response, payload } = await authRequest(endpoint, {
                      method: "POST",
                      body: state.auth.setupMode
                        ? { email, password, confirmPassword }
                        : { email, password },
                    });
                    state.auth.backendAvailable = true;

                    if (response.ok && payload?.authenticated && payload?.email) {
                      setAuthenticatedSession(payload.email);
                      setSetupMode(false);
                      elements.loginPassword.value = "";
                      if (elements.loginPasswordConfirm) {
                        elements.loginPasswordConfirm.value = "";
                      }
                      setLoginMessage(payload.message || "הכניסה הצליחה. הדשבורד הניהולי נפתח.", "success");
                      setPage("admin");
                      renderAll();
                      return;
                    }

                    if (payload?.code === "setup_required" || payload?.setupRequired) {
                      setSetupMode(true);
                      setLoginMessage(payload.message || "זו כניסה ראשונה. יש להגדיר סיסמה אישית.", "warning");
                      if (elements.loginPasswordConfirm) {
                        elements.loginPasswordConfirm.focus();
                      }
                      return;
                    }

                    setLoginMessage(payload?.message || "התחברות נכשלה.", "error");
                  } catch (_error) {
                    state.auth.backendAvailable = false;
                    setLoginMessage("שרת הניהול המקומי אינו זמין כרגע. יש להפעיל אותו כדי להיכנס.", "error");
                  }
                });

                elements.loginPasswordToggle.addEventListener("click", () => {
                  const isPassword = elements.loginPassword.type === "password";
                  elements.loginPassword.type = isPassword ? "text" : "password";
                  if (elements.loginPasswordConfirm) {
                    elements.loginPasswordConfirm.type = isPassword ? "text" : "password";
                  }
                  elements.loginPasswordToggle.textContent = isPassword ? "הסתר" : "הצג";
                });

                elements.loginEmail.addEventListener("input", () => {
                  if (state.auth.setupMode) {
                    setSetupMode(false);
                  }
                  setLoginMessage("");
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

                elements.metricButtons.forEach((button) => {
                  button.addEventListener("click", () => {
                    const selectId = button.dataset.metricSelect;
                    const targetSelect = root.querySelector(`#${selectId}`);
                    if (!targetSelect) {
                      return;
                    }
                    targetSelect.value = button.dataset.value || targetSelect.value;
                    renderAll();
                  });
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

                elements.clearFilters.addEventListener("click", () => {
                  state.filters = getDefaultFilters(state.meta);
                  resetFilterOptions();
                  renderAll();
                });

                elements.tableToggle.addEventListener("click", () => {
                  state.ui.tableExpanded = !state.ui.tableExpanded;
                  updateTableVisibility();
                });

                elements.upload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  try {
                    const text = await file.text();
                    const ingested = ingestCsvText(text, file.name);
                    state.validation.base = ingested.validation;
                    if (hasBlockingValidation(ingested.validation)) {
                      setImportMessage(`קובץ העסקאות ${file.name} לא נטען. נשארים עם הנתונים הפעילים עד לתיקון הקלט.`, "error");
                      renderAll();
                      return;
                    }
                    state.meta = ingested.meta;
                    state.rows = enrichRows(ingested.normalized, ingested.meta);
                    state.sourceLabel = file.name;
                    state.filters = getDefaultFilters(ingested.meta);
                    resetFilterOptions();
                    setImportMessage(
                      ingested.validation.warnings.length
                        ? `קובץ העסקאות ${file.name} נטען עם אזהרות. מומלץ לבדוק את לוח הולידציה לפני קבלת החלטות.`
                        : `קובץ העסקאות ${file.name} נטען בהצלחה.`,
                      ingested.validation.warnings.length ? "warning" : "success"
                    );
                    renderAll();
                  } catch (_error) {
                    setImportMessage(`טעינת קובץ העסקאות ${file.name} נכשלה. הנתונים הפעילים נשמרו כפי שהם.`, "error");
                  }
                });

                elements.compareUpload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  try {
                    const text = await file.text();
                    const ingested = ingestCsvText(text, file.name);
                    state.validation.compare = ingested.validation;
                    if (hasBlockingValidation(ingested.validation)) {
                      setImportMessage(`קובץ ההשוואה ${file.name} לא נטען. ההשוואה הקודמת נשמרה ללא שינוי.`, "error");
                      renderAll();
                      return;
                    }
                    state.compare = {
                      rows: enrichRows(ingested.normalized, ingested.meta),
                      meta: ingested.meta,
                      label: file.name,
                    };
                    resetFilterOptions();
                    setImportMessage(
                      ingested.validation.warnings.length
                        ? `קובץ ההשוואה ${file.name} נטען עם אזהרות.`
                        : `קובץ ההשוואה ${file.name} נטען בהצלחה.`,
                      ingested.validation.warnings.length ? "warning" : "success"
                    );
                    renderAll();
                  } catch (_error) {
                    setImportMessage(`טעינת קובץ ההשוואה ${file.name} נכשלה. ההשוואה הפעילה לא השתנתה.`, "error");
                  }
                });

                elements.prizeUpload.addEventListener("change", async (event) => {
                  const [file] = event.target.files || [];
                  if (!file) {
                    return;
                  }
                  try {
                    const model = await loadPrizeModelFromFile(file);
                    const validation = validatePrizeModelUpload(model, file.name);
                    if (validation.errors.length) {
                      setImportMessage(`קובץ הפרסים ${file.name} לא נטען. טבלת הפרסים הפעילה נשארה כפי שהיא.`, "error");
                      renderAll();
                      return;
                    }
                    state.prizeModel = validation.normalized;
                    storePrizeModel(validation.normalized);
                    setImportMessage(
                      validation.warnings.length
                        ? `קובץ הפרסים ${file.name} נטען חלקית. מומלץ לבדוק שחסרים פרסים או מדרגות לא נעלמו בטעות.`
                        : `קובץ הפרסים ${file.name} נטען בהצלחה.`,
                      validation.warnings.length ? "warning" : "success"
                    );
                    renderAll();
                  } catch (_error) {
                    setImportMessage(`טעינת קובץ הפרסים ${file.name} נכשלה.`, "error");
                  }
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
              hydrateRulesPage();
              resetFilterOptions();
              setSetupMode(false);
              await hydrateAuthSession();
              setPage(state.session ? "admin" : "prizes");
              setLoginMessage("");
              setImportMessage("המערכת מוכנה לקבלת קבצים. קובץ לא תקין לא ידרוס את הנתונים הפעילים.");
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
        .replace("__INITIAL_ORG_LOGO__", org_logo_json)
        .replace("__INITIAL_CAMPAIGN_LOGO__", campaign_logo_json)
        .replace("__INITIAL_BACKDROP__", backdrop_json)
        .replace("__INITIAL_PRIZES__", prize_json)
        .replace("__AUTH_CONFIG__", auth_config_json)
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
    BROWSER_OUTPUT_HTML.write_text(build_browser_document(browser_html), encoding="utf-8")


def build_browser_document(fragment: str) -> str:
    return textwrap.dedent(
        f"""
        <!doctype html>
        <html lang="he" dir="rtl">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="robots" content="noindex,nofollow" />
            <meta name="color-scheme" content="light" />
            <title>Osim Tov BeTzahov Dashboard</title>
            <style>
              html, body {{
                margin: 0;
                min-height: 100%;
                background: #F6F7FA;
              }}
            </style>
          </head>
          <body>
            {fragment}
          </body>
        </html>
        """
    ).strip()


def render_public_dashboard_html(snapshot: dict, org_logo_data_uri: str, campaign_logo_data_uri: str) -> str:
    def format_amount(value: float) -> str:
        return f"{value:,.0f} ₪"

    def format_datetime(value: str) -> str:
        if not value:
            return "אין עדכון"
        try:
            return datetime.fromisoformat(value).strftime("%d.%m.%Y %H:%M")
        except ValueError:
            return value

    podium_html = "".join(
        f"""
        <article class="podium-card podium-card--{item['place']}">
          <div class="podium-place">מקום {item['place']}</div>
          <h3>{item['winner']}</h3>
          <div class="podium-amount">{format_amount(item['amount'])}</div>
          <div class="podium-meta">{item['prize']}</div>
          <div class="podium-meta">{item['deals']} עסקאות</div>
        </article>
        """
        for item in snapshot["podium"]
    )

    tier_html = "".join(
        f"""
        <article class="tier-card">
          <div class="tier-threshold">{format_amount(item['threshold'])}</div>
          <h3>{item['prize']}</h3>
          <div class="tier-meta">זוכים כרגע: {item['winnerCount']}</div>
          <div class="tier-meta">מובילים במדרגה: {", ".join(item['winnerNames']) if item['winnerNames'] else "עדיין אין"}</div>
          <div class="tier-meta">{f"קרוב/ה להשגה: {item['nextUpName']} (פער {format_amount(item['nextUpGap'])})" if item['nextUpName'] else "אין מועמד קרוב נוסף כרגע"}</div>
        </article>
        """
        for item in snapshot["tiers"]
    )

    return textwrap.dedent(
        f"""
        <!doctype html>
        <html lang="he" dir="rtl">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="robots" content="noindex,nofollow" />
            <title>עושים טוב בצהוב | דשבורד ציבורי</title>
            <style>
              :root {{
                --navy-1000: #070D24;
                --navy-950: #0B1435;
                --navy-900: #111D4A;
                --navy-800: #19275F;
                --yolk-600: #F4C900;
                --yolk-500: #FFD629;
                --yolk-200: #FFF2AD;
                --white: #FFFFFF;
                --off-white: #F6F7FA;
                --graphite: #252934;
                --text-muted: #697080;
                --border-light: rgba(17, 29, 74, 0.12);
              }}
              * {{ box-sizing: border-box; }}
              body {{
                margin: 0;
                font-family: "Assistant", Arial, sans-serif;
                background: linear-gradient(180deg, rgba(17,29,74,0.06), var(--off-white) 20%);
                color: var(--graphite);
              }}
              .shell {{
                max-width: 1280px;
                margin: 0 auto;
                padding: 24px;
              }}
              .topbar {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                padding: 18px 22px;
                border-radius: 24px;
                background: var(--navy-950);
                color: var(--white);
              }}
              .brand {{
                display: flex;
                align-items: center;
                gap: 16px;
                flex-wrap: wrap;
              }}
              .brand img {{
                display: block;
                max-height: 52px;
                width: auto;
              }}
              .brand small {{
                opacity: 0.86;
                font-size: 0.94rem;
              }}
              .nav {{
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
              }}
              .nav a {{
                color: var(--white);
                text-decoration: none;
                padding: 10px 14px;
                border-radius: 999px;
                background: rgba(255,255,255,0.08);
              }}
              .hero {{
                margin-top: 20px;
                padding: 28px;
                border-radius: 24px;
                background: linear-gradient(135deg, var(--navy-900), var(--navy-800));
                color: var(--white);
              }}
              .hero h1 {{ margin: 0 0 10px; font-size: clamp(2rem, 4vw, 3.2rem); }}
              .hero p {{ margin: 0; max-width: 760px; line-height: 1.8; }}
              .badge-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 14px;
                margin-top: 22px;
              }}
              .badge {{
                padding: 16px;
                border-radius: 18px;
                background: rgba(255,255,255,0.08);
                border: 1px solid rgba(255,255,255,0.12);
              }}
              .badge strong {{
                display: block;
                margin-top: 8px;
                color: var(--yolk-500);
                font-size: 1.18rem;
              }}
              .section {{
                margin-top: 22px;
                padding: 24px;
                border-radius: 24px;
                background: var(--white);
                box-shadow: 0 12px 30px rgba(11,20,53,0.08);
              }}
              .section h2 {{ margin: 0 0 8px; color: var(--navy-950); }}
              .section p {{ margin: 0 0 18px; color: var(--text-muted); line-height: 1.75; }}
              .podium-grid, .tier-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 16px;
              }}
              .podium-card, .tier-card {{
                padding: 20px;
                border-radius: 20px;
                border: 1px solid var(--border-light);
                background: var(--off-white);
              }}
              .podium-card--1 {{
                background: linear-gradient(180deg, rgba(255,214,41,0.24), rgba(255,255,255,0.92));
              }}
              .podium-place, .tier-threshold {{
                font-weight: 800;
                color: var(--navy-950);
              }}
              .podium-card h3, .tier-card h3 {{
                margin: 12px 0 8px;
                color: var(--navy-950);
              }}
              .podium-amount {{
                color: var(--navy-900);
                font-size: 1.5rem;
                font-weight: 800;
              }}
              .podium-meta, .tier-meta {{
                margin-top: 8px;
                color: var(--graphite);
                line-height: 1.7;
              }}
              .legal {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 16px;
              }}
              .legal article {{
                padding: 18px;
                border-radius: 18px;
                background: var(--off-white);
                border: 1px solid var(--border-light);
              }}
              .legal h3 {{ margin-top: 0; color: var(--navy-950); }}
              .legal ul {{ margin: 0; padding-inline-start: 18px; line-height: 1.8; }}
              @media (max-width: 768px) {{
                .shell {{ padding: 16px; }}
                .topbar {{ padding: 16px; }}
              }}
            </style>
          </head>
          <body>
            <div class="shell">
              <header class="topbar">
                <div class="brand">
                  <img src="{campaign_logo_data_uri}" alt="לוגו עושים טוב בצהוב" />
                  <img src="{org_logo_data_uri}" alt="לוגו אחים לסמל" />
                  <small>דשבורד ציבורי למשתתפים וצופים | גישת מנהלים דרך כניסה נפרדת</small>
                </div>
                <nav class="nav">
                  <a href="#podium">מובילים וזוכים</a>
                  <a href="#tiers">מדרגות פרס</a>
                  <a href="#rules">תקנון</a>
                  <a href="#privacy">פרטיות</a>
                  <a href="/admin">כניסת מנהלים</a>
                </nav>
              </header>

              <section class="hero">
                <h1>הזוכים והמובילים של עושים טוב בצהוב</h1>
                <p>תצוגה ציבורית נקייה ומעודכנת של מצב הקמפיין. הדשבורד הניהולי המלא זמין למנהלים מורשים בלבד, בעוד שכאן מוצגים נתוני סיכום ותחרות ללא חשיפת רשומות תורמים.</p>
                <div class="badge-grid">
                  <div class="badge">חלון פרויקט<strong>{snapshot['projectWindowLabel'] or "לא זוהה"}</strong></div>
                  <div class="badge">סך גיוס<strong>{format_amount(snapshot['totalRaised'])}</strong></div>
                  <div class="badge">שגרירים פעילים<strong>{snapshot['activeAmbassadors']}</strong></div>
                  <div class="badge">עדכון אחרון<strong>{format_datetime(snapshot['latestCreated'])}</strong></div>
                </div>
              </section>

              <section id="podium" class="section">
                <h2>פודיום מובילים</h2>
                <p>שלושת המקומות הראשונים נכון לקובץ הפעיל.</p>
                <div class="podium-grid">{podium_html}</div>
              </section>

              <section id="tiers" class="section">
                <h2>מדרגות פרס</h2>
                <p>תמונת מצב חגיגית ונקייה של מדרגות הפרסים, עם ספירת זכאים וקרובים להשגה.</p>
                <div class="tier-grid">{tier_html}</div>
              </section>

              <section id="rules" class="section">
                <h2>תקנון השתתפות</h2>
                <div class="legal">
                  <article>
                    <h3>עקרונות בסיס</h3>
                    <ul>
                      <li>ההשתתפות כפופה לרישום כשגריר או שגרירה לפי כללי הקמפיין.</li>
                      <li>רק עסקאות שנקלטו ושויכו כדין נחשבות לתחרות ולפרסים.</li>
                      <li>הנהלת הקמפיין רשאית לבצע בקרה, תיקון והחרגת רשומות חריגות.</li>
                    </ul>
                  </article>
                  <article>
                    <h3>חישוב זכאות</h3>
                    <ul>
                      <li>הזכאות לפרסים נקבעת לפי נתוני המערכת הפעילה והקובץ האחרון שאושר.</li>
                      <li>מדרגות פרס משודרגות בהתאם לספי הגיוס שהוגדרו.</li>
                      <li>במקרה של שוויון או חריגה, הנהלת הקמפיין תכריע לפי כללי הבקרה.</li>
                    </ul>
                  </article>
                </div>
              </section>

              <section id="privacy" class="section">
                <h2>מדיניות פרטיות</h2>
                <div class="legal">
                  <article>
                    <h3>מידע ותכלית שימוש</h3>
                    <ul>
                      <li>התצוגה הציבורית אינה כוללת נתוני תורמים ברמת רשומה.</li>
                      <li>המערכת הניהולית מיועדת למנהלים מורשים בלבד.</li>
                      <li>המידע משמש לצורכי ניהול קמפיין, פרסים, בקרה ותובנות.</li>
                    </ul>
                  </article>
                  <article>
                    <h3>שמירה ואבטחה</h3>
                    <ul>
                      <li>לפני עליה חיצונית יש להשלים אישור משפטי ואבטחת מידע.</li>
                      <li>יש להגדיר מדיניות שמירה, מחיקה, גיבוי והרשאות לפי תפקיד.</li>
                      <li>חיבור לשרת חי ולמקור נתונים קבוע יבוצע בשלב הבא של המוצר.</li>
                    </ul>
                  </article>
                </div>
              </section>
            </div>
          </body>
        </html>
        """
    ).strip()


def render_shell_output() -> bool:
    if not RENDER_SCRIPT.exists():
        return False

    subprocess.run(
        [
            str(PYTHON_EXE),
            str(RENDER_SCRIPT),
            str(FRAGMENT_PATH),
            str(OUTPUT_HTML),
        ],
        check=True,
    )
    return True


def main() -> None:
    rows = load_rows()
    meta = build_meta(rows)
    org_logo_data_uri = load_logo_data_uri(ORG_LOGO_PATH if ORG_LOGO_PATH.exists() else LEGACY_LOGO_PATH)
    campaign_logo_data_uri = load_logo_data_uri(CAMPAIGN_LOGO_PATH)
    backdrop_data_uri = load_logo_data_uri(BACKDROP_PATH)
    prize_model = load_prize_model()
    fragment = build_fragment(rows, meta, org_logo_data_uri, campaign_logo_data_uri, backdrop_data_uri, prize_model)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    VIS_DIR.mkdir(parents=True, exist_ok=True)
    FRAGMENT_PATH.write_text(fragment, encoding="utf-8")

    browser_document = build_browser_document(fragment)
    BROWSER_OUTPUT_HTML.write_text(browser_document, encoding="utf-8")

    if render_shell_output():
        export_browser_friendly_html()
    else:
        OUTPUT_HTML.write_text(browser_document, encoding="utf-8")


if __name__ == "__main__":
    main()
