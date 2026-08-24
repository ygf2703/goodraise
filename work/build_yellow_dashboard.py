from __future__ import annotations

import base64
import csv
import json
import mimetypes
import os
import re
import shutil
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
CONTENT_DIR = WORK_DIR / "content"
FRONTEND_DIR = WORK_DIR / "frontend"
SAMPLES_DIR = WORK_DIR / "samples"
SOURCE_CSV = Path(os.getenv("YELLOW_DASHBOARD_SOURCE_CSV", str(WORK_DIR / "source.csv"))).resolve()
SAMPLE_SOURCE_CSV = Path(os.getenv("YELLOW_DASHBOARD_SAMPLE_SOURCE_CSV", str(SAMPLES_DIR / "sample-source.csv"))).resolve()
PRIZES_XLSX = Path(os.getenv("YELLOW_DASHBOARD_PRIZES_XLSX", str(WORK_DIR / "prizes.xlsx"))).resolve()
PRIZES_CSV = Path(os.getenv("YELLOW_DASHBOARD_PRIZES_CSV", str(WORK_DIR / "prizes.csv"))).resolve()
ORG_LOGO_PATH = ASSETS_DIR / "achim-lasemel-logo.png"
CAMPAIGN_LOGO_PATH = ASSETS_DIR / "osim-tov-betzahov-logo.png"
BACKDROP_PATH = ASSETS_DIR / "dashboard-backdrop.png"
PROJECT_HERO_IMAGE_PATH = ASSETS_DIR / "campaign-project-hero.jpeg"
PROJECT_PAGE_CONTENT_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_PROJECT_PAGE_CONTENT_PATH", str(CONTENT_DIR / "project-page-default.md"))
).resolve()
FRONTEND_INTELLIGENCE_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_FRONTEND_INTELLIGENCE_PATH", str(FRONTEND_DIR / "goodraise-intelligence.js"))
).resolve()
LEGACY_LOGO_PATH = WORK_DIR / "brand-logo.png"
OUTPUTS_DIR = Path(os.getenv("YELLOW_DASHBOARD_OUTPUT_DIR", str(ROOT_DIR / "outputs"))).resolve()
NETLIFY_DATA_DIR = Path(os.getenv("YELLOW_DASHBOARD_NETLIFY_DATA_DIR", str(ROOT_DIR / "netlify" / "data"))).resolve()
ADMIN_DATASET_OUTPUT_PATH = Path(
    os.getenv("YELLOW_DASHBOARD_ADMIN_DATASET_OUTPUT_PATH", str(NETLIFY_DATA_DIR / "admin-dataset.json"))
).resolve()
VIS_DIR = Path(os.getenv("YELLOW_DASHBOARD_VIS_DIR", str(OUTPUTS_DIR / ".render-cache"))).resolve()
FRAGMENT_PATH = VIS_DIR / "yellow-project-dashboard-fragment.html"
OUTPUT_HTML = Path(os.getenv("YELLOW_DASHBOARD_OUTPUT_HTML", str(OUTPUTS_DIR / "yellow-project-dashboard.html"))).resolve()
BROWSER_OUTPUT_HTML = Path(
    os.getenv("YELLOW_DASHBOARD_BROWSER_OUTPUT_HTML", str(OUTPUTS_DIR / "yellow-project-dashboard-browser.html"))
).resolve()
INDEX_OUTPUT_HTML = Path(os.getenv("YELLOW_DASHBOARD_INDEX_OUTPUT_HTML", str(OUTPUTS_DIR / "index.html"))).resolve()
OUTPUT_ASSETS_DIR = OUTPUTS_DIR / "assets"
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


def get_source_label() -> str:
    source_path = get_source_csv_path()
    if source_path is None:
        return "קובץ בסיס"
    return source_path.name


def build_meta(rows: list[dict]) -> dict:
    unique_dates = sorted({row["date"] for row in rows})
    project_dates = unique_dates
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
        if not ambassador or ambassador == "ללא שיוך":
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


def build_public_rows(rows: list[dict]) -> list[dict]:
    public_rows: list[dict] = []
    for row in rows:
        public_rows.append(
            {
                "id": row.get("id", ""),
                "createdIso": row.get("createdIso", ""),
                "date": row.get("date", ""),
                "hour": row.get("hour", 0),
                "email": "",
                "donor": "מוסתר בצפייה ציבורית",
                "ambassador": row.get("ambassador", ""),
                "amount": row.get("amount", 0),
                "city": "",
                "status": row.get("status", ""),
                "chargeResult": "",
            }
        )
    return public_rows


def load_logo_data_uri(path: Path) -> str:
    if not path.exists():
        return ""
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def load_file_data_uri(path: Path) -> str:
    if not path.exists():
        return ""
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def emit_output_asset(source_path: Path, target_name: str) -> str:
    if not source_path.exists():
        return ""
    OUTPUT_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    target_path = OUTPUT_ASSETS_DIR / target_name
    shutil.copy2(source_path, target_path)
    return f"assets/{target_name}"


def load_markdown_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def load_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def build_default_campaign_page_settings(project_hero_url: str) -> dict:
    return {
        "projectDatesLabel": "23.08.2026–01.09.2026",
        "platformBaseUrl": "https://goodraise.netlify.app",
        "projectSlug": "campaign-2026",
        "eyebrow": "GoodRaise campaign",
        "title": "Campaign Title",
        "subtitle": "עדכנו את הטקסט, המדיה והמיתוג מתוך הגדרות הקמפיין כדי להתאים את עמוד הפרויקט לקמפיין הפעיל.",
        "storyMarkdown": load_markdown_text(PROJECT_PAGE_CONTENT_PATH),
        "primaryCtaLabel": "המשך לתרומה מאובטחת",
        "secondaryCtaLabel": "צפייה במובילים ובזוכים",
        "externalDonationUrl": "https://example.org/donate",
        "trustNote": "התשלום והסליקה יתבצעו אצל ספק חיצוני מאובטח. מסך זה מרכז את בחירת סכום התרומה ופרטי ההתקדמות בלבד.",
        "successHint": "לאחר לחיצה תועברו לעמוד התשלום של ספק התרומות החיצוני עם פרטי התרומה שבחרתם.",
        "mediaType": "image",
        "mediaUrl": project_hero_url,
        "mediaAlt": "Campaign hero media",
        "campaignLogoUrl": "",
        "organizationLogoUrl": "",
        "fontFamily": "Assistant",
        "theme": {
            "primary": "#111D4A",
            "secondary": "#24377C",
            "accent": "#FFD629",
            "surface": "#F6F7FA",
            "text": "#090B10",
        },
        "amountCards": [
            {"value": 54, "label": "תמיכה התחלתית", "description": "הצטרפות מיידית למאמץ הקהילתי של החג."},
            {"value": 100, "label": "מוצרים בסיסיים", "description": "מסייע/ת למימון פריטי מזון חיוניים למארז."},
            {"value": 180, "label": "מארז חג", "description": "תרומה בסכום קלאסי שמקדמת הכנת מארזי חג מלאים."},
            {"value": 360, "label": "כפול טוב", "description": "מרחיב/ה את היכולת להגיע ליותר משפחות בטווח קצר."},
            {"value": 500, "label": "חיזוק משמעותי", "description": "דוחף/ת את הקמפיין קדימה ותומך/ת בהיערכות הלוגיסטית."},
            {"value": 1000, "label": "שותפות מובילה", "description": "תרומה מרכזית שמקדמת גיוס, אריזה וחלוקה בפועל."},
        ],
        "stats": [
            {"value": "14", "label": "שנות עשייה"},
            {"value": "1,000+", "label": "מתנדבים באירוע האריזה"},
            {"value": "אלפים", "label": "מארזי חג בכל מבצע"},
        ],
        "showRecurring": True,
    }


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


def write_admin_dataset(rows: list[dict], meta: dict, source_label: str) -> None:
    ADMIN_DATASET_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ADMIN_DATASET_OUTPUT_PATH.write_text(
        json.dumps(
            {
                "rows": rows,
                "meta": meta,
                "sourceLabel": source_label,
                "generatedAt": datetime.now().isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def build_auth_config() -> dict:
    deploy_mode = (os.getenv("YELLOW_DASHBOARD_DEPLOY_MODE") or "").strip().lower()
    use_netlify_paths = deploy_mode == "netlify" or os.getenv("NETLIFY") == "true"
    if use_netlify_paths:
        base_url = (os.getenv("YELLOW_DASHBOARD_AUTH_BASE_URL") or "").strip().rstrip("/")
        prefix = f"{base_url}/api/auth" if base_url else "/api/auth"
        return {
            "mode": "backend",
            "baseUrl": base_url,
            "statusEndpoint": f"{prefix}/status",
            "loginEndpoint": f"{prefix}/login",
            "setupEndpoint": f"{prefix}/setup",
            "logoutEndpoint": f"{prefix}/logout",
            "resetEndpoint": "",
            "publicContextEndpoint": f"{base_url}/api/public-context" if base_url else "/api/public-context",
            "datasetEndpoint": f"{base_url}/api/admin/dataset" if base_url else "/api/admin/dataset",
            "campaignConfigEndpoint": f"{base_url}/api/admin/campaign-config" if base_url else "/api/admin/campaign-config",
            "sourceConfigEndpoint": f"{base_url}/api/admin/source-config" if base_url else "/api/admin/source-config",
            "sourceRefreshEndpoint": f"{base_url}/api/admin/source-refresh" if base_url else "/api/admin/source-refresh",
        }

    return {
        "mode": "backend",
        "baseUrl": os.getenv("YELLOW_DASHBOARD_AUTH_BASE_URL", "http://127.0.0.1:8767"),
        "statusEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_STATUS_ENDPOINT", "http://127.0.0.1:8767/api/auth/status"),
        "loginEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_LOGIN_ENDPOINT", "http://127.0.0.1:8767/api/auth/login"),
        "setupEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_SETUP_ENDPOINT", "http://127.0.0.1:8767/api/auth/setup"),
        "logoutEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_LOGOUT_ENDPOINT", "http://127.0.0.1:8767/api/auth/logout"),
        "resetEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_RESET_ENDPOINT", "http://127.0.0.1:8767/api/auth/reset-local"),
        "publicContextEndpoint": os.getenv("YELLOW_DASHBOARD_PUBLIC_CONTEXT_ENDPOINT", "http://127.0.0.1:8767/api/public-context"),
        "datasetEndpoint": os.getenv("YELLOW_DASHBOARD_AUTH_DATASET_ENDPOINT", "http://127.0.0.1:8767/api/admin/dataset"),
        "campaignConfigEndpoint": os.getenv("YELLOW_DASHBOARD_CAMPAIGN_CONFIG_ENDPOINT", "http://127.0.0.1:8767/api/admin/campaign-config"),
        "sourceConfigEndpoint": os.getenv("YELLOW_DASHBOARD_SOURCE_CONFIG_ENDPOINT", "http://127.0.0.1:8767/api/admin/source-config"),
        "sourceRefreshEndpoint": os.getenv("YELLOW_DASHBOARD_SOURCE_REFRESH_ENDPOINT", "http://127.0.0.1:8767/api/admin/source-refresh"),
    }


def build_fragment(
    rows: list[dict],
    meta: dict,
    source_label: str,
    org_logo_data_uri: str,
    campaign_logo_data_uri: str,
    backdrop_url: str,
    prize_model: dict,
    campaign_page_settings: dict,
) -> str:
    rows_json = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    meta_json = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
    source_label_json = json.dumps(source_label, ensure_ascii=False)
    org_logo_json = json.dumps(org_logo_data_uri, ensure_ascii=False)
    campaign_logo_json = json.dumps(campaign_logo_data_uri, ensure_ascii=False)
    backdrop_json = json.dumps(backdrop_url, ensure_ascii=False)
    prize_json = json.dumps(prize_model, ensure_ascii=False, separators=(",", ":"))
    campaign_page_settings_json = json.dumps(campaign_page_settings, ensure_ascii=False, separators=(",", ":"))
    auth_config_json = json.dumps(build_auth_config(), ensure_ascii=False, separators=(",", ":"))
    intelligence_module = load_text(FRONTEND_INTELLIGENCE_PATH).strip()

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

            #yellow-dashboard-root [hidden] {
              display: none !important;
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
              position: relative;
              z-index: 20;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-5);
              padding: var(--space-4) var(--space-5);
              background: linear-gradient(135deg, var(--topbar-primary, rgba(11, 20, 53, 0.96)), var(--topbar-secondary, rgba(36, 55, 124, 0.94)));
              border-color: color-mix(in srgb, var(--topbar-accent, #FFD629) 22%, transparent);
              backdrop-filter: blur(14px);
            }

            #yellow-dashboard-root .brand-header::after {
              content: "";
              position: absolute;
              inset-inline: var(--space-5);
              inset-block-end: 0;
              height: 1px;
              background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--topbar-accent, #FFD629) 72%, transparent), transparent);
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
              background: color-mix(in srgb, var(--topbar-accent, #FFD629) 40%, rgba(255, 255, 255, 0.24));
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
              max-width: 9ch;
              font-size: clamp(2.1rem, 3.5vw, 3.6rem);
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
              left: max(-4%, -42px);
              right: auto;
              top: 50%;
              transform: translateY(-50%);
              width: clamp(460px, 52vw, 920px);
              max-width: 56%;
              opacity: 0.03;
              pointer-events: none;
              z-index: 0;
            }

            #yellow-dashboard-root .public-hero-watermark img {
              width: 100%;
              height: auto;
              display: block;
              object-fit: contain;
            }

            #yellow-dashboard-root .public-badges {
              display: block;
              width: 100%;
            }

            #yellow-dashboard-root .public-snapshot-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              align-items: stretch;
              gap: var(--space-3);
              margin-top: var(--space-2);
              width: 100%;
            }

            #yellow-dashboard-root .public-snapshot-card {
              display: grid;
              gap: var(--space-2);
              min-height: 150px;
              padding: 1.05rem 1.1rem;
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
              grid-column: span 1;
            }

            #yellow-dashboard-root .public-snapshot-label {
              color: rgba(255, 255, 255, 0.7);
              font-size: 0.88rem;
              font-weight: 600;
            }

            #yellow-dashboard-root .public-snapshot-value {
              color: var(--white);
              font-size: clamp(1.25rem, 1.8vw, 1.9rem);
              font-weight: 800;
              line-height: 1.15;
              font-variant-numeric: tabular-nums;
            }

            #yellow-dashboard-root .public-snapshot-card--primary .public-snapshot-value {
              color: var(--yolk-200);
              font-size: clamp(1.7rem, 2.6vw, 2.45rem);
            }

            #yellow-dashboard-root .public-snapshot-meta {
              color: rgba(255, 255, 255, 0.82);
              font-size: 0.9rem;
              line-height: 1.45;
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

            #yellow-dashboard-root .project-stage,
            #yellow-dashboard-root .project-landing {
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .project-landing {
              --campaign-page-primary: var(--navy-900);
              --campaign-page-secondary: var(--navy-700);
              --campaign-page-accent: var(--yolk-500);
              --campaign-page-surface: var(--off-white);
              --campaign-page-text: var(--black);
              font-family: "Assistant", Arial, sans-serif;
            }

            #yellow-dashboard-root .project-hero {
              position: relative;
              overflow: hidden;
              padding: clamp(24px, 4vw, 42px);
              border-radius: var(--radius-xl);
              background:
                linear-gradient(135deg, color-mix(in srgb, var(--campaign-page-primary) 94%, black 6%), color-mix(in srgb, var(--campaign-page-secondary) 90%, black 10%)),
                var(--campaign-page-primary);
            }

            #yellow-dashboard-root .project-hero::after {
              content: "";
              position: absolute;
              inset: auto -6% -18% auto;
              width: min(36vw, 380px);
              aspect-ratio: 1 / 1;
              border-radius: 999px;
              background: radial-gradient(circle, rgba(255, 214, 41, 0.22), rgba(255, 214, 41, 0));
              pointer-events: none;
            }

            #yellow-dashboard-root .project-hero-grid {
              position: relative;
              z-index: 1;
              display: grid;
              grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.88fr);
              gap: var(--space-6);
              align-items: center;
            }

            #yellow-dashboard-root .project-hero-copy {
              display: grid;
              gap: var(--space-4);
              color: var(--white);
            }

            #yellow-dashboard-root .project-kicker {
              display: inline-flex;
              align-items: center;
              width: fit-content;
              padding: 7px 16px;
              border-radius: 999px;
              background: rgba(255, 214, 41, 0.14);
              color: var(--yolk-200);
              font-size: 0.92rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .project-title {
              margin: 0;
              font-size: clamp(2.2rem, 4.7vw, 4.35rem);
              line-height: 0.96;
              letter-spacing: -0.03em;
              font-weight: 800;
            }

            #yellow-dashboard-root .project-subtitle {
              margin: 0;
              max-width: 70ch;
              font-size: clamp(1.02rem, 1.5vw, 1.22rem);
              line-height: 1.9;
              color: rgba(255, 255, 255, 0.92);
            }

            #yellow-dashboard-root .project-hero-actions,
            #yellow-dashboard-root .donation-frequency,
            #yellow-dashboard-root .project-trust-list {
              display: flex;
              flex-wrap: wrap;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .project-stat-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: var(--space-3);
            }

            #yellow-dashboard-root .project-stat-card {
              padding: 16px 18px;
              border-radius: var(--radius-md);
              background: rgba(255, 255, 255, 0.08);
              border: 1px solid rgba(255, 255, 255, 0.08);
              backdrop-filter: blur(12px);
            }

            #yellow-dashboard-root .project-stat-value {
              font-size: clamp(1.4rem, 2vw, 2rem);
              font-weight: 800;
              color: var(--white);
            }

            #yellow-dashboard-root .project-stat-label {
              margin-top: 4px;
              font-size: 0.92rem;
              color: rgba(255, 255, 255, 0.78);
            }

            #yellow-dashboard-root .project-progress {
              display: grid;
              gap: 10px;
              padding: 16px 18px;
              border-radius: var(--radius-md);
              background: rgba(9, 11, 16, 0.22);
              border: 1px solid rgba(255, 255, 255, 0.08);
            }

            #yellow-dashboard-root .project-progress-track {
              height: 12px;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.12);
              overflow: hidden;
            }

            #yellow-dashboard-root .project-progress-bar {
              height: 100%;
              border-radius: inherit;
              background: linear-gradient(90deg, var(--campaign-page-accent), color-mix(in srgb, var(--campaign-page-accent) 72%, white 28%));
            }

            #yellow-dashboard-root .project-progress-meta {
              display: flex;
              flex-wrap: wrap;
              gap: var(--space-3);
              justify-content: space-between;
              color: rgba(255, 255, 255, 0.88);
              font-size: 0.94rem;
            }

            #yellow-dashboard-root .project-media-frame {
              position: relative;
              aspect-ratio: 16 / 9;
              border-radius: calc(var(--radius-xl) + 6px);
              overflow: hidden;
              background: rgba(255, 255, 255, 0.08);
              border: 1px solid rgba(255, 255, 255, 0.12);
              box-shadow: 0 26px 64px rgba(7, 13, 36, 0.32);
            }

            #yellow-dashboard-root .project-media,
            #yellow-dashboard-root .project-media-frame img,
            #yellow-dashboard-root .project-media-frame video {
              width: 100%;
              height: 100%;
              object-fit: contain;
              display: block;
            }

            #yellow-dashboard-root .project-media-badge {
              position: absolute;
              inset: 18px 18px auto auto;
              z-index: 1;
              padding: 8px 14px;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.9);
              color: var(--campaign-page-primary);
              font-size: 0.9rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .project-body-grid {
              display: grid;
              grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.82fr);
              gap: var(--space-5);
              align-items: start;
            }

            #yellow-dashboard-root .project-story-panel,
            #yellow-dashboard-root .donation-panel,
            #yellow-dashboard-root .campaign-settings-panel {
              padding: clamp(22px, 3vw, 32px);
              border-radius: var(--radius-lg);
            }

            #yellow-dashboard-root .project-story-content {
              color: var(--campaign-page-text);
              line-height: 1.95;
              font-size: 1.02rem;
            }

            #yellow-dashboard-root .project-story-content h2,
            #yellow-dashboard-root .project-story-content h3 {
              margin: 0 0 var(--space-3);
              color: var(--navy-900);
            }

            #yellow-dashboard-root .project-story-content p {
              margin: 0 0 var(--space-4);
            }

            #yellow-dashboard-root .project-story-content strong {
              color: var(--navy-900);
            }

            #yellow-dashboard-root .donation-panel {
              position: sticky;
              top: 18px;
              display: grid;
              gap: var(--space-4);
              background: linear-gradient(180deg, var(--white), color-mix(in srgb, var(--campaign-page-surface) 92%, white 8%));
            }

            #yellow-dashboard-root .donation-stepper {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: var(--space-2);
            }

            #yellow-dashboard-root .donation-step {
              display: grid;
              gap: 4px;
              padding: 12px 14px;
              border-radius: var(--radius-md);
              background: linear-gradient(180deg, rgba(17, 29, 74, 0.05), rgba(17, 29, 74, 0.025));
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .donation-step-index {
              color: var(--navy-700);
              font-size: 0.8rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .donation-step-title {
              color: var(--navy-900);
              font-size: 0.96rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .donation-step-meta {
              color: var(--text-muted);
              font-size: 0.84rem;
              line-height: 1.45;
            }

            #yellow-dashboard-root .donation-impact {
              display: grid;
              gap: var(--space-3);
              padding: 18px;
              border-radius: var(--radius-lg);
              background: linear-gradient(180deg, rgba(255, 214, 41, 0.18), rgba(255, 214, 41, 0.08));
              border: 1px solid rgba(244, 201, 0, 0.3);
            }

            #yellow-dashboard-root .donation-impact-head {
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .donation-impact-kicker {
              color: var(--navy-700);
              font-size: 0.82rem;
              font-weight: 800;
              letter-spacing: 0.02em;
            }

            #yellow-dashboard-root .donation-impact-value {
              color: var(--navy-1000);
              font-size: clamp(1.7rem, 2.2vw, 2.35rem);
              font-weight: 800;
            }

            #yellow-dashboard-root .donation-impact-title {
              color: var(--navy-900);
              font-size: 1.04rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .donation-impact-description {
              color: var(--graphite);
              font-size: 0.95rem;
              line-height: 1.7;
            }

            #yellow-dashboard-root .donation-frequency-button,
            #yellow-dashboard-root .amount-card,
            #yellow-dashboard-root .project-trust-chip {
              border: 1px solid rgba(17, 29, 74, 0.12);
              background: var(--white);
              transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
            }

            #yellow-dashboard-root .donation-frequency-button {
              padding: 10px 16px;
              border-radius: 999px;
              font: inherit;
              font-weight: 700;
              color: var(--navy-900);
              cursor: pointer;
            }

            #yellow-dashboard-root .donation-frequency-button.is-active {
              background: var(--navy-900);
              color: var(--yolk-500);
              border-color: var(--navy-900);
            }

            #yellow-dashboard-root .amount-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: var(--space-3);
            }

            #yellow-dashboard-root .amount-card {
              display: grid;
              gap: 6px;
              padding: 16px 16px 14px;
              border-radius: var(--radius-md);
              text-align: right;
              cursor: pointer;
            }

            #yellow-dashboard-root .amount-card:hover,
            #yellow-dashboard-root .amount-card.is-active,
            #yellow-dashboard-root .donation-frequency-button:hover,
            #yellow-dashboard-root .project-trust-chip:hover {
              transform: translateY(-1px);
              border-color: color-mix(in srgb, var(--campaign-page-accent) 56%, var(--navy-900) 44%);
              box-shadow: 0 14px 30px rgba(17, 29, 74, 0.1);
            }

            #yellow-dashboard-root .amount-card.is-active {
              background: linear-gradient(180deg, color-mix(in srgb, var(--campaign-page-accent) 18%, white 82%), white);
            }

            #yellow-dashboard-root .amount-card-value {
              color: var(--navy-900);
              font-size: 1.42rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .amount-card-label {
              color: var(--navy-900);
              font-size: 0.98rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .amount-card-description {
              color: var(--text-muted);
              font-size: 0.88rem;
              line-height: 1.55;
            }

            #yellow-dashboard-root .donation-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: var(--space-3);
            }

            #yellow-dashboard-root .donation-grid .form-label--full {
              grid-column: 1 / -1;
            }

            #yellow-dashboard-root .donation-summary {
              display: grid;
              gap: 10px;
              padding: 16px 18px;
              border-radius: var(--radius-md);
              background: color-mix(in srgb, var(--campaign-page-primary) 6%, white 94%);
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .donation-summary strong {
              color: var(--navy-900);
            }

            #yellow-dashboard-root .project-trust-chip {
              display: inline-flex;
              align-items: center;
              padding: 8px 12px;
              border-radius: 999px;
              color: var(--navy-900);
              font-size: 0.88rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .donation-flow-note {
              padding: 12px 14px;
              border-radius: var(--radius-md);
              background: color-mix(in srgb, var(--campaign-page-accent) 16%, white 84%);
              border-inline-start: 4px solid var(--campaign-page-accent);
              color: var(--navy-900);
              font-size: 0.93rem;
              line-height: 1.7;
            }

            #yellow-dashboard-root .donation-feedback {
              min-height: 24px;
              font-size: 0.92rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .donation-feedback.is-error {
              color: #7b2f18;
            }

            #yellow-dashboard-root .donation-feedback.is-success {
              color: #14532d;
            }

            #yellow-dashboard-root .campaign-settings-panel {
              display: grid;
              gap: var(--space-5);
            }

            #yellow-dashboard-root .campaign-settings-grid,
            #yellow-dashboard-root .settings-inline-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: var(--space-4);
            }

            #yellow-dashboard-root .settings-inline-grid--three {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }

            #yellow-dashboard-root .settings-panel-note {
              padding: 12px 14px;
              border-radius: var(--radius-md);
              background: color-mix(in srgb, var(--yolk-200) 76%, white 24%);
              color: var(--navy-900);
              font-size: 0.92rem;
              line-height: 1.7;
            }

            #yellow-dashboard-root .settings-textarea {
              min-height: 160px;
              resize: vertical;
            }

            #yellow-dashboard-root .settings-actions {
              display: flex;
              flex-wrap: wrap;
              gap: var(--space-3);
              align-items: center;
              justify-content: space-between;
            }

            #yellow-dashboard-root .settings-status {
              color: var(--text-muted);
              font-size: 0.9rem;
              line-height: 1.6;
            }

            #yellow-dashboard-root .settings-status[data-tone="success"] {
              color: #14532d;
            }

            #yellow-dashboard-root .settings-status[data-tone="warning"] {
              color: var(--navy-900);
            }

            #yellow-dashboard-root .settings-status[data-tone="error"] {
              color: #7c2d12;
            }

            #yellow-dashboard-root .settings-media-preview {
              display: grid;
              gap: var(--space-3);
              padding: 16px;
              border-radius: var(--radius-md);
              background: linear-gradient(180deg, rgba(17, 29, 74, 0.04), rgba(17, 29, 74, 0.02));
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .settings-media-preview-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-3);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .settings-media-preview-label {
              color: var(--navy-950);
              font-size: 0.92rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .settings-media-preview-meta {
              color: var(--text-muted);
              font-size: 0.82rem;
            }

            #yellow-dashboard-root .settings-media-preview-frame {
              position: relative;
              aspect-ratio: 16 / 9;
              display: grid;
              place-items: center;
              overflow: hidden;
              border-radius: var(--radius-md);
              background: linear-gradient(135deg, rgba(17, 29, 74, 0.92), rgba(36, 55, 124, 0.82));
              border: 1px solid rgba(17, 29, 74, 0.12);
            }

            #yellow-dashboard-root .settings-media-preview-frame img,
            #yellow-dashboard-root .settings-media-preview-frame video {
              display: block;
              width: 100%;
              height: 100%;
              object-fit: contain;
            }

            #yellow-dashboard-root .settings-media-preview-placeholder {
              padding: 24px;
              color: rgba(255, 255, 255, 0.88);
              font-size: 0.94rem;
              text-align: center;
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

            #yellow-dashboard-root .admin-tabs-shell {
              display: grid;
              gap: var(--space-4);
              padding: var(--space-4) var(--space-5);
            }

            #yellow-dashboard-root .admin-tabs-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-4);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root .admin-tabs-copy {
              display: grid;
              gap: var(--space-1);
            }

            #yellow-dashboard-root .admin-tabs-copy h3 {
              margin: 0;
              color: var(--navy-950);
              font-size: 1.18rem;
              font-weight: 700;
            }

            #yellow-dashboard-root .admin-tabs-copy p {
              margin: 0;
              color: var(--text-muted);
              font-size: 0.92rem;
            }

            #yellow-dashboard-root .admin-tabbar {
              display: inline-flex;
              align-items: center;
              gap: var(--space-2);
              padding: 6px;
              border-radius: 999px;
              background: rgba(17, 29, 74, 0.06);
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .admin-tab-button {
              border: 0;
              border-radius: 999px;
              padding: 0.8rem 1.15rem;
              background: transparent;
              color: var(--navy-900);
              font: inherit;
              font-weight: 700;
              cursor: pointer;
              transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
            }

            #yellow-dashboard-root .admin-tab-button.is-active {
              background: var(--navy-950);
              color: var(--yolk-200);
              box-shadow: 0 10px 22px rgba(11, 20, 53, 0.14);
            }

            #yellow-dashboard-root .admin-tab-panel[hidden] {
              display: none !important;
            }

            #yellow-dashboard-root .admin-overview-grid {
              grid-template-columns: minmax(0, 1fr);
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

            #yellow-dashboard-root .daily-winners-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
              gap: var(--space-4);
            }

            #yellow-dashboard-root .daily-winners-table-wrap {
              overflow-x: auto;
              border: 1px solid rgba(17, 29, 74, 0.1);
              border-radius: var(--radius-lg);
              background: var(--white);
            }

            #yellow-dashboard-root .daily-winners-table {
              width: 100%;
              min-width: 760px;
              border-collapse: collapse;
              font-variant-numeric: tabular-nums;
            }

            #yellow-dashboard-root .daily-winners-table th,
            #yellow-dashboard-root .daily-winners-table td {
              padding: 0.85rem 1rem;
              text-align: right;
              border-bottom: 1px solid rgba(17, 29, 74, 0.08);
              vertical-align: middle;
            }

            #yellow-dashboard-root .daily-winners-table th {
              color: var(--navy-950);
              background: rgba(17, 29, 74, 0.045);
              font-size: 0.86rem;
              font-weight: 800;
              white-space: nowrap;
            }

            #yellow-dashboard-root .daily-winners-table tbody tr:nth-child(even) {
              background: rgba(246, 247, 250, 0.72);
            }

            #yellow-dashboard-root .daily-winners-table tbody tr:hover {
              background: rgba(255, 242, 173, 0.28);
            }

            #yellow-dashboard-root .daily-winners-table tbody tr:last-child td {
              border-bottom: 0;
            }

            #yellow-dashboard-root .daily-winner-deals {
              display: block;
              margin-top: 2px;
              color: var(--text-muted);
              font-size: 0.82rem;
              font-weight: 500;
            }

            #yellow-dashboard-root .daily-winner-status {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 0.35rem 0.62rem;
              border-radius: 999px;
              background: var(--navy-950);
              color: var(--yolk-500);
              font-size: 0.82rem;
              font-weight: 800;
              white-space: nowrap;
            }

            #yellow-dashboard-root .daily-winner-status.is-pending {
              background: rgba(17, 29, 74, 0.08);
              color: var(--text-muted);
            }

            #yellow-dashboard-root .prize-page-layout {
              display: grid;
              grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
              gap: var(--space-5);
              align-items: start;
            }

            #yellow-dashboard-root .prize-ambassador-sidebar {
              position: sticky;
              top: calc(var(--space-5) + 76px);
              display: grid;
              gap: var(--space-3);
              padding: var(--space-4);
              border: 1px solid var(--border-light);
              border-radius: var(--radius-lg);
              background: rgba(246, 247, 250, 0.92);
            }

            #yellow-dashboard-root .prize-directory-head {
              display: grid;
              gap: var(--space-1);
            }

            #yellow-dashboard-root .prize-directory-head h4 {
              margin: 0;
              color: var(--navy-950);
              font-size: 1.08rem;
            }

            #yellow-dashboard-root .prize-directory-search {
              inline-size: 100%;
              min-height: 42px;
              padding: 0.55rem 0.75rem;
              border: 1px solid var(--border-light);
              border-radius: var(--radius-sm);
              background: var(--white);
              color: var(--graphite);
              font: inherit;
            }

            #yellow-dashboard-root .prize-directory-search:focus-visible {
              outline: 3px solid rgba(255, 214, 41, 0.55);
              outline-offset: 2px;
              border-color: var(--navy-700);
            }

            #yellow-dashboard-root .prize-directory-list {
              display: grid;
              gap: var(--space-2);
              max-block-size: min(62vh, 720px);
              overflow: auto;
              padding-inline-end: var(--space-1);
            }

            #yellow-dashboard-root .prize-directory-item {
              display: grid;
              grid-template-columns: auto minmax(0, 1fr) auto;
              gap: var(--space-2);
              align-items: center;
              padding: 0.7rem 0.75rem;
              border: 1px solid rgba(17, 29, 74, 0.08);
              border-radius: var(--radius-md);
              background: var(--white);
            }

            #yellow-dashboard-root .prize-directory-rank {
              min-inline-size: 27px;
              color: var(--navy-700);
              font-size: 0.84rem;
              font-weight: 800;
              font-variant-numeric: tabular-nums;
            }

            #yellow-dashboard-root .prize-directory-name {
              overflow: hidden;
              color: var(--navy-950);
              font-weight: 700;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            #yellow-dashboard-root .prize-directory-amount {
              color: var(--navy-900);
              font-size: 0.93rem;
              font-weight: 800;
              font-variant-numeric: tabular-nums;
              white-space: nowrap;
            }

            #yellow-dashboard-root .daily-winner-card {
              display: grid;
              gap: var(--space-3);
              padding: var(--space-4);
              border-radius: var(--radius-lg);
              background: rgba(17, 29, 74, 0.04);
              border: 1px solid rgba(17, 29, 74, 0.08);
            }

            #yellow-dashboard-root .daily-winner-head {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-3);
            }

            #yellow-dashboard-root .daily-winner-day {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              min-width: 74px;
              padding: 0.42rem 0.72rem;
              border-radius: 999px;
              background: var(--navy-950);
              color: var(--yolk-500);
              font-size: 0.9rem;
              font-weight: 800;
            }

            #yellow-dashboard-root .daily-winner-date {
              color: var(--text-muted);
              font-size: 0.9rem;
              font-weight: 600;
            }

            #yellow-dashboard-root .daily-winner-name {
              color: var(--navy-950);
              font-size: 1.08rem;
              font-weight: 800;
              line-height: 1.3;
            }

            #yellow-dashboard-root .daily-winner-amount {
              color: var(--navy-900);
              font-size: 1.2rem;
              font-weight: 800;
              font-variant-numeric: tabular-nums;
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
              position: relative;
              z-index: 0;
              padding: var(--space-6);
              border-radius: var(--radius-xl);
              display: grid;
              gap: var(--space-5);
              pointer-events: none;
            }

            #yellow-dashboard-root .login-logo-frame {
              min-height: 96px;
            }

            #yellow-dashboard-root .login-card {
              position: relative;
              z-index: 1;
              isolation: isolate;
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

            #yellow-dashboard-root .login-actions {
              position: relative;
              z-index: 4;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: var(--space-3);
              flex-wrap: wrap;
            }

            #yellow-dashboard-root #login-button,
            #yellow-dashboard-root #login-reset-button {
              position: relative;
              z-index: 5;
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
                grid-column: span 1;
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

              #yellow-dashboard-root .project-hero-grid,
              #yellow-dashboard-root .project-body-grid {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .project-media-frame {
                aspect-ratio: 16 / 9;
              }

              #yellow-dashboard-root .donation-panel {
                position: static;
              }

              #yellow-dashboard-root .public-hero-watermark {
                left: -6%;
                right: auto;
                width: clamp(280px, 40vw, 460px);
                max-width: 44%;
                opacity: 0.022;
              }

              #yellow-dashboard-root .filters-grid,
              #yellow-dashboard-root .filters-grid.filters-grid--three {
                grid-template-columns: repeat(2, minmax(0, 1fr));
              }

              #yellow-dashboard-root .podium-grid {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .prize-page-layout {
                grid-template-columns: 1fr;
              }

              #yellow-dashboard-root .prize-ambassador-sidebar {
                position: static;
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

              #yellow-dashboard-root .project-stat-grid,
              #yellow-dashboard-root .donation-stepper,
              #yellow-dashboard-root .amount-grid,
              #yellow-dashboard-root .donation-grid,
              #yellow-dashboard-root .campaign-settings-grid,
              #yellow-dashboard-root .settings-inline-grid,
              #yellow-dashboard-root .settings-inline-grid--three {
                grid-template-columns: 1fr;
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
                  <button class="nav-button" type="button" data-page-target="project">דף הפרויקט</button>
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
                  <img id="topbar-campaign-logo" class="topbar-campaign-logo" alt="לוגו הקמפיין" />
                  <span class="brand-divider" aria-hidden="true"></span>
                  <img id="topbar-logo" class="topbar-logo" alt="לוגו הארגון" />
                </div>
                <div id="topbar-meta" class="topbar-meta" hidden>
                  <div id="topbar-title" class="topbar-title">מערכת ניהול קמפיין</div>
                </div>
              </div>
            </header>

            <main class="app-content">
              <section id="page-project" class="page-shell is-active">
                <div id="project-page-root" class="project-stage"></div>
              </section>

              <section id="page-prizes" class="page-shell">
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
                    <h3>פודיום, מדרגות פרס ומצב אמת</h3>
                    <div id="prize-summary" class="text-small text-muted"></div>
                  </div>
                  <div class="prize-page-layout">
                    <div id="prize-board" class="prize-shell"></div>
                    <aside class="prize-ambassador-sidebar" aria-label="דירוג שגרירים">
                      <div class="prize-directory-head">
                        <h4>דירוג שגרירים</h4>
                        <div class="text-small text-muted">מוצגים שגרירים עם גיוס של ₪20 ומעלה.</div>
                      </div>
                      <label class="visually-hidden" for="prize-ambassador-search">חיפוש שגריר/ה לפי שם</label>
                      <input id="prize-ambassador-search" class="prize-directory-search" type="search" placeholder="חיפוש לפי שם" autocomplete="off" />
                      <div id="prize-ambassador-directory" class="prize-directory-list" aria-live="polite"></div>
                    </aside>
                  </div>
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
                          <div class="text-small text-muted">כניסה באמצעות מייל מורשה מראש. אם זו כניסה ראשונה, המערכת תעבור אוטומטית להגדרת סיסמה.</div>
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
                        <div id="login-password-setup-note" class="text-small text-muted" hidden style="display:none;">בכניסה ראשונה יש לבחור סיסמה באורך 8 תווים לפחות.</div>
                      </label>
                      <label id="login-password-confirm-label" class="form-label" hidden style="display:none;">
                        אימות סיסמה
                        <input id="login-password-confirm" class="form-control" type="password" autocomplete="new-password" placeholder="הקלד/י שוב את הסיסמה" />
                      </label>
                      <div class="login-actions">
                        <button id="login-button" class="button-primary action-button" type="submit">כניסה לפאנל הניהול</button>
                        <button id="login-reset-button" class="button-ghost" type="button">איפוס סיסמה</button>
                      </div>
                      <div id="login-mode-hint" class="text-small text-muted">הכניסה נשמרת ב-session מקומי מאובטח בשרת. בפריסה ציבורית יש להפעיל HTTPS וניהול secrets מסודר.</div>
                      <div id="login-message" class="login-message text-small" aria-live="polite"></div>
                    </form>
                  </div>
                </section>

                <div id="admin-content" class="admin-content" hidden>
                  <div class="dashboard-shell">
                    <section class="admin-tabs-shell app-card app-card--elevated">
                      <div class="admin-tabs-head">
                        <div class="admin-tabs-copy">
                          <h3>פאנל הניהול</h3>
                          <p>הפרדנו בין שכבת הניתוח והבקרה לבין שכבת עיצוב דף הפרויקט, כדי שהעבודה תהיה ממוקדת וברורה יותר.</p>
                        </div>
                        <div class="admin-tabbar" role="tablist" aria-label="לשוניות ניהול">
                          <button class="admin-tab-button is-active" type="button" role="tab" aria-selected="true" data-admin-tab-target="insights">בקרה ותובנות</button>
                          <button class="admin-tab-button" type="button" role="tab" aria-selected="false" data-admin-tab-target="design">עיצוב ומדיה</button>
                        </div>
                      </div>
                    </section>

                    <div id="admin-tab-panel-insights" class="admin-tab-panel">
                      <section class="admin-overview-grid">
                        <article class="brand-command app-card app-card--dark">
                          <div class="brand-command-head">
                            <div class="brand-copy">
                              <span class="brand-kicker">Executive campaign operations</span>
                              <h1 class="hero-title">מרכז השליטה של הקמפיין</h1>
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
                                  החלפת טבלת פרסים (אופציונלי)
                                  <input id="prize-upload" class="form-control" type="file" accept=".xlsx,.xls,.csv,text/csv" />
                                </label>
                              </div>
                              <div id="import-status" class="status-note text-small" aria-live="polite">טבלת הפרסים הקבועה כבר טעונה במערכת. העלאת קובץ פרסים היא אופציונלית בלבד ונועדה רק להחלפה יזומה.</div>
                            </section>

                            <section class="control-group">
                              <div class="control-group-header">
                                <h4>מקור נתונים</h4>
                                <p>בחירה בין העלאת קובץ ידנית לבין חיבור ל-API של מערכת הגיוס לצורך משיכה שוטפת לאורך הקמפיין</p>
                              </div>
                              <div class="filters-grid filters-grid--three">
                                <label class="form-label">
                                  מקור פעיל
                                  <select id="source-mode" class="form-select">
                                    <option value="file">קובץ CSV / Excel</option>
                                    <option value="api">API של מערכת הגיוס</option>
                                    <option value="google_sheets">Google Sheets</option>
                                  </select>
                                </label>
                                <label class="form-label">
                                  שיטת בקשה
                                  <select id="source-api-method" class="form-select">
                                    <option value="GET">GET</option>
                                    <option value="POST">POST</option>
                                  </select>
                                </label>
                                <label class="form-label">
                                  פורמט תגובה
                                  <select id="source-api-format" class="form-select">
                                    <option value="csv">CSV</option>
                                    <option value="json">JSON</option>
                                  </select>
                                </label>
                              </div>
                              <div id="source-api-fields">
                                <div class="filters-grid">
                                  <label class="form-label">
                                    כתובת endpoint
                                    <input id="source-api-endpoint" class="form-control" type="url" placeholder="https://api.example.org/campaign/export" dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    נתיב לרשומות ב-JSON
                                    <input id="source-api-records-path" class="form-control" type="text" placeholder="data.records" dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    אימות
                                    <select id="source-api-auth-type" class="form-select">
                                      <option value="none">ללא אימות</option>
                                      <option value="bearer">Bearer Token</option>
                                    </select>
                                  </label>
                                  <label class="form-label">
                                    רענון אוטומטי בדקות
                                    <input id="source-api-auto-refresh" class="form-control" type="number" min="0" step="1" placeholder="5" />
                                  </label>
                                  <label class="form-label">
                                    Bearer Token
                                    <input id="source-api-bearer-token" class="form-control" type="password" autocomplete="off" placeholder="השאר/י ריק כדי לשמור את הערך הקיים" dir="ltr" />
                                  </label>
                                </div>
                                <div class="filters-grid">
                                  <label class="form-label">
                                    Headers נוספים
                                    <textarea id="source-api-headers" class="form-control settings-textarea" placeholder="X-Client-Id: 12345&#10;X-Campaign: osim26" dir="ltr"></textarea>
                                  </label>
                                  <label class="form-label">
                                    Body לבקשת POST
                                    <textarea id="source-api-body" class="form-control settings-textarea" placeholder='{"campaign":"osim_tov_betzahov26"}' dir="ltr"></textarea>
                                  </label>
                                </div>
                                <label class="form-label">
                                  מיפוי שדות JSON לשדות הדשבורד
                                  <textarea id="source-api-field-map" class="form-control settings-textarea" dir="ltr"></textarea>
                                </label>
                              </div>
                              <div id="source-google-fields" hidden>
                                <div class="filters-grid">
                                  <label class="form-label">
                                    קישור ל-Google Sheets
                                    <input id="source-google-url" class="form-control" type="url" placeholder="https://docs.google.com/spreadsheets/d/..." dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    Spreadsheet ID
                                    <input id="source-google-id" class="form-control" type="text" placeholder="1AbCdEf..." dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    GID
                                    <input id="source-google-gid" class="form-control" type="text" placeholder="0" dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    Sheet Name
                                    <input id="source-google-sheet-name" class="form-control" type="text" placeholder="Sheet1" dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    Range
                                    <input id="source-google-range" class="form-control" type="text" placeholder="Sheet1!A:Z" dir="ltr" />
                                  </label>
                                  <label class="form-label">
                                    שיטת גישה
                                    <select id="source-google-access-mode" class="form-select">
                                      <option value="public_csv">Public CSV export</option>
                                      <option value="service_account">Service Account</option>
                                    </select>
                                  </label>
                                  <label class="form-label">
                                    סנכרון אוטומטי בדקות
                                    <input id="source-google-sync-interval" class="form-control" type="number" min="1" step="1" placeholder="5" />
                                  </label>
                                </div>
                                <label class="form-label">
                                  מיפוי שדות Google Sheets לשדות המערכת
                                  <textarea id="source-google-field-map" class="form-control settings-textarea" dir="ltr"></textarea>
                                </label>
                              </div>
                              <div class="control-actions control-actions--inline">
                                <button id="save-source-config" class="button-secondary action-button secondary" type="button">שמירת חיבור מקור</button>
                                <button id="refresh-source-api" class="button-primary action-button" type="button">משיכת נתונים מהמערכת</button>
                              </div>
                              <div id="source-config-status" class="status-note text-small" aria-live="polite">כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.</div>
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

                            <section class="control-group">
                              <div class="control-group-header">
                                <h4>איפוס נתוני עבודה</h4>
                                <p>ניקוי מהיר של נתוני הניתוח כדי לטעון קבצים חדשים מבלי לפגוע בעיצוב הקמפיין ובהגדרות המנהלים</p>
                              </div>
                              <div class="status-note text-small">
                                האיפוס מחזיר את קובץ הבסיס, קובץ ההשוואה, רשימת השגרירים וטבלת הפרסים למצב ברירת המחדל המקומי, ומנקה את שדות ההעלאה הפעילים.
                              </div>
                              <div class="control-actions control-actions--inline">
                                <button id="reset-working-data" class="button-secondary action-button secondary" type="button">איפוס נתוני עבודה</button>
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

                    <div id="admin-tab-panel-design" class="admin-tab-panel" hidden>
                      <section class="dashboard-section">
                        <div class="section-header">
                          <h3>עיצוב, טקסטים ומדיה של עמוד הפרויקט</h3>
                          <div class="text-small text-muted">כל מה שקשור לבאנר, מדיה, צבעים, פונטים, טקסטים וסכומי התרומה של עמוד הפרויקט הציבורי מרוכז כאן.</div>
                        </div>
                        <div id="campaign-designer-panel" class="app-card app-card--elevated"></div>
                      </section>
                    </div>
                  </div>
                </div>
              </section>
            </main>
          </div>
          <script>
            (async () => {
              const INITIAL_ROWS = __INITIAL_ROWS__;
              const INITIAL_META = __INITIAL_META__;
              const INITIAL_SOURCE_LABEL = __INITIAL_SOURCE_LABEL__;
              const INITIAL_ORG_LOGO = __INITIAL_ORG_LOGO__;
              const INITIAL_CAMPAIGN_LOGO = __INITIAL_CAMPAIGN_LOGO__;
              const INITIAL_BACKDROP = __INITIAL_BACKDROP__;
              const INITIAL_PRIZES = __INITIAL_PRIZES__;
              const AUTH_CONFIG = __AUTH_CONFIG__;
              const INITIAL_CAMPAIGN_PAGE_SETTINGS = __INITIAL_CAMPAIGN_PAGE_SETTINGS__;
              const PRIZE_STORAGE_KEY = "yellow-dashboard.prize-model";
              const GOAL_STORAGE_KEY = "yellow-dashboard.goals";
              const CAMPAIGN_PAGE_SETTINGS_KEY = "yellow-dashboard.campaign-page-settings";
              const CAMPAIGN_BUILDER_CONFIG_KEY = "yellow-dashboard.campaign-builder-config";
              const CAMPAIGN_REGISTRY_STORAGE_KEY = "yellow-dashboard.campaign-registry";
              const AMBASSADOR_DIRECTORY_KEY = "yellow-dashboard.ambassador-directory";
              const LAST_ADMIN_EMAIL_KEY = "yellow-dashboard.last-admin-email";
              const root = document.getElementById("yellow-dashboard-root");
              root.style.setProperty("--brand-pattern-campaign", `url("${INITIAL_CAMPAIGN_LOGO}")`);
              root.style.setProperty("--brand-pattern-organization", `url("${INITIAL_ORG_LOGO}")`);
              root.style.setProperty("--dashboard-backdrop", INITIAL_BACKDROP ? `url("${INITIAL_BACKDROP}")` : "none");
              __INTELLIGENCE_MODULE__

              const elements = {
                topbarCampaignLogo: root.querySelector("#topbar-campaign-logo"),
                topbarLogo: root.querySelector("#topbar-logo"),
                logo: root.querySelector("#brand-logo"),
                brandOrgLogo: root.querySelector("#brand-org-logo"),
                publicLogo: root.querySelector("#public-logo"),
                publicOrgLogo: root.querySelector("#public-org-logo"),
                loginCampaignLogo: root.querySelector("#login-campaign-logo"),
                loginOrgLogo: root.querySelector("#login-org-logo"),
                topbarTitle: root.querySelector("#topbar-title"),
                navButtons: Array.from(root.querySelectorAll("[data-page-target]")),
                adminEntryButtons: Array.from(root.querySelectorAll("[data-admin-login]")),
                metricButtons: Array.from(root.querySelectorAll("[data-metric-select]")),
                pageProject: root.querySelector("#page-project"),
                pagePrizes: root.querySelector("#page-prizes"),
                pageRules: root.querySelector("#page-rules"),
                pagePrivacy: root.querySelector("#page-privacy"),
                pageAdmin: root.querySelector("#page-admin"),
                projectPageRoot: root.querySelector("#project-page-root"),
                campaignDesignerPanel: root.querySelector("#campaign-designer-panel"),
                adminTabButtons: Array.from(root.querySelectorAll("[data-admin-tab-target]")),
                adminTabPanelInsights: root.querySelector("#admin-tab-panel-insights"),
                adminTabPanelDesign: root.querySelector("#admin-tab-panel-design"),
                sessionStatus: root.querySelector("#session-status"),
                topbarMeta: root.querySelector("#topbar-meta"),
                goAdminLogin: root.querySelector("#go-admin-login"),
                logoutButton: root.querySelector("#logout-button"),
                publicHeroBadges: root.querySelector("#public-hero-badges"),
                adminLock: root.querySelector("#admin-lock"),
                adminContent: root.querySelector("#admin-content"),
                loginForm: root.querySelector("#login-form"),
                loginEmail: root.querySelector("#login-email"),
                loginPassword: root.querySelector("#login-password"),
                loginPasswordSetupNote: root.querySelector("#login-password-setup-note"),
                loginPasswordConfirmLabel: root.querySelector("#login-password-confirm-label"),
                loginPasswordConfirm: root.querySelector("#login-password-confirm"),
                loginPasswordToggle: root.querySelector("#login-password-toggle"),
                loginButton: root.querySelector("#login-button"),
                loginResetButton: root.querySelector("#login-reset-button"),
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
                sourceMode: root.querySelector("#source-mode"),
                sourceApiEndpoint: root.querySelector("#source-api-endpoint"),
                sourceApiMethod: root.querySelector("#source-api-method"),
                sourceApiFormat: root.querySelector("#source-api-format"),
                sourceApiRecordsPath: root.querySelector("#source-api-records-path"),
                sourceApiAuthType: root.querySelector("#source-api-auth-type"),
                sourceApiAutoRefresh: root.querySelector("#source-api-auto-refresh"),
                sourceApiBearerToken: root.querySelector("#source-api-bearer-token"),
                sourceApiHeaders: root.querySelector("#source-api-headers"),
                sourceApiBody: root.querySelector("#source-api-body"),
                sourceApiFieldMap: root.querySelector("#source-api-field-map"),
                sourceApiFields: root.querySelector("#source-api-fields"),
                sourceGoogleUrl: root.querySelector("#source-google-url"),
                sourceGoogleId: root.querySelector("#source-google-id"),
                sourceGoogleGid: root.querySelector("#source-google-gid"),
                sourceGoogleSheetName: root.querySelector("#source-google-sheet-name"),
                sourceGoogleRange: root.querySelector("#source-google-range"),
                sourceGoogleAccessMode: root.querySelector("#source-google-access-mode"),
                sourceGoogleSyncInterval: root.querySelector("#source-google-sync-interval"),
                sourceGoogleFieldMap: root.querySelector("#source-google-field-map"),
                sourceGoogleFields: root.querySelector("#source-google-fields"),
                saveSourceConfig: root.querySelector("#save-source-config"),
                refreshSourceApi: root.querySelector("#refresh-source-api"),
                sourceConfigStatus: root.querySelector("#source-config-status"),
                goalTotal: root.querySelector("#goal-total"),
                goalDaily: root.querySelector("#goal-daily"),
                dailyMetric: root.querySelector("#daily-metric-select"),
                heatmapMetric: root.querySelector("#heatmap-metric-select"),
                movementMetric: root.querySelector("#movement-metric-select"),
                exportFiltered: root.querySelector("#export-filtered"),
                clearCompare: root.querySelector("#clear-compare"),
                clearFilters: root.querySelector("#clear-filters"),
                resetWorkingData: root.querySelector("#reset-working-data"),
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
                prizeAmbassadorSearch: root.querySelector("#prize-ambassador-search"),
                prizeAmbassadorDirectory: root.querySelector("#prize-ambassador-directory"),
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

              const initialCampaignRegistry = readStoredCampaignRegistry();
              const initialActiveCampaignEntry = getCampaignRegistryActiveEntry(initialCampaignRegistry);
              const initialCampaignPageSettings = buildCampaignPageSettingsFromSnapshot(
                initialActiveCampaignEntry?.config,
                readStoredCampaignPageSettings() || INITIAL_CAMPAIGN_PAGE_SETTINGS
              );
              const initialCampaignGoals = buildGoalsFromCampaignSnapshot(initialActiveCampaignEntry?.config, readStoredGoals());
              const initialCampaignPrizeModel = buildPrizeModelFromCampaignSnapshot(initialActiveCampaignEntry?.config, readStoredPrizeModel() || INITIAL_PRIZES);
              const initialCampaignSourceConfig = buildSourceConfigFromCampaignSnapshot(initialActiveCampaignEntry?.config, getDefaultSourceConfig());
              const initialCampaignBuilderConfig = buildCampaignBuilderConfigFromSnapshot(initialActiveCampaignEntry?.config, readStoredCampaignBuilderConfig());
              const initialCampaignAmbassadorDirectory = buildAmbassadorDirectoryFromCampaignSnapshot(
                initialActiveCampaignEntry?.config,
                readStoredAmbassadorDirectory()
              );

              const state = {
                rows: cloneSerializable(INITIAL_ROWS),
                meta: cloneSerializable(INITIAL_META),
                sourceLabel: INITIAL_SOURCE_LABEL,
                compare: {
                  rows: [],
                  meta: null,
                  label: "",
                },
                validation: {
                  base: null,
                  compare: null,
                },
                goals: initialCampaignGoals,
                prizeModel: initialCampaignPrizeModel,
                sourceConfig: initialCampaignSourceConfig,
                campaignPage: initialCampaignPageSettings,
                campaignBuilder: initialCampaignBuilderConfig,
                ambassadorDirectory: initialCampaignAmbassadorDirectory,
                campaignRegistry: initialCampaignRegistry,
                activeCampaignId: initialCampaignRegistry.activeCampaignId,
                session: null,
                auth: {
                  backendAvailable: false,
                  setupMode: false,
                  adminDatasetLoaded: false,
                  campaignConfigLoaded: false,
                  accessibleCampaigns: [],
                  publicScope: {
                    organizationId: "",
                    campaignId: "",
                  },
                  currentScope: {
                    organizationId: "",
                    campaignId: "",
                  },
                },
                filters: getDefaultFilters(cloneSerializable(INITIAL_META)),
                view: {
                  dailyMetric: "amount",
                  heatmapMetric: "amount",
                  movementMetric: "amount",
                },
                donation: getDefaultDonationState(initialCampaignPageSettings),
                ui: {
                  page: "project",
                  tableExpanded: false,
                  prizeAmbassadorSearch: "",
                  adminTab: "insights",
                  campaignBuilderStep: 1,
                  campaignSettingsStatus: {
                    message: "ההגדרות נשמרות מקומית בדפדפן זה בלבד.",
                    tone: "neutral",
                  },
                  campaignBuilderStatus: {
                    message: "טיוטת הקמפיין עדיין לא נשמרה בשרת.",
                    tone: "neutral",
                  },
                  ambassadorDirectoryStatus: {
                    message: "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים.",
                    tone: "neutral",
                  },
                  sourceConfigStatus: {
                    message: "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.",
                    tone: "neutral",
                  },
                },
              };

              if (state.ambassadorDirectory.length) {
                setAmbassadorDirectoryStatus(`${state.ambassadorDirectory.length} שגרירים נטענו מהאחסון המקומי עם לינקים אישיים פעילים.`, "success");
              }

              function cloneSerializable(value) {
                return JSON.parse(JSON.stringify(value));
              }

              function getDefaultSourceFieldMap() {
                return {
                  id: "id",
                  created_at: "created_at",
                  full_name: "full_name",
                  email: "email",
                  "Ambassador name": "Ambassador name",
                  total: "total",
                  city: "city",
                  charged_success: "charged_success",
                  charge_result: "charge_result",
                };
              }

              function getDefaultSourceConfig() {
                return {
                  mode: "file",
                  api: {
                    endpoint: "",
                    method: "GET",
                    responseFormat: "csv",
                    recordsPath: "",
                    authType: "none",
                    bearerToken: "",
                    hasBearerToken: false,
                    autoRefreshMinutes: 5,
                    headersText: "",
                    bodyText: "",
                    fieldMapText: JSON.stringify(getDefaultSourceFieldMap(), null, 2),
                  },
                  googleSheets: {
                    spreadsheetUrl: "",
                    spreadsheetId: "",
                    gid: "",
                    sheetName: "",
                    range: "",
                    accessMode: "public_csv",
                    syncEnabled: true,
                    syncIntervalMinutes: 5,
                    fieldMapText: JSON.stringify(getDefaultSourceFieldMap(), null, 2),
                    lastSyncedAt: "",
                    lastSuccessfulSyncAt: "",
                    lastChecksum: "",
                    lastRowCount: 0,
                    lastStatus: "idle",
                    lastMessage: "",
                    lastSourceLabel: "",
                  },
                };
              }

              function normalizePositiveInteger(value, fallback) {
                const numeric = Number.parseInt(String(value ?? "").trim(), 10);
                return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
              }

              function parseJsonObjectText(text, fallbackValue = {}) {
                const raw = String(text || "").trim();
                if (!raw) {
                  return cloneSerializable(fallbackValue);
                }
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                  throw new Error("יש להזין אובייקט JSON תקין במיפוי השדות.");
                }
                return parsed;
              }

              function normalizeSourceConfig(value) {
                const defaults = getDefaultSourceConfig();
                const candidate = value && typeof value === "object" ? value : {};
                const apiCandidate = candidate.api && typeof candidate.api === "object" ? candidate.api : {};
                const googleSheetsCandidate = candidate.googleSheets && typeof candidate.googleSheets === "object" ? candidate.googleSheets : {};
                let fieldMapText = defaults.api.fieldMapText;
                try {
                  fieldMapText = JSON.stringify(parseJsonObjectText(apiCandidate.fieldMapText, getDefaultSourceFieldMap()), null, 2);
                } catch (_error) {
                  fieldMapText = defaults.api.fieldMapText;
                }
                let googleFieldMapText = defaults.googleSheets.fieldMapText;
                try {
                  googleFieldMapText = JSON.stringify(
                    parseJsonObjectText(googleSheetsCandidate.fieldMapText, getDefaultSourceFieldMap()),
                    null,
                    2
                  );
                } catch (_error) {
                  googleFieldMapText = defaults.googleSheets.fieldMapText;
                }
                const bearerToken = String(apiCandidate.bearerToken || "").trim();
                return {
                  mode: candidate.mode === "google_sheets" ? "google_sheets" : candidate.mode === "api" ? "api" : "file",
                  api: {
                    endpoint: String(apiCandidate.endpoint || "").trim(),
                    method: String(apiCandidate.method || defaults.api.method).trim().toUpperCase() === "POST" ? "POST" : "GET",
                    responseFormat: String(apiCandidate.responseFormat || defaults.api.responseFormat).trim().toLowerCase() === "json" ? "json" : "csv",
                    recordsPath: String(apiCandidate.recordsPath || "").trim(),
                    authType: String(apiCandidate.authType || defaults.api.authType).trim().toLowerCase() === "bearer" ? "bearer" : "none",
                    bearerToken,
                    hasBearerToken: Boolean(apiCandidate.hasBearerToken || bearerToken),
                    autoRefreshMinutes: normalizePositiveInteger(apiCandidate.autoRefreshMinutes, defaults.api.autoRefreshMinutes),
                    headersText: String(apiCandidate.headersText || "").replaceAll("\\r\\n", "\\n").trim(),
                    bodyText: String(apiCandidate.bodyText || "").replaceAll("\\r\\n", "\\n").trim(),
                    fieldMapText,
                  },
                  googleSheets: {
                    spreadsheetUrl: String(googleSheetsCandidate.spreadsheetUrl || "").trim(),
                    spreadsheetId: String(googleSheetsCandidate.spreadsheetId || "").trim(),
                    gid: String(googleSheetsCandidate.gid || "").trim(),
                    sheetName: String(googleSheetsCandidate.sheetName || "").trim(),
                    range: String(googleSheetsCandidate.range || "").trim(),
                    accessMode: String(googleSheetsCandidate.accessMode || defaults.googleSheets.accessMode).trim().toLowerCase() === "service_account"
                      ? "service_account"
                      : "public_csv",
                    syncEnabled: googleSheetsCandidate.syncEnabled !== false,
                    syncIntervalMinutes: normalizePositiveInteger(
                      googleSheetsCandidate.syncIntervalMinutes,
                      defaults.googleSheets.syncIntervalMinutes
                    ),
                    fieldMapText: googleFieldMapText,
                    lastSyncedAt: String(googleSheetsCandidate.lastSyncedAt || "").trim(),
                    lastSuccessfulSyncAt: String(googleSheetsCandidate.lastSuccessfulSyncAt || "").trim(),
                    lastChecksum: String(googleSheetsCandidate.lastChecksum || "").trim(),
                    lastRowCount: normalizePositiveInteger(googleSheetsCandidate.lastRowCount, 0),
                    lastStatus: String(googleSheetsCandidate.lastStatus || "idle").trim().toLowerCase() || "idle",
                    lastMessage: String(googleSheetsCandidate.lastMessage || "").trim(),
                    lastSourceLabel: String(googleSheetsCandidate.lastSourceLabel || "").trim(),
                  },
                };
              }

              function setSourceConfigStatus(message, tone = "neutral") {
                state.ui.sourceConfigStatus = {
                  message: String(message || "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה."),
                  tone: String(tone || "neutral"),
                };
                if (!elements.sourceConfigStatus) {
                  return;
                }
                elements.sourceConfigStatus.textContent = state.ui.sourceConfigStatus.message;
                elements.sourceConfigStatus.className = `status-note text-small${tone && tone !== "neutral" ? ` is-${tone}` : ""}`;
              }

              function getSourceConfigStatus() {
                return state.ui.sourceConfigStatus || {
                  message: "כרגע המערכת עובדת על בסיס קובץ. כשה-API יהיה מוכן, אפשר יהיה לעבור למצב משיכה ישירה.",
                  tone: "neutral",
                };
              }

              function buildBaseValidationSnapshot(rows, label) {
                return {
                  label: label || "קובץ בסיס",
                  totalRows: rows.length,
                  validRows: rows,
                  errors: [],
                  warnings: [],
                  missingColumns: [],
                  invalidDateRows: 0,
                  invalidAmountRows: 0,
                  missingAmbassadorRows: rows.filter((row) => row.ambassador === "ללא שיוך").length,
                  missingEmailRows: rows.filter((row) => !row.email).length,
                  duplicateIdCount: 0,
                };
              }

              function restorePublicDataset() {
                state.rows = enrichRows(cloneSerializable(INITIAL_ROWS), cloneSerializable(INITIAL_META));
                state.meta = cloneSerializable(INITIAL_META);
                state.sourceLabel = INITIAL_SOURCE_LABEL;
                state.compare = {
                  rows: [],
                  meta: null,
                  label: "",
                };
                state.validation.compare = null;
                state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
                state.auth.adminDatasetLoaded = false;
              }

              function restoreWorkingData() {
                restorePublicDataset();
                state.prizeModel = normalizePrizeModel(cloneSerializable(INITIAL_PRIZES));
                storePrizeModel(state.prizeModel);
                state.ambassadorDirectory = [];
                storeAmbassadorDirectory([]);
                setAmbassadorDirectoryStatus("רשימת השגרירים נוקתה. אפשר להעלות CSV חדש בכל עת.", "neutral");
                state.filters = getDefaultFilters(state.meta);
                state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
                applyAmbassadorContextFromUrl();
                if (elements.upload) {
                  elements.upload.value = "";
                }
                if (elements.compareUpload) {
                  elements.compareUpload.value = "";
                }
                if (elements.prizeUpload) {
                  elements.prizeUpload.value = "";
                }
                const ambassadorUpload = elements.campaignDesignerPanel?.querySelector("#ambassador-directory-upload");
                if (ambassadorUpload) {
                  ambassadorUpload.value = "";
                }
                resetFilterOptions();
                setImportMessage("נתוני העבודה אופסו. אפשר להעלות עכשיו קובץ עסקאות, קובץ השוואה, קובץ פרסים או קובץ שגרירים חדשים.", "success");
              }

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
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function hasPrizeModelContent(model) {
                return Boolean(model?.placePrizes?.length || model?.tierPrizes?.length);
              }

              function getDefaultPrizeStatusMessage() {
                return hasPrizeModelContent(state.prizeModel)
                  ? "טבלת הפרסים הקבועה כבר טעונה במערכת. העלאת קובץ פרסים היא אופציונלית בלבד ונועדה רק להחלפה יזומה."
                  : "המערכת מוכנה לקבלת קבצים. קובץ לא תקין לא ידרוס את הנתונים הפעילים.";
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
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function getDefaultDonationState(campaignPage) {
                const firstAmount = Number(campaignPage?.amountCards?.[2]?.value || campaignPage?.amountCards?.[0]?.value || 0);
                return {
                  frequency: "one_time",
                  selectedAmount: firstAmount,
                  customAmount: "",
                  donorName: "",
                  donorEmail: "",
                  donorPhone: "",
                  ambassador: "general",
                  dedication: "",
                  consent: true,
                  message: "",
                  tone: "",
                };
              }

              function syncDonationStateWithCampaignPage(currentDonation, campaignPage) {
                const next = {
                  ...getDefaultDonationState(campaignPage),
                  ...(currentDonation || {}),
                };
                const allowedAmounts = new Set((campaignPage?.amountCards || []).map((item) => Number(item.value || 0)));
                if (!campaignPage?.showRecurring) {
                  next.frequency = "one_time";
                } else if (!["one_time", "monthly"].includes(String(next.frequency || ""))) {
                  next.frequency = "one_time";
                }
                if (!allowedAmounts.has(Number(next.selectedAmount || 0))) {
                  next.selectedAmount = Number(campaignPage?.amountCards?.[2]?.value || campaignPage?.amountCards?.[0]?.value || 0);
                }
                next.customAmount = String(next.customAmount || "");
                next.donorName = String(next.donorName || "");
                next.donorEmail = String(next.donorEmail || "");
                next.donorPhone = String(next.donorPhone || "");
                next.ambassador = String(next.ambassador || "general");
                next.dedication = String(next.dedication || "");
                next.message = "";
                next.tone = "";
                return next;
              }

              function readStoredCampaignPageSettings() {
                try {
                  const raw = window.localStorage.getItem(CAMPAIGN_PAGE_SETTINGS_KEY);
                  return raw ? JSON.parse(raw) : null;
                } catch (_error) {
                  return null;
                }
              }

              function normalizeUrlSlug(value) {
                return String(value || "")
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]+/g, "-")
                  .replace(/-{2,}/g, "-")
                  .replace(/^[-_]+|[-_]+$/g, "");
              }

              function deriveAmbassadorNicknameFromEmail(email) {
                const normalizedEmail = String(email || "").trim().toLowerCase();
                const atIndex = normalizedEmail.lastIndexOf("@");
                if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
                  return "";
                }
                return normalizeUrlSlug(normalizedEmail.slice(0, atIndex));
              }

              function normalizeAmbassadorDirectory(records) {
                if (!Array.isArray(records)) {
                  return [];
                }
                const seen = new Set();
                return records
                  .map((record) => {
                    const fullName = String(record?.fullName || record?.name || "").trim();
                    const email = String(record?.email || "").trim().toLowerCase();
                    const phone = String(record?.phone || "").trim();
                    const nickname = normalizeUrlSlug(record?.nickname || record?.slug || "") || deriveAmbassadorNicknameFromEmail(email);
                    if (!fullName || !nickname) {
                      return null;
                    }
                    return {
                      fullName,
                      email,
                      phone,
                      nickname,
                      team: String(record?.team || "").trim(),
                      personalTarget: Number(record?.personalTarget || 0),
                      status: String(record?.status || "").trim().toLowerCase() || "active",
                      registeredAt: String(record?.registeredAt || "").trim(),
                      referredBy: String(record?.referredBy || "").trim(),
                      wasAmbassadorBefore: record?.wasAmbassadorBefore ?? null,
                      registrationSource: String(record?.registrationSource || "").trim(),
                      isOver18: record?.isOver18 ?? null,
                      understandsNotPacking: record?.understandsNotPacking ?? null,
                      termsAccepted: record?.termsAccepted ?? null,
                    };
                  })
                  .filter(Boolean)
                  .filter((record) => {
                    if (seen.has(record.nickname)) {
                      return false;
                    }
                    seen.add(record.nickname);
                    return true;
                  });
              }

              function readStoredAmbassadorDirectory() {
                try {
                  const raw = window.localStorage.getItem(AMBASSADOR_DIRECTORY_KEY);
                  return raw ? normalizeAmbassadorDirectory(JSON.parse(raw)) : [];
                } catch (_error) {
                  return [];
                }
              }

              function storeAmbassadorDirectory(records) {
                try {
                  window.localStorage.setItem(AMBASSADOR_DIRECTORY_KEY, JSON.stringify(normalizeAmbassadorDirectory(records)));
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function setAmbassadorDirectoryStatus(message, tone = "neutral") {
                state.ui.ambassadorDirectoryStatus = {
                  message: String(message || "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים."),
                  tone: String(tone || "neutral"),
                };
                const status = elements.campaignDesignerPanel?.querySelector("[data-ambassador-status]");
                if (!status) {
                  return;
                }
                status.textContent = state.ui.ambassadorDirectoryStatus.message;
                if (state.ui.ambassadorDirectoryStatus.tone === "neutral") {
                  status.removeAttribute("data-tone");
                } else {
                  status.dataset.tone = state.ui.ambassadorDirectoryStatus.tone;
                }
              }

              function getAmbassadorDirectoryStatus() {
                return state.ui.ambassadorDirectoryStatus || {
                  message: "עדיין לא נטען קובץ שגרירים. אפשר להעלות CSV כדי לייצר לינקים אישיים.",
                  tone: "neutral",
                };
              }

              function getCampaignProjectSlug() {
                return normalizeUrlSlug(state.campaignPage?.projectSlug || INITIAL_CAMPAIGN_PAGE_SETTINGS.projectSlug || "campaign");
              }

              function getCampaignPlatformBaseUrl() {
                const fallback = String(INITIAL_CAMPAIGN_PAGE_SETTINGS.platformBaseUrl || window.location.origin || "").trim();
                const candidate = String(state.campaignPage?.platformBaseUrl || fallback).trim();
                try {
                  return new URL(candidate, window.location.origin).toString().replace(/\\/+$/, "");
                } catch (_error) {
                  return String(window.location.origin || "").replace(/\\/+$/, "");
                }
              }

              function buildAmbassadorPersonalUrl(record) {
                const baseUrl = getCampaignPlatformBaseUrl();
                const projectSlug = getCampaignProjectSlug();
                return `${baseUrl}/${projectSlug}/${normalizeUrlSlug(record?.nickname || "")}`;
              }

              function parseAmbassadorDirectoryCsv(text) {
                const rawRows = csvMatrixToRecords(parseCsv(text));
                const normalizeHeader = (value) => String(value || "")
                  .replace(/^\uFEFF/, "")
                  .trim()
                  .toLowerCase()
                  .replace(/\\s+/g, " ");
                const pickValue = (row, keys) => {
                  for (const key of keys) {
                    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) {
                      return String(row[key]).trim();
                    }
                  }
                  const aliases = keys.map(normalizeHeader);
                  for (const [key, value] of Object.entries(row)) {
                    const normalizedKey = normalizeHeader(key);
                    if (value !== undefined && value !== null && String(value).trim() && aliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias))) {
                      return String(value).trim();
                    }
                  }
                  return "";
                };
                const parseRegistrationBoolean = (value) => {
                  const normalized = String(value || "").trim().toLowerCase();
                  if (["true", "1", "yes", "y", "כן", "מסכים", "מסכימה", "יודע", "יודעת"].includes(normalized) || /^(מסכימ|יודע)/.test(normalized)) return true;
                  if (["false", "0", "no", "n", "לא"].includes(normalized)) return false;
                  return null;
                };

                const missingRows = [];
                const duplicateNicknames = [];
                const generatedNicknames = [];
                const records = [];
                const seenNicknames = new Set();

                rawRows.forEach((row, index) => {
                  const fullName = pickValue(row, ["full_name", "Full Name", "name", "Name", "שם מלא", "שם מלא של השגריר"]);
                  const email = pickValue(row, ["email", "Email", "מייל", "דואל", "כתובת מייל"]);
                  const phone = pickValue(row, ["phone", "Phone", "טלפון", "mobile", "מספר טלפון"]);
                  const suppliedNickname = normalizeUrlSlug(pickValue(row, ["nickname", "Nickname", "alias", "slug", "כינוי"]));
                  const nickname = suppliedNickname || deriveAmbassadorNicknameFromEmail(email);
                  const team = pickValue(row, ["team", "Team", "group", "קבוצה", "צוות"]);
                  const personalTarget = pickValue(row, ["personal_target", "target", "Target", "יעד אישי"]);
                  const status = pickValue(row, ["status", "Status", "סטטוס"]);
                  if (!fullName || !nickname) {
                    missingRows.push(index + 2);
                    return;
                  }
                  if (!suppliedNickname) {
                    generatedNicknames.push(index + 2);
                  }
                  if (seenNicknames.has(nickname)) {
                    duplicateNicknames.push(nickname);
                    return;
                  }
                  seenNicknames.add(nickname);
                  records.push({
                    fullName,
                    email,
                    phone,
                    nickname,
                    team,
                    personalTarget: Number(personalTarget || 0),
                    status: String(status || "").trim().toLowerCase() || "active",
                    registeredAt: pickValue(row, ["registered_at", "timestamp", "חותמת זמן"]),
                    referredBy: pickValue(row, ["referred_by", "שם השגריר שהפנה אותך"]),
                    wasAmbassadorBefore: parseRegistrationBoolean(pickValue(row, ["was_ambassador_before", "האם כבר היית שגריר בעבר"])),
                    registrationSource: pickValue(row, ["registration_source", "איך הגעת לקישור הרשמה לשגרירים"]),
                    isOver18: parseRegistrationBoolean(pickValue(row, ["is_over_18", "מעל גיל 18"])),
                    understandsNotPacking: parseRegistrationBoolean(pickValue(row, ["understands_not_packing", "לא הקישור הרשמה לאריזות"])),
                    termsAccepted: parseRegistrationBoolean(pickValue(row, ["terms_accepted", "מסכימ", "תקנון"])),
                  });
                });

                return {
                  records: normalizeAmbassadorDirectory(records),
                  missingRows,
                  duplicateNicknames,
                  generatedNicknames,
                  totalRows: rawRows.length,
                };
              }

              async function persistAmbassadorDirectoryToBackend(records, sourceLabel) {
                if (!canUseBackendAuth()) {
                  return null;
                }
                if (!isManagerAuthenticated()) {
                  throw new Error("נדרשת התחברות מנהל כדי לשמור שגרירים במסד הנתונים.");
                }
                const endpoint = buildScopedAdminEndpoint("ambassador-import", getActiveCampaignIdentity());
                if (!endpoint) {
                  throw new Error("לא נמצאה זהות קמפיין לשמירת השגרירים.");
                }
                const { response, payload } = await authRequest(endpoint, {
                  method: "POST",
                  body: {
                    records,
                    sourceLabel: sourceLabel || "ambassador-registration-csv",
                  },
                });
                if (!response.ok) {
                  throw new Error(payload?.message || "שמירת השגרירים במסד הנתונים נכשלה.");
                }
                return payload;
              }

              function exportAmbassadorLinks(records) {
                const headers = ["full_name", "email", "phone", "nickname", "personal_url"];
                const lines = [headers.join(",")];
                records.forEach((record) => {
                  const values = [
                    record.fullName,
                    record.email,
                    record.phone,
                    record.nickname,
                    buildAmbassadorPersonalUrl(record),
                  ].map((value) => `"${String(value || "").replaceAll('"', '""')}"`);
                  lines.push(values.join(","));
                });
                const blob = new Blob(["\\uFEFF" + lines.join("\\n")], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${getCampaignProjectSlug()}-ambassador-links.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }

              function getAmbassadorRecordByFullName(fullName) {
                const normalizedName = normalizeSearchToken(fullName);
                return state.ambassadorDirectory.find((record) => normalizeSearchToken(record.fullName) === normalizedName) || null;
              }

              function applyAmbassadorContextFromUrl() {
                const url = new URL(window.location.href);
                const segments = url.pathname.split("/").filter(Boolean);
                const routeProjectSlug = normalizeUrlSlug(url.searchParams.get("project") || segments[0] || "");
                const routeAmbassadorSlug = normalizeUrlSlug(url.searchParams.get("ambassador") || url.searchParams.get("nickname") || segments[1] || "");
                if (!routeAmbassadorSlug) {
                  return;
                }
                const currentProjectSlug = getCampaignProjectSlug();
                if (routeProjectSlug && currentProjectSlug && routeProjectSlug !== currentProjectSlug) {
                  return;
                }
                const directoryMatch = state.ambassadorDirectory.find((record) => record.nickname === routeAmbassadorSlug);
                if (directoryMatch) {
                  state.donation.ambassador = directoryMatch.fullName;
                  return;
                }
                const fallbackMatch = buildLeaderboard(state.rows)
                  .map((entry) => entry.ambassador)
                  .find((ambassador) => normalizeUrlSlug(ambassador) === routeAmbassadorSlug);
                if (fallbackMatch) {
                  state.donation.ambassador = fallbackMatch;
                }
              }

              function storeCampaignPageSettings(settings) {
                try {
                  window.localStorage.setItem(CAMPAIGN_PAGE_SETTINGS_KEY, JSON.stringify(settings));
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function setCampaignSettingsStatus(message, tone = "neutral") {
                state.ui.campaignSettingsStatus = {
                  message: String(message || "ההגדרות נשמרות מקומית בדפדפן זה בלבד."),
                  tone: String(tone || "neutral"),
                };
                const status = elements.campaignDesignerPanel?.querySelector("[data-settings-status]");
                if (!status) {
                  return;
                }
                status.textContent = state.ui.campaignSettingsStatus.message;
                if (state.ui.campaignSettingsStatus.tone === "neutral") {
                  status.removeAttribute("data-tone");
                } else {
                  status.dataset.tone = state.ui.campaignSettingsStatus.tone;
                }
              }

              function getCampaignSettingsStatus() {
                return state.ui.campaignSettingsStatus || {
                  message: "ההגדרות נשמרות מקומית בדפדפן זה בלבד.",
                  tone: "neutral",
                };
              }

              function getCampaignBuilderStatus() {
                return state.ui.campaignBuilderStatus || {
                  message: "טיוטת הקמפיין עדיין לא נשמרה בשרת.",
                  tone: "neutral",
                };
              }

              function setCampaignBuilderStatus(message, tone = "neutral") {
                state.ui.campaignBuilderStatus = {
                  message: String(message || "טיוטת הקמפיין עדיין לא נשמרה בשרת."),
                  tone: String(tone || "neutral"),
                };
                const status = elements.campaignDesignerPanel?.querySelector("[data-builder-status]");
                if (!status) {
                  return;
                }
                status.textContent = state.ui.campaignBuilderStatus.message;
                if (state.ui.campaignBuilderStatus.tone === "neutral") {
                  status.removeAttribute("data-tone");
                } else {
                  status.dataset.tone = state.ui.campaignBuilderStatus.tone;
                }
              }

              function persistCampaignPageSettings(
                settings,
                successMessage = "ההגדרות נשמרו מקומית בדפדפן זה.",
                failureMessage = "ההגדרות עודכנו בתצוגה הנוכחית, אבל לא נשמרו בדפדפן. ייתכן שנפח האחסון המקומי התמלא."
              ) {
                const persisted = storeCampaignPageSettings(settings);
                if (persisted) {
                  setCampaignSettingsStatus(successMessage, "success");
                  return true;
                }
                setCampaignSettingsStatus(failureMessage, "warning");
                return false;
              }

              function buildProjectWindowLabelFromBasics(basics) {
                const start = basics?.startDate ? formatDate(basics.startDate) : "";
                const end = basics?.endDate ? formatDate(basics.endDate) : "";
                if (start && end) {
                  return `${start}–${end}`;
                }
                return start || end || INITIAL_CAMPAIGN_PAGE_SETTINGS.projectDatesLabel || "";
              }

              function createCampaignBuilderDefaults() {
                return {
                  basics: {
                    id: "",
                    campaignName: String(INITIAL_CAMPAIGN_PAGE_SETTINGS.title || "").trim(),
                    organizationId: "",
                    organizationName: "",
                    organizationSlug: "",
                    slug: normalizeUrlSlug(INITIAL_CAMPAIGN_PAGE_SETTINGS.projectSlug || "campaign"),
                    target: 0,
                    currency: "ILS",
                    startDate: String(INITIAL_META.defaultFrom || "").trim(),
                    startTime: "00:00",
                    endDate: String(INITIAL_META.defaultTo || "").trim(),
                    endTime: "23:59",
                    timeZone: "Asia/Jerusalem",
                    status: "draft",
                  },
                  teams: {
                    enabled: false,
                    groups: [],
                  },
                  permissions: {
                    admins: [],
                    managers: [],
                    viewers: [],
                  },
                  ambassadors: {
                    importMode: "csv",
                    personalTargetDefault: 0,
                    manualDraft: {
                      fullName: "",
                      nickname: "",
                      email: "",
                      phone: "",
                      team: "",
                      personalTarget: "",
                    },
                  },
                  goals: {
                    ambassadorGoal: 0,
                    teamGoal: 0,
                    tierRuleNote: String(INITIAL_PRIZES?.tierRuleNote || "").trim(),
                  },
                  templates: {
                    type: "annual-recurring",
                    duplicatedFromSlug: "",
                  },
                  review: {
                    launchedAt: "",
                  },
                  ui: {
                    previewMode: "desktop",
                  },
                  meta: {
                    lastSavedAt: "",
                    lastSavedBy: "",
                  },
                };
              }

              function buildCampaignSnapshotFromStateParts(parts = {}) {
                const builder = normalizeCampaignBuilderConfig(parts.builderConfig);
                const campaignPage = normalizeCampaignPageSettings(parts.campaignPage || INITIAL_CAMPAIGN_PAGE_SETTINGS);
                const goals = {
                  total: Number(parts.goals?.total || builder.basics.target || 0),
                  daily: Number(parts.goals?.daily || 0),
                };
                const prizeModel = normalizePrizeModel(cloneSerializable(parts.prizeModel || INITIAL_PRIZES));
                const sourceConfig = normalizeSourceConfig(parts.sourceConfig || getDefaultSourceConfig());
                const ambassadorDirectory = normalizeAmbassadorDirectory(parts.ambassadorDirectory || []);
                return {
                  basics: {
                    ...builder.basics,
                    slug: normalizeUrlSlug(builder.basics.slug || campaignPage.projectSlug || "campaign"),
                    target: Number(goals.total || builder.basics.target || 0),
                  },
                  branding: {
                    eyebrow: campaignPage.eyebrow,
                    projectDatesLabel: campaignPage.projectDatesLabel,
                    title: campaignPage.title,
                    subtitle: campaignPage.subtitle,
                    storyMarkdown: campaignPage.storyMarkdown,
                    primaryCtaLabel: campaignPage.primaryCtaLabel,
                    secondaryCtaLabel: campaignPage.secondaryCtaLabel,
                    mediaType: campaignPage.mediaType,
                    mediaUrl: campaignPage.mediaUrl,
                    mediaAlt: campaignPage.mediaAlt,
                    campaignLogoUrl: campaignPage.campaignLogoUrl,
                    organizationLogoUrl: campaignPage.organizationLogoUrl,
                    fontFamily: campaignPage.fontFamily,
                    theme: cloneSerializable(campaignPage.theme),
                  },
                  donation: {
                    externalDonationUrl: campaignPage.externalDonationUrl,
                    trustNote: campaignPage.trustNote,
                    successHint: campaignPage.successHint,
                    showRecurring: campaignPage.showRecurring !== false,
                    minimumDonation: Number(campaignPage.amountCards?.[0]?.value || 0),
                    recommendedAmount: Number(campaignPage.amountCards?.[2]?.value || campaignPage.amountCards?.[0]?.value || 0),
                    presets: cloneSerializable(campaignPage.amountCards || []),
                  },
                  ambassadors: {
                    ...cloneSerializable(builder.ambassadors),
                    records: cloneSerializable(ambassadorDirectory),
                  },
                  teams: cloneSerializable(builder.teams),
                  goals: {
                    ...cloneSerializable(builder.goals),
                    campaignGoal: Number(goals.total || 0),
                    dailyGoal: Number(goals.daily || 0),
                    placePrizes: cloneSerializable(prizeModel.placePrizes || []),
                    tierPrizes: cloneSerializable(prizeModel.tierPrizes || []),
                    tierRuleNote: String(prizeModel.tierRuleNote || builder.goals?.tierRuleNote || "").trim(),
                  },
                  dataSource: cloneSerializable(sourceConfig),
                  permissions: cloneSerializable(builder.permissions),
                  templates: cloneSerializable(builder.templates),
                  review: cloneSerializable(builder.review),
                  ui: cloneSerializable(builder.ui),
                  meta: cloneSerializable(builder.meta),
                };
              }

              function buildCampaignBuilderConfigFromSnapshot(snapshot, fallback = null) {
                if (!snapshot || typeof snapshot !== "object") {
                  return normalizeCampaignBuilderConfig(fallback);
                }
                return normalizeCampaignBuilderConfig(snapshot);
              }

              function buildCampaignPageSettingsFromSnapshot(snapshot, fallback = null) {
                const base = normalizeCampaignPageSettings(fallback || INITIAL_CAMPAIGN_PAGE_SETTINGS);
                if (!snapshot || typeof snapshot !== "object") {
                  return base;
                }
                const builder = normalizeCampaignBuilderConfig(snapshot);
                const branding = snapshot.branding && typeof snapshot.branding === "object" ? snapshot.branding : {};
                const donation = snapshot.donation && typeof snapshot.donation === "object" ? snapshot.donation : {};
                return normalizeCampaignPageSettings({
                  ...base,
                  projectSlug: builder.basics.slug || base.projectSlug,
                  projectDatesLabel: buildProjectWindowLabelFromBasics(builder.basics) || branding.projectDatesLabel || base.projectDatesLabel,
                  eyebrow: branding.eyebrow || base.eyebrow,
                  title: branding.title || builder.basics.campaignName || base.title,
                  subtitle: branding.subtitle || base.subtitle,
                  storyMarkdown: branding.storyMarkdown || base.storyMarkdown,
                  primaryCtaLabel: branding.primaryCtaLabel || base.primaryCtaLabel,
                  secondaryCtaLabel: branding.secondaryCtaLabel || base.secondaryCtaLabel,
                  externalDonationUrl: donation.externalDonationUrl || base.externalDonationUrl,
                  trustNote: donation.trustNote || base.trustNote,
                  successHint: donation.successHint || base.successHint,
                  mediaType: branding.mediaType || base.mediaType,
                  mediaUrl: branding.mediaUrl || base.mediaUrl,
                  mediaAlt: branding.mediaAlt || base.mediaAlt,
                  campaignLogoUrl: branding.campaignLogoUrl || base.campaignLogoUrl,
                  organizationLogoUrl: branding.organizationLogoUrl || base.organizationLogoUrl,
                  fontFamily: branding.fontFamily || base.fontFamily,
                  theme: branding.theme || base.theme,
                  amountCards: donation.presets || base.amountCards,
                  showRecurring: donation.showRecurring !== false,
                });
              }

              function buildGoalsFromCampaignSnapshot(snapshot, fallback = null) {
                const base = {
                  total: Number(fallback?.total || 0),
                  daily: Number(fallback?.daily || 0),
                };
                if (!snapshot || typeof snapshot !== "object") {
                  return base;
                }
                const builder = normalizeCampaignBuilderConfig(snapshot);
                const goals = snapshot.goals && typeof snapshot.goals === "object" ? snapshot.goals : {};
                return {
                  total: Number(goals.campaignGoal || builder.basics.target || base.total || 0),
                  daily: Number(goals.dailyGoal || base.daily || 0),
                };
              }

              function buildPrizeModelFromCampaignSnapshot(snapshot, fallback = null) {
                const base = normalizePrizeModel(cloneSerializable(fallback || INITIAL_PRIZES));
                if (!snapshot || typeof snapshot !== "object") {
                  return base;
                }
                const goals = snapshot.goals && typeof snapshot.goals === "object" ? snapshot.goals : {};
                return normalizePrizeModel({
                  placePrizes: cloneSerializable(goals.placePrizes || base.placePrizes || []),
                  tierPrizes: cloneSerializable(goals.tierPrizes || base.tierPrizes || []),
                  tierRuleNote: String(goals.tierRuleNote || base.tierRuleNote || "").trim(),
                });
              }

              function buildSourceConfigFromCampaignSnapshot(snapshot, fallback = null) {
                if (!snapshot || typeof snapshot !== "object" || !snapshot.dataSource) {
                  return normalizeSourceConfig(fallback || getDefaultSourceConfig());
                }
                return normalizeSourceConfig(snapshot.dataSource);
              }

              function buildAmbassadorDirectoryFromCampaignSnapshot(snapshot, fallback = null) {
                if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.ambassadors?.records)) {
                  return normalizeAmbassadorDirectory(fallback || []);
                }
                return normalizeAmbassadorDirectory(snapshot.ambassadors.records);
              }

              function createDefaultCampaignSnapshot() {
                return buildCampaignSnapshotFromStateParts({
                  builderConfig: normalizeCampaignBuilderConfig(null),
                  campaignPage: normalizeCampaignPageSettings(cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS)),
                  goals: { total: 0, daily: 0 },
                  prizeModel: cloneSerializable(INITIAL_PRIZES),
                  sourceConfig: getDefaultSourceConfig(),
                  ambassadorDirectory: [],
                });
              }

              function createCampaignRegistryEntry(config, overrides = {}) {
                const snapshot = buildCampaignSnapshotFromStateParts({
                  builderConfig: buildCampaignBuilderConfigFromSnapshot(config),
                  campaignPage: buildCampaignPageSettingsFromSnapshot(config, INITIAL_CAMPAIGN_PAGE_SETTINGS),
                  goals: buildGoalsFromCampaignSnapshot(config),
                  prizeModel: buildPrizeModelFromCampaignSnapshot(config),
                  sourceConfig: buildSourceConfigFromCampaignSnapshot(config),
                  ambassadorDirectory: buildAmbassadorDirectoryFromCampaignSnapshot(config),
                });
                const timestamp = new Date().toISOString();
                const campaignName = String(overrides.name || snapshot.basics.campaignName || "Campaign").trim() || "Campaign";
                const slug = normalizeUrlSlug(overrides.slug || snapshot.basics.slug || campaignName || "campaign") || "campaign";
                const idSeed = String(overrides.id || `${slug}-${Date.now()}`).trim();
                return {
                  id: normalizeUrlSlug(idSeed) || `campaign-${Date.now()}`,
                  name: campaignName,
                  slug,
                  updatedAt: String(overrides.updatedAt || snapshot.meta?.lastSavedAt || timestamp).trim(),
                  updatedBy: normalizeSearchToken(overrides.updatedBy || snapshot.meta?.lastSavedBy || ""),
                  config: snapshot,
                };
              }

              function normalizeCampaignRegistry(value) {
                const raw = value && typeof value === "object" ? value : {};
                const legacySnapshotCandidate =
                  raw?.config && typeof raw.config === "object" && !Array.isArray(raw.config)
                    ? raw.config
                    : raw?.campaigns
                      ? null
                      : raw;
                const campaignCandidates = Array.isArray(raw.campaigns)
                  ? raw.campaigns
                  : legacySnapshotCandidate && Object.keys(legacySnapshotCandidate).length
                    ? [
                        {
                          id: raw.id,
                          name: raw.name,
                          slug: raw.slug,
                          updatedAt: raw.updatedAt,
                          updatedBy: raw.updatedBy,
                          config: legacySnapshotCandidate,
                        },
                      ]
                    : [];
                const usedIds = new Set();
                const campaigns = campaignCandidates
                  .map((item, index) => {
                    const entry = createCampaignRegistryEntry(item?.config || item, {
                      id: item?.id || `campaign-${index + 1}`,
                      name: item?.name,
                      slug: item?.slug,
                      updatedAt: item?.updatedAt,
                      updatedBy: item?.updatedBy,
                    });
                    let nextId = entry.id;
                    let suffix = 2;
                    while (!nextId || usedIds.has(nextId)) {
                      nextId = `${entry.id || "campaign"}-${suffix}`;
                      suffix += 1;
                    }
                    usedIds.add(nextId);
                    return {
                      ...entry,
                      id: nextId,
                    };
                  })
                  .filter((item) => item?.id && item?.config);
                const seededCampaigns = campaigns.length ? campaigns : [createCampaignRegistryEntry(createDefaultCampaignSnapshot())];
                const slugSet = new Set();
                seededCampaigns.forEach((item, index) => {
                  let nextSlug = normalizeUrlSlug(item.slug || item.name || `campaign-${index + 1}`) || `campaign-${index + 1}`;
                  let suffix = 2;
                  while (slugSet.has(nextSlug)) {
                    nextSlug = `${normalizeUrlSlug(item.slug || item.name || "campaign") || "campaign"}-${suffix}`;
                    suffix += 1;
                  }
                  slugSet.add(nextSlug);
                  item.slug = nextSlug;
                  item.name = item.name || `Campaign ${index + 1}`;
                  item.config = buildCampaignSnapshotFromStateParts({
                    builderConfig: buildCampaignBuilderConfigFromSnapshot(item.config),
                    campaignPage: buildCampaignPageSettingsFromSnapshot(item.config, INITIAL_CAMPAIGN_PAGE_SETTINGS),
                    goals: buildGoalsFromCampaignSnapshot(item.config),
                    prizeModel: buildPrizeModelFromCampaignSnapshot(item.config),
                    sourceConfig: buildSourceConfigFromCampaignSnapshot(item.config),
                    ambassadorDirectory: buildAmbassadorDirectoryFromCampaignSnapshot(item.config),
                  });
                  const organizationName = String(item.config.basics.organizationName || "").trim();
                  const organizationSlug = normalizeUrlSlug(item.config.basics.organizationSlug || organizationName || "organization") || "organization";
                  const organizationId = normalizeUrlSlug(item.config.basics.organizationId || organizationSlug) || organizationSlug;
                  item.config.organization = {
                    id: organizationId,
                    slug: organizationSlug,
                    name: organizationName || "Organization",
                  };
                  item.config.basics.id = item.id;
                  item.config.basics.organizationId = organizationId;
                  item.config.basics.organizationSlug = organizationSlug;
                  item.config.basics.slug = item.slug;
                  item.config.basics.campaignName = item.name;
                  item.config.meta.lastSavedAt = String(item.updatedAt || item.config.meta?.lastSavedAt || "").trim();
                  item.config.meta.lastSavedBy = normalizeSearchToken(item.updatedBy || item.config.meta?.lastSavedBy || "");
                });
                const activeCampaignId = seededCampaigns.some((item) => item.id === raw.activeCampaignId)
                  ? raw.activeCampaignId
                  : seededCampaigns[0].id;
                return {
                  version: 1,
                  activeCampaignId,
                  campaigns: seededCampaigns,
                };
              }

              function readStoredCampaignRegistry() {
                try {
                  const raw = window.localStorage.getItem(CAMPAIGN_REGISTRY_STORAGE_KEY);
                  if (raw) {
                    return normalizeCampaignRegistry(JSON.parse(raw));
                  }
                } catch (_error) {
                  return normalizeCampaignRegistry(null);
                }
                const legacySnapshot = buildCampaignSnapshotFromStateParts({
                  builderConfig: readStoredCampaignBuilderConfig(),
                  campaignPage: readStoredCampaignPageSettings() || INITIAL_CAMPAIGN_PAGE_SETTINGS,
                  goals: readStoredGoals(),
                  prizeModel: readStoredPrizeModel() || INITIAL_PRIZES,
                  sourceConfig: getDefaultSourceConfig(),
                  ambassadorDirectory: readStoredAmbassadorDirectory(),
                });
                return normalizeCampaignRegistry(legacySnapshot);
              }

              function storeCampaignRegistry(registry) {
                try {
                  window.localStorage.setItem(CAMPAIGN_REGISTRY_STORAGE_KEY, JSON.stringify(normalizeCampaignRegistry(registry)));
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function getCampaignRegistryActiveEntry(registry = state?.campaignRegistry) {
                const normalized = normalizeCampaignRegistry(registry);
                return normalized.campaigns.find((item) => item.id === normalized.activeCampaignId) || normalized.campaigns[0] || null;
              }

              function getActiveCampaignIdentity(registry = state?.campaignRegistry, campaignId = state?.activeCampaignId || "") {
                const normalized = normalizeCampaignRegistry(registry);
                const serverScope = state?.auth?.currentScope && typeof state.auth.currentScope === "object" ? state.auth.currentScope : {};
                const targetEntry =
                  normalized.campaigns.find((item) => item.id === String(campaignId || "").trim()) ||
                  normalized.campaigns.find((item) => item.id === normalized.activeCampaignId) ||
                  normalized.campaigns[0] ||
                  null;
                const basics = targetEntry?.config?.basics && typeof targetEntry.config.basics === "object" ? targetEntry.config.basics : {};
                const organization = targetEntry?.config?.organization && typeof targetEntry.config.organization === "object" ? targetEntry.config.organization : {};
                const organizationName = String(organization.name || basics.organizationName || "").trim();
                const organizationSlug = String(
                  organization.slug || basics.organizationSlug || normalizeUrlSlug(organizationName || "organization")
                ).trim();
                const campaignName = String(targetEntry?.name || basics.campaignName || "").trim();
                const campaignSlug = String(
                  targetEntry?.slug || basics.slug || serverScope.campaignId || normalizeUrlSlug(campaignName || "campaign")
                ).trim();
                return {
                  organizationId: String(serverScope.organizationId || organization.id || basics.organizationId || organizationSlug || "organization").trim(),
                  organizationSlug,
                  organizationName: organizationName || "Organization",
                  campaignId: String(serverScope.campaignId || targetEntry?.id || basics.id || campaignSlug || "campaign").trim(),
                  campaignSlug,
                  campaignName: campaignName || "Campaign",
                };
              }

              function normalizeCampaignBuilderConfig(value) {
                const defaults = createCampaignBuilderDefaults();
                const candidate = value && typeof value === "object" ? value : {};
                const basics = candidate.basics && typeof candidate.basics === "object" ? candidate.basics : {};
                const teams = candidate.teams && typeof candidate.teams === "object" ? candidate.teams : {};
                const permissions = candidate.permissions && typeof candidate.permissions === "object" ? candidate.permissions : {};
                const ambassadors = candidate.ambassadors && typeof candidate.ambassadors === "object" ? candidate.ambassadors : {};
                const goals = candidate.goals && typeof candidate.goals === "object" ? candidate.goals : {};
                const templates = candidate.templates && typeof candidate.templates === "object" ? candidate.templates : {};
                const review = candidate.review && typeof candidate.review === "object" ? candidate.review : {};
                const uiState = candidate.ui && typeof candidate.ui === "object" ? candidate.ui : {};
                const meta = candidate.meta && typeof candidate.meta === "object" ? candidate.meta : {};
                return {
                  basics: {
                    id: normalizeUrlSlug(basics.id || ""),
                    campaignName: String(basics.campaignName || defaults.basics.campaignName || "").trim(),
                    organizationId: normalizeUrlSlug(basics.organizationId || ""),
                    organizationName: String(basics.organizationName || defaults.basics.organizationName || "").trim(),
                    organizationSlug: normalizeUrlSlug(basics.organizationSlug || ""),
                    slug: normalizeUrlSlug(basics.slug || defaults.basics.slug || "campaign"),
                    target: Number(basics.target || defaults.basics.target || 0),
                    currency: ["ILS", "USD", "EUR"].includes(String(basics.currency || "").trim().toUpperCase())
                      ? String(basics.currency).trim().toUpperCase()
                      : defaults.basics.currency,
                    startDate: String(basics.startDate || defaults.basics.startDate || "").trim(),
                    startTime: String(basics.startTime || defaults.basics.startTime || "00:00").trim(),
                    endDate: String(basics.endDate || defaults.basics.endDate || "").trim(),
                    endTime: String(basics.endTime || defaults.basics.endTime || "23:59").trim(),
                    timeZone: String(basics.timeZone || defaults.basics.timeZone || "Asia/Jerusalem").trim(),
                    status: ["draft", "scheduled", "live", "paused", "completed", "archived"].includes(String(basics.status || "").trim().toLowerCase())
                      ? String(basics.status).trim().toLowerCase()
                      : defaults.basics.status,
                  },
                  teams: {
                    enabled: Boolean(teams.enabled),
                    groups: Array.isArray(teams.groups)
                      ? teams.groups
                          .map((group) => ({
                            name: String(group?.name || "").trim(),
                            manager: String(group?.manager || "").trim(),
                            target: Number(group?.target || 0),
                          }))
                          .filter((group) => group.name)
                      : [],
                  },
                  permissions: {
                    admins: Array.isArray(permissions.admins) ? permissions.admins.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
                    managers: Array.isArray(permissions.managers) ? permissions.managers.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
                    viewers: Array.isArray(permissions.viewers) ? permissions.viewers.map((item) => normalizeSearchToken(item)).filter(Boolean) : [],
                  },
                  ambassadors: {
                    importMode: String(ambassadors.importMode || defaults.ambassadors.importMode || "csv").trim().toLowerCase() === "manual" ? "manual" : "csv",
                    personalTargetDefault: Number(ambassadors.personalTargetDefault || 0),
                    manualDraft: {
                      fullName: String(ambassadors.manualDraft?.fullName || "").trim(),
                      nickname: normalizeUrlSlug(ambassadors.manualDraft?.nickname || ""),
                      email: normalizeSearchToken(ambassadors.manualDraft?.email || ""),
                      phone: String(ambassadors.manualDraft?.phone || "").trim(),
                      team: String(ambassadors.manualDraft?.team || "").trim(),
                      personalTarget: String(ambassadors.manualDraft?.personalTarget || "").trim(),
                    },
                  },
                  goals: {
                    ambassadorGoal: Number(goals.ambassadorGoal || 0),
                    teamGoal: Number(goals.teamGoal || 0),
                    tierRuleNote: String(goals.tierRuleNote || defaults.goals.tierRuleNote || "").trim(),
                  },
                  templates: {
                    type: ["ambassador", "community", "emergency", "annual-recurring", "short", "long-running"].includes(String(templates.type || "").trim())
                      ? String(templates.type).trim()
                      : defaults.templates.type,
                    duplicatedFromSlug: normalizeUrlSlug(templates.duplicatedFromSlug || ""),
                  },
                  review: {
                    launchedAt: String(review.launchedAt || "").trim(),
                  },
                  ui: {
                    previewMode: String(uiState.previewMode || defaults.ui.previewMode || "desktop").trim().toLowerCase() === "mobile" ? "mobile" : "desktop",
                  },
                  meta: {
                    lastSavedAt: String(meta.lastSavedAt || "").trim(),
                    lastSavedBy: normalizeSearchToken(meta.lastSavedBy || ""),
                  },
                };
              }

              function readStoredCampaignBuilderConfig() {
                try {
                  const raw = window.localStorage.getItem(CAMPAIGN_BUILDER_CONFIG_KEY);
                  return raw ? normalizeCampaignBuilderConfig(JSON.parse(raw)) : normalizeCampaignBuilderConfig(null);
                } catch (_error) {
                  return normalizeCampaignBuilderConfig(null);
                }
              }

              function storeCampaignBuilderConfig(config) {
                try {
                  window.localStorage.setItem(CAMPAIGN_BUILDER_CONFIG_KEY, JSON.stringify(normalizeCampaignBuilderConfig(config)));
                  return true;
                } catch (_error) {
                  return false;
                }
              }

              function getCampaignBuilderSnapshot() {
                return buildCampaignSnapshotFromStateParts({
                  builderConfig: state.campaignBuilder,
                  campaignPage: state.campaignPage,
                  goals: state.goals,
                  prizeModel: state.prizeModel,
                  sourceConfig: state.sourceConfig,
                  ambassadorDirectory: state.ambassadorDirectory,
                });
              }

              function applyCampaignBuilderConfig(config, options = {}) {
                const raw = config && typeof config === "object" ? config : {};
                const normalized = normalizeCampaignBuilderConfig(raw);
                const branding = raw.branding && typeof raw.branding === "object" ? raw.branding : {};
                const donation = raw.donation && typeof raw.donation === "object" ? raw.donation : {};
                const goals = raw.goals && typeof raw.goals === "object" ? raw.goals : {};
                state.campaignBuilder = normalized;
                state.campaignPage = normalizeCampaignPageSettings({
                  ...state.campaignPage,
                  projectSlug: normalized.basics.slug,
                  projectDatesLabel: buildProjectWindowLabelFromBasics(normalized.basics),
                  eyebrow: branding.eyebrow || state.campaignPage.eyebrow,
                  title: branding.title || normalized.basics.campaignName || state.campaignPage.title,
                  subtitle: branding.subtitle || state.campaignPage.subtitle,
                  storyMarkdown: branding.storyMarkdown || state.campaignPage.storyMarkdown,
                  primaryCtaLabel: branding.primaryCtaLabel || state.campaignPage.primaryCtaLabel,
                  secondaryCtaLabel: branding.secondaryCtaLabel || state.campaignPage.secondaryCtaLabel,
                  externalDonationUrl: donation.externalDonationUrl || state.campaignPage.externalDonationUrl,
                  trustNote: donation.trustNote || state.campaignPage.trustNote,
                  successHint: donation.successHint || state.campaignPage.successHint,
                  mediaType: branding.mediaType || state.campaignPage.mediaType,
                  mediaUrl: branding.mediaUrl || state.campaignPage.mediaUrl,
                  mediaAlt: branding.mediaAlt || state.campaignPage.mediaAlt,
                  fontFamily: branding.fontFamily || state.campaignPage.fontFamily,
                  theme: branding.theme || state.campaignPage.theme,
                  amountCards: donation.presets || state.campaignPage.amountCards,
                  showRecurring: donation.showRecurring !== false,
                });
                state.goals = {
                  total: Number(goals.campaignGoal || normalized.basics.target || 0),
                  daily: Number(goals.dailyGoal || 0),
                };
                state.prizeModel = normalizePrizeModel({
                  placePrizes: cloneSerializable(goals.placePrizes || state.prizeModel?.placePrizes || []),
                  tierPrizes: cloneSerializable(goals.tierPrizes || state.prizeModel?.tierPrizes || []),
                  tierRuleNote: String(goals.tierRuleNote || state.prizeModel?.tierRuleNote || "").trim(),
                });
                if (!options.preserveSourceConfig && raw.dataSource) {
                  state.sourceConfig = normalizeSourceConfig(raw.dataSource);
                }
                if (Array.isArray(raw.ambassadors?.records)) {
                  state.ambassadorDirectory = normalizeAmbassadorDirectory(raw.ambassadors.records);
                }
                state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
              }

              function persistActiveCampaignLegacyState() {
                return [
                  storeCampaignBuilderConfig(state.campaignBuilder),
                  storeCampaignPageSettings(state.campaignPage),
                  storeGoals(state.goals),
                  storePrizeModel(state.prizeModel),
                  storeAmbassadorDirectory(state.ambassadorDirectory),
                ].every(Boolean);
              }

              function syncCampaignRegistryFromState(options = {}) {
                const normalized = normalizeCampaignRegistry(state.campaignRegistry);
                const activeId = String(options.campaignId || state.activeCampaignId || normalized.activeCampaignId || "").trim();
                const snapshot = getCampaignBuilderSnapshot();
                const campaigns = normalized.campaigns.map((item) => {
                  if (item.id !== activeId) {
                    return item;
                  }
                  const nextEntry = createCampaignRegistryEntry(snapshot, {
                    id: item.id,
                    name: snapshot.basics.campaignName || item.name,
                    slug: snapshot.basics.slug || item.slug,
                    updatedAt: options.updatedAt || snapshot.meta?.lastSavedAt || item.updatedAt,
                    updatedBy: options.updatedBy || snapshot.meta?.lastSavedBy || item.updatedBy,
                  });
                  nextEntry.config.meta.lastSavedAt = String(nextEntry.updatedAt || "").trim();
                  nextEntry.config.meta.lastSavedBy = normalizeSearchToken(nextEntry.updatedBy || "");
                  return nextEntry;
                });
                const nextRegistry = normalizeCampaignRegistry({
                  ...normalized,
                  activeCampaignId: activeId || normalized.activeCampaignId,
                  campaigns,
                });
                state.campaignRegistry = nextRegistry;
                state.activeCampaignId = nextRegistry.activeCampaignId;
                if (options.persistRegistry !== false) {
                  storeCampaignRegistry(nextRegistry);
                }
                if (options.persistLegacy !== false) {
                  persistActiveCampaignLegacyState();
                }
                return nextRegistry;
              }

              async function switchActiveCampaign(campaignId, options = {}) {
                const currentRegistry = options.skipCurrentSync ? normalizeCampaignRegistry(state.campaignRegistry) : syncCampaignRegistryFromState({ persistRegistry: false });
                const nextRegistry = normalizeCampaignRegistry({
                  ...currentRegistry,
                  activeCampaignId: campaignId,
                });
                const targetEntry = getCampaignRegistryActiveEntry(nextRegistry);
                if (!targetEntry) {
                  return false;
                }
                state.campaignRegistry = nextRegistry;
                state.activeCampaignId = targetEntry.id;
                applyCampaignBuilderConfig(targetEntry.config, { preserveSourceConfig: false });
                persistActiveCampaignLegacyState();
                storeCampaignRegistry(state.campaignRegistry);
                if (canUseBackendAuth() && isManagerAuthenticated()) {
                  await loadProtectedManagerData(getActiveCampaignIdentity(nextRegistry, targetEntry.id), {
                    includeCampaignBuilder: state.ui.adminTab === "design",
                  });
                }
                if (options.message) {
                  setCampaignBuilderStatus(options.message, "success");
                }
                return true;
              }

              function getUniqueCampaignName(baseName, registry = state.campaignRegistry) {
                const normalized = normalizeCampaignRegistry(registry);
                const preferred = String(baseName || "Campaign").trim() || "Campaign";
                const used = new Set(normalized.campaigns.map((item) => String(item.name || "").trim()));
                if (!used.has(preferred)) {
                  return preferred;
                }
                let index = 2;
                while (used.has(`${preferred} ${index}`)) {
                  index += 1;
                }
                return `${preferred} ${index}`;
              }

              function getUniqueCampaignSlug(baseSlug, registry = state.campaignRegistry) {
                const normalized = normalizeCampaignRegistry(registry);
                const preferred = normalizeUrlSlug(baseSlug || "campaign") || "campaign";
                const used = new Set(normalized.campaigns.map((item) => normalizeUrlSlug(item.slug || "")));
                if (!used.has(preferred)) {
                  return preferred;
                }
                let index = 2;
                while (used.has(`${preferred}-${index}`)) {
                  index += 1;
                }
                return `${preferred}-${index}`;
              }

              function createNewCampaignDraft() {
                const currentRegistry = syncCampaignRegistryFromState({ persistRegistry: false });
                const currentScope = getActiveCampaignIdentity(currentRegistry, currentRegistry.activeCampaignId);
                const snapshot = createDefaultCampaignSnapshot();
                const name = getUniqueCampaignName("קמפיין חדש", currentRegistry);
                const slug = getUniqueCampaignSlug("new-campaign", currentRegistry);
                snapshot.basics.campaignName = name;
                snapshot.basics.slug = slug;
                snapshot.organization = {
                  ...(snapshot.organization || {}),
                  id: currentScope.organizationId,
                  slug: currentScope.organizationSlug,
                  name: currentScope.organizationName,
                };
                snapshot.basics.organizationId = currentScope.organizationId;
                snapshot.basics.organizationSlug = currentScope.organizationSlug;
                snapshot.basics.organizationName = currentScope.organizationName;
                snapshot.branding.title = name;
                snapshot.branding.projectDatesLabel = buildProjectWindowLabelFromBasics(snapshot.basics);
                const entry = createCampaignRegistryEntry(snapshot, { name, slug });
                const nextRegistry = normalizeCampaignRegistry({
                  ...currentRegistry,
                  activeCampaignId: entry.id,
                  campaigns: [...currentRegistry.campaigns, entry],
                });
                state.campaignRegistry = nextRegistry;
                state.activeCampaignId = entry.id;
                applyCampaignBuilderConfig(entry.config, { preserveSourceConfig: false });
                persistActiveCampaignLegacyState();
                storeCampaignRegistry(nextRegistry);
                setCampaignBuilderStatus(`נוצר קמפיין חדש: ${name}.`, "success");
                return entry;
              }

              function formatCampaignSavedAt(isoText) {
                if (!isoText) {
                  return "טרם נשמר";
                }
                return formatDateTime(isoText);
              }

              function buildCampaignPreflight(snapshot) {
                const ready = [];
                const warnings = [];
                const blocking = [];
                const basics = snapshot.basics || {};
                const donation = snapshot.donation || {};
                const ambassadors = snapshot.ambassadors || {};
                const goals = snapshot.goals || {};
                const dataSource = snapshot.dataSource || {};
                const permissions = snapshot.permissions || {};

                if (basics.campaignName) {
                  ready.push(`זהות קמפיין: ${basics.campaignName}`);
                } else {
                  blocking.push("חסרה כותרת קמפיין.");
                }
                if (basics.slug) {
                  ready.push(`Slug ציבורי: ${basics.slug}`);
                } else {
                  blocking.push("חסר slug ציבורי.");
                }
                if (Number(basics.target || 0) > 0) {
                  ready.push(`יעד קמפיין: ${formatAmount(basics.target)}`);
                } else {
                  blocking.push("יש להגדיר יעד גיוס גדול מ־0.");
                }
                if (basics.startDate && basics.endDate) {
                  ready.push(`חלון קמפיין: ${formatDate(basics.startDate)} עד ${formatDate(basics.endDate)}`);
                  if (`${basics.endDate}T${basics.endTime || "23:59"}` < `${basics.startDate}T${basics.startTime || "00:00"}`) {
                    blocking.push("תאריך/שעת הסיום מוקדמים מתאריך/שעת ההתחלה.");
                  }
                } else {
                  blocking.push("יש להגדיר תאריכי התחלה וסיום.");
                }
                if (donation.presets?.length) {
                  ready.push(`${formatNumber(donation.presets.length)} סכומי תרומה מוכנים.`);
                } else {
                  blocking.push("אין סכומי תרומה מוגדרים.");
                }
                if (donation.externalDonationUrl) {
                  ready.push("קיים handoff לסליקה חיצונית.");
                } else {
                  blocking.push("חסר קישור חיצוני להמשך התרומה.");
                }
                if (ambassadors.records?.length) {
                  ready.push(`${formatNumber(ambassadors.records.length)} שגרירים מוכנים.`);
                } else {
                  warnings.push("עדיין לא נטענו שגרירים.");
                }
                if (goals.placePrizes?.length || goals.tierPrizes?.length) {
                  ready.push("מודל פרסים פעיל.");
                } else {
                  warnings.push("אין טבלת פרסים פעילה.");
                }
                if (dataSource.mode === "api") {
                  if (dataSource.api?.endpoint) {
                    ready.push("חיבור API הוגדר.");
                  } else {
                    blocking.push("מצב API נבחר אך חסר endpoint.");
                  }
                } else {
                  warnings.push("המערכת במצב טעינת קובץ ולא במצב API.");
                }
                if ((permissions.admins?.length || 0) + (permissions.managers?.length || 0) > 0) {
                  ready.push("הוגדרו בעלי גישה ניהולית לקמפיין.");
                } else {
                  warnings.push("לא הוגדרו עדיין תפקידי מנהלים בתוך ה־builder.");
                }
                return { ready, warnings, blocking };
              }

              function setValueAtPath(target, path, rawValue) {
                const segments = String(path || "").split(".").filter(Boolean);
                if (!segments.length || !target || typeof target !== "object") {
                  return;
                }
                let current = target;
                while (segments.length > 1) {
                  const segment = segments.shift();
                  if (!current[segment] || typeof current[segment] !== "object") {
                    current[segment] = {};
                  }
                  current = current[segment];
                }
                current[segments[0]] = rawValue;
              }

              function parseEmailLines(text) {
                return String(text || "")
                  .split(/\\r?\\n|,/)
                  .map((item) => normalizeSearchToken(item))
                  .filter(Boolean);
              }

              function serializeEmailLines(items) {
                return Array.isArray(items) ? items.join("\\n") : "";
              }

              function applyCampaignTemplate(templateType) {
                const template = String(templateType || "").trim();
                const nextBuilder = normalizeCampaignBuilderConfig(state.campaignBuilder);
                nextBuilder.templates.type = template;
                if (template === "emergency") {
                  nextBuilder.basics.status = "scheduled";
                  nextBuilder.basics.endDate = nextBuilder.basics.startDate || nextBuilder.basics.endDate;
                  state.campaignPage.primaryCtaLabel = "לתרומה מיידית";
                } else if (template === "community") {
                  state.campaignPage.primaryCtaLabel = "מצטרפים לקמפיין הקהילתי";
                } else if (template === "long-running") {
                  nextBuilder.basics.status = "live";
                } else {
                  state.campaignPage.primaryCtaLabel = INITIAL_CAMPAIGN_PAGE_SETTINGS.primaryCtaLabel;
                }
                state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
                queueCampaignBuilderAutosave("תבנית הקמפיין עודכנה ונשמרת בטיוטה.");
              }

              function duplicateCampaignBuilderDraft() {
                const currentRegistry = syncCampaignRegistryFromState({ persistRegistry: false });
                const snapshot = getCampaignBuilderSnapshot();
                const copyName = getUniqueCampaignName(`${snapshot.basics.campaignName || "Campaign"} Copy`, currentRegistry);
                const copySlug = getUniqueCampaignSlug(`${snapshot.basics.slug || "campaign"}-copy`, currentRegistry);
                snapshot.basics.campaignName = copyName;
                snapshot.basics.slug = copySlug;
                snapshot.basics.status = "draft";
                snapshot.templates = {
                  ...snapshot.templates,
                  duplicatedFromSlug: getCampaignProjectSlug(),
                };
                snapshot.review = {
                  ...snapshot.review,
                  launchedAt: "",
                };
                snapshot.meta = {
                  ...snapshot.meta,
                  lastSavedAt: "",
                  lastSavedBy: "",
                };
                snapshot.branding.title = copyName;
                const entry = createCampaignRegistryEntry(snapshot, { name: copyName, slug: copySlug });
                const nextRegistry = normalizeCampaignRegistry({
                  ...currentRegistry,
                  activeCampaignId: entry.id,
                  campaigns: [...currentRegistry.campaigns, entry],
                });
                state.campaignRegistry = nextRegistry;
                state.activeCampaignId = entry.id;
                applyCampaignBuilderConfig(entry.config, { preserveSourceConfig: false });
                persistActiveCampaignLegacyState();
                storeCampaignRegistry(nextRegistry);
                setCampaignBuilderStatus(`נוצר קמפיין משוכפל חדש עבור ${copyName}.`, "success");
                renderCampaignDesigner(true);
                renderProjectPage();
              }

              let campaignBuilderAutosaveTimerId = 0;

              function clearCampaignBuilderAutosaveTimer() {
                if (campaignBuilderAutosaveTimerId) {
                  window.clearTimeout(campaignBuilderAutosaveTimerId);
                  campaignBuilderAutosaveTimerId = 0;
                }
              }

              function queueCampaignBuilderAutosave(message = "טיוטת הקמפיין נשמרת...") {
                clearCampaignBuilderAutosaveTimer();
                setCampaignBuilderStatus(message, "neutral");
                campaignBuilderAutosaveTimerId = window.setTimeout(() => {
                  void saveCampaignBuilderConfig({ silent: true });
                }, 700);
              }

              async function saveCampaignBuilderConfig(options = {}) {
                const snapshot = getCampaignBuilderSnapshot();
                const localRegistry = syncCampaignRegistryFromState({ persistRegistry: false, persistLegacy: false });
                const scope = getActiveCampaignIdentity(localRegistry, localRegistry.activeCampaignId);
                const persistedLocal = [storeCampaignRegistry(localRegistry), persistActiveCampaignLegacyState()].every(Boolean);
                if (!persistedLocal && !options.silent) {
                  setCampaignBuilderStatus("חלק מהטיוטה לא נשמר מקומית בדפדפן.", "warning");
                }
                const endpoint = buildScopedAdminEndpoint("campaign-config", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  state.campaignBuilder.meta.lastSavedAt = new Date().toISOString();
                  state.campaignBuilder.meta.lastSavedBy = state.session?.email || "";
                  syncCampaignRegistryFromState({
                    updatedAt: state.campaignBuilder.meta.lastSavedAt,
                    updatedBy: state.campaignBuilder.meta.lastSavedBy,
                  });
                  setCampaignBuilderStatus(`טיוטת קמפיין נשמרה מקומית Â· ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
                  return snapshot;
                }
                const { response, payload } = await authRequest(endpoint, {
                  method: "POST",
                  body: { config: localRegistry },
                });
                if (!response.ok) {
                  throw new Error(payload?.message || "שמירת טיוטת הקמפיין בשרת נכשלה.");
                }
                applyServerScope(payload, scope);
                state.campaignBuilder.meta.lastSavedAt = payload?.updatedAt || new Date().toISOString();
                state.campaignBuilder.meta.lastSavedBy = payload?.updatedBy || state.session?.email || "";
                state.campaignRegistry = normalizeCampaignRegistry(payload?.config || localRegistry);
                state.activeCampaignId = state.campaignRegistry.activeCampaignId;
                syncCampaignRegistryFromState({
                  updatedAt: state.campaignBuilder.meta.lastSavedAt,
                  updatedBy: state.campaignBuilder.meta.lastSavedBy,
                });
                setCampaignBuilderStatus(`נשמר בשרת Â· ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
                return getCampaignRegistryActiveEntry(state.campaignRegistry)?.config || snapshot;
              }

              async function hydrateCampaignBuilderConfig(scope = getActiveCampaignIdentity()) {
                const localRegistry = readStoredCampaignRegistry();
                state.campaignRegistry = localRegistry;
                state.activeCampaignId = localRegistry.activeCampaignId;
                const localEntry = getCampaignRegistryActiveEntry(localRegistry);
                if (localEntry?.config) {
                  applyCampaignBuilderConfig(localEntry.config, { preserveSourceConfig: false });
                } else {
                  const localConfig = readStoredCampaignBuilderConfig();
                  state.campaignBuilder = normalizeCampaignBuilderConfig(localConfig);
                  applyCampaignBuilderConfig(getCampaignBuilderSnapshot(), { preserveSourceConfig: false });
                }
                persistActiveCampaignLegacyState();
                storeCampaignRegistry(state.campaignRegistry);
                const endpoint = buildScopedAdminEndpoint("campaign-config", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  state.auth.campaignConfigLoaded = false;
                  return state.campaignBuilder;
                }
                try {
                  const { response, payload } = await authRequest(endpoint);
                  if (response.ok && payload?.config) {
                    applyServerScope(payload, scope);
                    state.campaignRegistry = normalizeCampaignRegistry(payload.config);
                    state.activeCampaignId = state.campaignRegistry.activeCampaignId;
                    const activeEntry = getCampaignRegistryActiveEntry(state.campaignRegistry);
                    if (activeEntry?.config) {
                      applyCampaignBuilderConfig(activeEntry.config, { preserveSourceConfig: false });
                    }
                    state.auth.campaignConfigLoaded = true;
                    state.campaignBuilder.meta.lastSavedAt = String(payload.updatedAt || "").trim();
                    state.campaignBuilder.meta.lastSavedBy = normalizeSearchToken(payload.updatedBy || "");
                    syncCampaignRegistryFromState({
                      updatedAt: state.campaignBuilder.meta.lastSavedAt,
                      updatedBy: state.campaignBuilder.meta.lastSavedBy,
                    });
                    setCampaignBuilderStatus(`נטען מהשרת Â· ${formatCampaignSavedAt(state.campaignBuilder.meta.lastSavedAt)}`, "success");
                    return state.campaignBuilder;
                  }
                } catch (_error) {
                  state.auth.campaignConfigLoaded = false;
                }
                setCampaignBuilderStatus("לא נטענה טיוטת שרת. עובדים כרגע על הגדרות מקומיות.", "warning");
                return state.campaignBuilder;
              }

              function readStoredAdminEmail() {
                try {
                  return normalizeSearchToken(window.localStorage.getItem(LAST_ADMIN_EMAIL_KEY) || "");
                } catch (_error) {
                  return "";
                }
              }

              function storeAdminEmail(email) {
                try {
                  const normalized = normalizeSearchToken(email || "");
                  if (!normalized) {
                    window.localStorage.removeItem(LAST_ADMIN_EMAIL_KEY);
                    return;
                  }
                  window.localStorage.setItem(LAST_ADMIN_EMAIL_KEY, normalized);
                } catch (_error) {
                  return;
                }
              }

              function sanitizeHexColor(value, fallback) {
                const normalized = String(value || "").trim();
                return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized) ? normalized : fallback;
              }

              function normalizeAmountCards(rawCards) {
                if (!Array.isArray(rawCards)) {
                  return cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.amountCards || []);
                }
                const normalized = rawCards
                  .map((item) => ({
                    value: Number(item?.value || 0),
                    label: String(item?.label || "").trim(),
                    description: String(item?.description || "").trim(),
                  }))
                  .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.label);
                return normalized.length ? normalized : cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.amountCards || []);
              }

              function normalizeStats(rawStats) {
                if (!Array.isArray(rawStats)) {
                  return cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.stats || []);
                }
                const normalized = rawStats
                  .map((item) => ({
                    value: String(item?.value || "").trim(),
                    label: String(item?.label || "").trim(),
                  }))
                  .filter((item) => item.value && item.label);
                return normalized.length ? normalized : cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS.stats || []);
              }

              function normalizeCampaignPageSettings(value) {
                const defaults = cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS);
                const candidate = value && typeof value === "object" ? value : {};
                return {
                  projectDatesLabel: String(candidate.projectDatesLabel || defaults.projectDatesLabel || "").trim(),
                  platformBaseUrl: String(candidate.platformBaseUrl || defaults.platformBaseUrl || "").trim(),
                  projectSlug: normalizeUrlSlug(candidate.projectSlug || defaults.projectSlug || "campaign"),
                  eyebrow: String(candidate.eyebrow || defaults.eyebrow || "").trim(),
                  title: String(candidate.title || defaults.title || "").trim(),
                  subtitle: String(candidate.subtitle || defaults.subtitle || "").trim(),
                  storyMarkdown: String(candidate.storyMarkdown || defaults.storyMarkdown || "").trim(),
                  primaryCtaLabel: String(candidate.primaryCtaLabel || defaults.primaryCtaLabel || "").trim(),
                  secondaryCtaLabel: String(candidate.secondaryCtaLabel || defaults.secondaryCtaLabel || "").trim(),
                  externalDonationUrl: String(candidate.externalDonationUrl || defaults.externalDonationUrl || "").trim(),
                  trustNote: String(candidate.trustNote || defaults.trustNote || "").trim(),
                  successHint: String(candidate.successHint || defaults.successHint || "").trim(),
                  mediaType: candidate.mediaType === "video" ? "video" : "image",
                  mediaUrl: String(candidate.mediaUrl || defaults.mediaUrl || "").trim(),
                  mediaAlt: String(candidate.mediaAlt || defaults.mediaAlt || "").trim(),
                  campaignLogoUrl: String(candidate.campaignLogoUrl || defaults.campaignLogoUrl || "").trim(),
                  organizationLogoUrl: String(candidate.organizationLogoUrl || defaults.organizationLogoUrl || "").trim(),
                  fontFamily: ["Assistant", "Heebo", "Rubik", "Arial"].includes(String(candidate.fontFamily || ""))
                    ? String(candidate.fontFamily)
                    : defaults.fontFamily,
                  theme: {
                    primary: sanitizeHexColor(candidate.theme?.primary, defaults.theme.primary),
                    secondary: sanitizeHexColor(candidate.theme?.secondary, defaults.theme.secondary),
                    accent: sanitizeHexColor(candidate.theme?.accent, defaults.theme.accent),
                    surface: sanitizeHexColor(candidate.theme?.surface, defaults.theme.surface),
                    text: sanitizeHexColor(candidate.theme?.text, defaults.theme.text),
                  },
                  amountCards: normalizeAmountCards(candidate.amountCards),
                  stats: normalizeStats(candidate.stats),
                  showRecurring: candidate.showRecurring !== false,
                };
              }

              function parseAmountCardText(text) {
                const cards = String(text || "")
                  .split(/\\r?\\n/)
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const [valueText, labelText = "", descriptionText = ""] = line.split("|");
                    return {
                      value: Number(valueText),
                      label: labelText.trim(),
                      description: descriptionText.trim(),
                    };
                  })
                  .filter((item) => Number.isFinite(item.value) && item.value > 0 && item.label);
                return normalizeAmountCards(cards);
              }

              function formatAmountCardText(cards) {
                return (cards || [])
                  .map((item) => `${Number(item.value)}|${item.label}|${item.description || ""}`)
                  .join("\\n");
              }

              function canUseBackendAuth() {
                return AUTH_CONFIG?.mode === "backend" && ["http:", "https:"].includes(window.location.protocol);
              }

              function getLocalAdminEntryHint() {
                return "כדי להיכנס לפאנל הניהול יש לפתוח את המערכת דרך http://127.0.0.1:8767/ או דרך http://127.0.0.1:8766/yellow-project-dashboard-browser.html ולא דרך קובץ file:// מקומי.";
              }

              function buildAuthUrl(path) {
                const baseUrl = String(AUTH_CONFIG?.baseUrl || "").trim().replace(/\\/$/, "");
                return baseUrl ? `${baseUrl}${path}` : path;
              }

              function getFallbackAdminEndpoint(kind) {
                if (kind === "dataset") {
                  return AUTH_CONFIG?.datasetEndpoint || "";
                }
                if (kind === "campaign-config") {
                  return AUTH_CONFIG?.campaignConfigEndpoint || "";
                }
                if (kind === "source-config") {
                  return AUTH_CONFIG?.sourceConfigEndpoint || "";
                }
                if (kind === "source-refresh") {
                  return AUTH_CONFIG?.sourceRefreshEndpoint || "";
                }
                return "";
              }

              function buildScopedAdminEndpoint(kind, scope = getActiveCampaignIdentity()) {
                if (!canUseBackendAuth()) {
                  return getFallbackAdminEndpoint(kind);
                }
                const organizationId = String(scope?.organizationId || "").trim();
                const campaignId = String(scope?.campaignId || "").trim();
                if (!organizationId || !campaignId) {
                  return getFallbackAdminEndpoint(kind);
                }
                const encodedOrganizationId = encodeURIComponent(organizationId);
                const encodedCampaignId = encodeURIComponent(campaignId);
                const basePath = `/api/organizations/${encodedOrganizationId}/campaigns/${encodedCampaignId}`;
                if (kind === "campaign-config") {
                  return buildAuthUrl(basePath);
                }
                if (kind === "dataset") {
                  return buildAuthUrl(`${basePath}/dataset`);
                }
                if (kind === "source-config") {
                  return buildAuthUrl(`${basePath}/source`);
                }
                if (kind === "source-refresh") {
                  return buildAuthUrl(`${basePath}/source/refresh`);
                }
                if (kind === "ambassador-import") {
                  return buildAuthUrl(`${basePath}/ambassadors/import`);
                }
                return getFallbackAdminEndpoint(kind);
              }

              function buildScopedPublicDatasetEndpoint(scope = getActiveCampaignIdentity()) {
                const organizationId = String(scope?.organizationId || "").trim();
                const campaignId = String(scope?.campaignId || "").trim();
                if (!organizationId || !campaignId) {
                  return "";
                }
                const encodedOrganizationId = encodeURIComponent(organizationId);
                const encodedCampaignId = encodeURIComponent(campaignId);
                return buildAuthUrl(`/api/organizations/${encodedOrganizationId}/campaigns/${encodedCampaignId}/public-dataset`);
              }

              async function fetchPublicContext() {
                const endpoint = String(AUTH_CONFIG?.publicContextEndpoint || "").trim();
                if (!endpoint) {
                  return null;
                }
                if (state?.auth?.publicScope?.organizationId && state?.auth?.publicScope?.campaignId) {
                  return {
                    organizationId: state.auth.publicScope.organizationId,
                    campaignId: state.auth.publicScope.campaignId,
                  };
                }
                try {
                  const response = await fetch(endpoint, {
                    method: "GET",
                    headers: {
                      "cache-control": "no-store",
                    },
                  });
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok) {
                    return null;
                  }
                  const scope = resolvePreferredCampaignScope(payload, { organizationId: "", campaignId: "" });
                  if (!scope.organizationId || !scope.campaignId) {
                    return null;
                  }
                  applyServerScope(payload, scope);
                  state.auth.publicScope = {
                    organizationId: scope.organizationId,
                    campaignId: scope.campaignId,
                  };
                  return scope;
                } catch (_error) {
                  return null;
                }
              }

              function applyServerScope(payload = {}, fallbackScope = getActiveCampaignIdentity()) {
                const summaries = Array.isArray(payload?.accessibleCampaigns)
                  ? payload.accessibleCampaigns
                  : Array.isArray(payload?.portfolio)
                    ? payload.portfolio
                    : [];
                const preferredScope = resolvePreferredCampaignScope(payload, fallbackScope);
                const firstSummaryScope = summaries.length ? buildScopeFromCampaignSummary(summaries[0]) : { organizationId: "", campaignId: "" };
                const organizationId = String(
                  payload?.organizationId ||
                  payload?.organization?.id ||
                  payload?.activeCampaign?.organizationId ||
                  preferredScope.organizationId ||
                  firstSummaryScope.organizationId ||
                  fallbackScope?.organizationId ||
                  ""
                ).trim();
                const campaignId = String(
                  payload?.campaignId ||
                  payload?.campaign?.id ||
                  payload?.activeCampaign?.campaignId ||
                  preferredScope.campaignId ||
                  firstSummaryScope.campaignId ||
                  fallbackScope?.campaignId ||
                  ""
                ).trim();
                state.auth.currentScope = {
                  organizationId,
                  campaignId,
                };
                state.auth.accessibleCampaigns = summaries;
                syncActiveCampaignRegistryWithScope(state.auth.currentScope);
              }

              function buildScopeFromCampaignSummary(summary = {}) {
                return {
                  organizationId: String(summary?.organizationId || summary?.organizationSlug || "").trim(),
                  campaignId: String(summary?.campaignId || summary?.campaignSlug || "").trim(),
                };
              }

              function getCampaignStatusPriority(status) {
                switch (String(status || "").trim().toLowerCase()) {
                  case "live":
                    return 40;
                  case "completed":
                    return 32;
                  case "scheduled":
                    return 18;
                  case "paused":
                    return 8;
                  case "draft":
                    return 0;
                  case "archived":
                    return -20;
                  default:
                    return 0;
                }
              }

              function scoreCampaignSummary(summary = {}, fallbackScope = {}) {
                const scope = buildScopeFromCampaignSummary(summary);
                if (!scope.organizationId || !scope.campaignId) {
                  return Number.NEGATIVE_INFINITY;
                }

                const fallbackOrganizationId = String(fallbackScope?.organizationId || "").trim();
                const fallbackCampaignId = String(fallbackScope?.campaignId || "").trim();
                const currentProjectSlug = getCampaignProjectSlug();
                const activeRegistryEntry = getCampaignRegistryActiveEntry();
                const activeRegistrySlug = normalizeUrlSlug(
                  activeRegistryEntry?.slug ||
                  activeRegistryEntry?.config?.basics?.slug ||
                  ""
                );
                const summaryCampaignSlug = normalizeUrlSlug(summary?.campaignSlug || summary?.slug || "");
                const rowCount = Number(summary?.rowCount ?? summary?.datasetRecordCount ?? 0) || 0;
                const raised = Number(summary?.raised ?? 0) || 0;
                let score = 0;

                if (
                  fallbackOrganizationId &&
                  fallbackCampaignId &&
                  scope.organizationId === fallbackOrganizationId &&
                  scope.campaignId === fallbackCampaignId
                ) {
                  score += 80;
                }
                if (summaryCampaignSlug && currentProjectSlug && summaryCampaignSlug === currentProjectSlug) {
                  score += 260;
                }
                if (summaryCampaignSlug && activeRegistrySlug && summaryCampaignSlug === activeRegistrySlug) {
                  score += 120;
                }
                if (rowCount > 0) {
                  score += 220 + Math.min(rowCount, 500);
                }
                if (raised > 0) {
                  score += 140 + Math.min(raised, 1000000) / 1000;
                }
                score += getCampaignStatusPriority(summary?.status);
                return score;
              }

              function syncActiveCampaignRegistryWithScope(scope = state?.auth?.currentScope) {
                const organizationId = String(scope?.organizationId || "").trim();
                const campaignId = String(scope?.campaignId || "").trim();
                if (!organizationId || !campaignId) {
                  return;
                }
                const normalized = normalizeCampaignRegistry(state.campaignRegistry);
                const matchedEntry = normalized.campaigns.find((item) => {
                  const basics = item?.config?.basics && typeof item.config.basics === "object" ? item.config.basics : {};
                  const candidateIds = [
                    item?.id,
                    item?.slug,
                    basics?.id,
                    basics?.slug,
                  ]
                    .map((value) => String(value || "").trim())
                    .filter(Boolean);
                  return candidateIds.includes(campaignId);
                });
                if (!matchedEntry || normalized.activeCampaignId === matchedEntry.id) {
                  return;
                }
                normalized.activeCampaignId = matchedEntry.id;
                state.campaignRegistry = normalized;
                state.activeCampaignId = matchedEntry.id;
                persistActiveCampaignLegacyState();
                storeCampaignRegistry(normalized);
              }

              function resolvePreferredCampaignScope(payload = {}, fallbackScope = getActiveCampaignIdentity()) {
                const directScope = {
                  organizationId: String(payload?.organizationId || payload?.organization?.id || payload?.activeCampaign?.organizationId || "").trim(),
                  campaignId: String(payload?.campaignId || payload?.campaign?.id || payload?.activeCampaign?.campaignId || "").trim(),
                };
                if (directScope.organizationId && directScope.campaignId) {
                  return directScope;
                }

                const summaries = Array.isArray(payload?.accessibleCampaigns)
                  ? payload.accessibleCampaigns
                  : Array.isArray(payload?.portfolio)
                    ? payload.portfolio
                    : [];
                if (summaries.length) {
                  const rankedSummaries = [...summaries]
                    .map((summary) => ({
                      summary,
                      score: scoreCampaignSummary(summary, fallbackScope),
                    }))
                    .sort((left, right) => right.score - left.score);
                  const summaryScope = buildScopeFromCampaignSummary(rankedSummaries[0]?.summary || summaries[0]);
                  if (summaryScope.organizationId && summaryScope.campaignId) {
                    return summaryScope;
                  }
                }

                return {
                  organizationId: String(fallbackScope?.organizationId || "").trim(),
                  campaignId: String(fallbackScope?.campaignId || "").trim(),
                };
              }

              function canUseLocalPasswordReset() {
                if (!canUseBackendAuth() || !AUTH_CONFIG?.resetEndpoint) {
                  return false;
                }
                return ["127.0.0.1", "localhost"].includes(window.location.hostname);
              }

              function setSetupMode(enabled) {
                state.auth.setupMode = Boolean(enabled);
                if (elements.loginPasswordConfirmLabel) {
                  elements.loginPasswordConfirmLabel.hidden = !state.auth.setupMode;
                  elements.loginPasswordConfirmLabel.style.display = state.auth.setupMode ? "" : "none";
                }
                if (elements.loginPasswordConfirm) {
                  elements.loginPasswordConfirm.required = state.auth.setupMode;
                  elements.loginPasswordConfirm.hidden = !state.auth.setupMode;
                  elements.loginPasswordConfirm.style.display = state.auth.setupMode ? "" : "none";
                  if (!state.auth.setupMode) {
                    elements.loginPasswordConfirm.value = "";
                  }
                }
                if (elements.loginPasswordSetupNote) {
                  elements.loginPasswordSetupNote.hidden = !state.auth.setupMode;
                  elements.loginPasswordSetupNote.style.display = state.auth.setupMode ? "" : "none";
                }
                if (elements.loginButton) {
                  elements.loginButton.textContent = state.auth.setupMode ? "שמירת סיסמה וכניסה" : "כניסה לפאנל הניהול";
                }
                if (elements.loginModeHint) {
                  if (!canUseBackendAuth()) {
                    elements.loginModeHint.textContent = getLocalAdminEntryHint();
                  } else {
                    elements.loginModeHint.textContent = state.auth.setupMode
                      ? "זו כניסה ראשונה למייל הזה. בחרו סיסמה אישית, אשרו אותה והמערכת תשמור אותה בשרת המקומי."
                      : "הכניסה נשמרת ב-session מקומי מאובטח בשרת. בפריסה ציבורית יש להפעיל HTTPS וניהול secrets מסודר.";
                  }
                }
                if (elements.loginPassword) {
                  elements.loginPassword.autocomplete = state.auth.setupMode ? "new-password" : "current-password";
                }
                if (elements.loginResetButton) {
                  elements.loginResetButton.hidden = !canUseLocalPasswordReset();
                }
              }

              function setAuthenticatedSession(email) {
                const normalized = email ? normalizeSearchToken(email) : "";
                state.session = normalized ? { email: normalized } : null;
                if (normalized) {
                  storeAdminEmail(normalized);
                  if (elements.loginEmail) {
                    elements.loginEmail.value = normalized;
                  }
                }
              }

              function clearSessionState() {
                state.session = null;
                state.auth.accessibleCampaigns = [];
                state.auth.publicScope = {
                  organizationId: "",
                  campaignId: "",
                };
                state.auth.currentScope = {
                  organizationId: "",
                  campaignId: "",
                };
                state.auth.campaignConfigLoaded = false;
                setSetupMode(false);
                clearSourceRefreshTimer();
                restorePublicDataset();
              }

              function isManagerAuthenticated() {
                return Boolean(state.session?.email);
              }

              async function authRequest(endpoint, options = {}) {
                const response = await fetch(endpoint, {
                  method: options.method || "GET",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    ...(options.headers || {}),
                  },
                  body: options.body ? JSON.stringify(options.body) : undefined,
                });
                let payload = {};
                try {
                  const responseText = await response.text();
                  payload = responseText ? JSON.parse(responseText) : {};
                } catch (_error) {
                  payload = response.ok
                    ? {}
                    : { message: `שגיאת שרת בעת ביצוע הפעולה (HTTP ${response.status}).` };
                }
                return { response, payload };
              }

              async function hydrateAuthSession() {
                clearSessionState();
                let preferredScope = { organizationId: "", campaignId: "" };
                if (!canUseBackendAuth()) {
                  state.auth.backendAvailable = false;
                  setLoginMessage(getLocalAdminEntryHint(), "warning");
                  renderSourceConfigControls();
                  return;
                }
                try {
                  const publicScope = await fetchPublicContext();
                  if (publicScope?.organizationId && publicScope?.campaignId) {
                    preferredScope = publicScope;
                  }
                } catch (_error) {
                  preferredScope = { organizationId: "", campaignId: "" };
                }
                try {
                  const { response, payload } = await authRequest(AUTH_CONFIG.statusEndpoint);
                  state.auth.backendAvailable = response.ok;
              if (response.ok && payload?.authenticated && payload?.email) {
                    setAuthenticatedSession(payload.email);
                    const scope = resolvePreferredCampaignScope(
                      payload,
                      preferredScope.organizationId && preferredScope.campaignId
                        ? preferredScope
                        : getActiveCampaignIdentity()
                    );
                    applyServerScope(payload, scope);
                    try {
                      await loadProtectedManagerData(scope, { includeCampaignBuilder: false });
                    } catch (error) {
                      // Never leave an authenticated manager looking at embedded sample data.
                      const loadedPublicDataset = await loadPublicDataset(scope).catch(() => false);
                      if (!loadedPublicDataset) {
                        throw error;
                      }
                      setImportMessage(
                        "טעינת נתוני הניהול נכשלה זמנית. מוצגים כעת נתוני אמת מעודכנים ממקור הקמפיין ללא פרטי תורמים.",
                        "warning"
                      );
                    }
                    syncSourceAutoRefresh();
                  }
                } catch (_error) {
                  state.auth.backendAvailable = false;
                }
                renderSourceConfigControls();
              }

              async function loadAdminDataset(scope = getActiveCampaignIdentity()) {
                const endpoint = buildScopedAdminEndpoint("dataset", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  state.auth.adminDatasetLoaded = false;
                  return false;
                }

                const { response, payload } = await authRequest(endpoint);
                if (!response.ok || !Array.isArray(payload?.rows) || !payload?.meta) {
                  state.auth.adminDatasetLoaded = false;
                  throw new Error(payload?.message || "טעינת הנתונים המוגנים נכשלה.");
                }

                applyServerScope(payload, scope);
                state.rows = enrichRows(payload.rows, payload.meta);
                state.meta = payload.meta;
                state.sourceLabel = payload.sourceLabel || "קובץ בסיס מאובטח";
                state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
                state.auth.adminDatasetLoaded = true;
                state.filters = getDefaultFilters(state.meta);
                resetFilterOptions();
                return true;
              }

              async function loadPublicDataset(scope = getActiveCampaignIdentity()) {
                const fetchDataset = async (effectiveScope) => {
                  const endpoint = buildScopedPublicDatasetEndpoint(effectiveScope);
                  if (!endpoint) {
                    return { ok: false, payload: {}, scope: effectiveScope };
                  }
                  const response = await fetch(endpoint, {
                    method: "GET",
                    headers: {
                      "cache-control": "no-store",
                    },
                  });
                  const payload = await response.json().catch(() => ({}));
                  return {
                    ok: response.ok && Array.isArray(payload?.rows) && !!payload?.meta,
                    payload,
                    scope: effectiveScope,
                  };
                };

                let datasetResult = await fetchDataset(scope);
                if (!datasetResult.ok) {
                  const discoveredScope = await fetchPublicContext();
                  if (discoveredScope) {
                    datasetResult = await fetchDataset(discoveredScope);
                  }
                }
                if (!datasetResult.ok) {
                  return false;
                }

                const payload = datasetResult.payload;
                applyServerScope(payload, datasetResult.scope);

                state.rows = enrichRows(payload.rows, payload.meta);
                state.meta = payload.meta;
                state.sourceLabel = payload.sourceLabel || "קובץ בסיס ציבורי";
                state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
                state.filters = getDefaultFilters(state.meta);
                resetFilterOptions();
                return true;
              }

              function renderSourceConfigControls() {
                if (!elements.sourceMode) {
                  return;
                }
                const config = normalizeSourceConfig(state.sourceConfig);
                state.sourceConfig = config;
                elements.sourceMode.value = config.mode;
                elements.sourceApiEndpoint.value = config.api.endpoint;
                elements.sourceApiMethod.value = config.api.method;
                elements.sourceApiFormat.value = config.api.responseFormat;
                elements.sourceApiRecordsPath.value = config.api.recordsPath;
                elements.sourceApiAuthType.value = config.api.authType;
                elements.sourceApiAutoRefresh.value = String(config.api.autoRefreshMinutes ?? 5);
                elements.sourceApiBearerToken.value = "";
                elements.sourceApiBearerToken.placeholder = config.api.hasBearerToken
                  ? "קיים token שמור בשרת. הזן/י ערך חדש רק אם רוצים להחליף."
                  : "השאר/י ריק כדי לעבוד ללא token";
                elements.sourceApiHeaders.value = config.api.headersText;
                elements.sourceApiBody.value = config.api.bodyText;
                elements.sourceApiFieldMap.value = config.api.fieldMapText;
                elements.sourceGoogleUrl.value = config.googleSheets.spreadsheetUrl;
                elements.sourceGoogleId.value = config.googleSheets.spreadsheetId;
                elements.sourceGoogleGid.value = config.googleSheets.gid;
                elements.sourceGoogleSheetName.value = config.googleSheets.sheetName;
                elements.sourceGoogleRange.value = config.googleSheets.range;
                elements.sourceGoogleAccessMode.value = config.googleSheets.accessMode;
                elements.sourceGoogleSyncInterval.value = String(config.googleSheets.syncIntervalMinutes ?? 5);
                elements.sourceGoogleFieldMap.value = config.googleSheets.fieldMapText;
                if (elements.sourceApiFields) {
                  elements.sourceApiFields.hidden = config.mode !== "api";
                }
                if (elements.sourceGoogleFields) {
                  elements.sourceGoogleFields.hidden = config.mode !== "google_sheets";
                }
                if (elements.refreshSourceApi) {
                  elements.refreshSourceApi.disabled = config.mode === "file";
                }
                const status = getSourceConfigStatus();
                setSourceConfigStatus(status.message, status.tone);
              }

              async function hydrateSourceConfig(scope = getActiveCampaignIdentity()) {
                state.sourceConfig = normalizeSourceConfig(state.sourceConfig);
                const endpoint = buildScopedAdminEndpoint("source-config", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  renderSourceConfigControls();
                  return state.sourceConfig;
                }
                try {
                  const { response, payload } = await authRequest(endpoint);
                  if (response.ok && payload?.config) {
                    applyServerScope(payload, scope);
                    state.sourceConfig = normalizeSourceConfig(payload.config);
                    setSourceConfigStatus(
                      state.sourceConfig.mode === "api"
                        ? "חיבור ה-API נטען מהשרת ומוכן למשיכה או לרענון אוטומטי."
                        : state.sourceConfig.mode === "google_sheets"
                          ? "חיבור Google Sheets נטען מהשרת ומוכן לסנכרון ידני או מתוזמן."
                          : "מקור הנתונים הפעיל נשאר על טעינת קובץ ידנית.",
                      "success"
                    );
                  } else {
                    setSourceConfigStatus(payload?.message || "לא ניתן היה לטעון את הגדרות מקור הנתונים מהשרת.", "warning");
                  }
                } catch (_error) {
                  setSourceConfigStatus("השרת זמין לחיבור מנהלים, אך הגדרות מקור הנתונים לא נטענו כרגע.", "warning");
                }
                renderSourceConfigControls();
                return state.sourceConfig;
              }

              function collectSourceConfigFromControls() {
                const nextConfig = normalizeSourceConfig({
                  mode: elements.sourceMode?.value || state.sourceConfig.mode,
                  api: {
                    endpoint: elements.sourceApiEndpoint?.value || "",
                    method: elements.sourceApiMethod?.value || "GET",
                    responseFormat: elements.sourceApiFormat?.value || "csv",
                    recordsPath: elements.sourceApiRecordsPath?.value || "",
                    authType: elements.sourceApiAuthType?.value || "none",
                    bearerToken: elements.sourceApiBearerToken?.value || "",
                    hasBearerToken: state.sourceConfig.api.hasBearerToken,
                    autoRefreshMinutes: elements.sourceApiAutoRefresh?.value || state.sourceConfig.api.autoRefreshMinutes,
                    headersText: elements.sourceApiHeaders?.value || "",
                    bodyText: elements.sourceApiBody?.value || "",
                    fieldMapText: elements.sourceApiFieldMap?.value || "",
                  },
                  googleSheets: {
                    spreadsheetUrl: elements.sourceGoogleUrl?.value || "",
                    spreadsheetId: elements.sourceGoogleId?.value || "",
                    gid: elements.sourceGoogleGid?.value || "",
                    sheetName: elements.sourceGoogleSheetName?.value || "",
                    range: elements.sourceGoogleRange?.value || "",
                    accessMode: elements.sourceGoogleAccessMode?.value || "public_csv",
                    syncEnabled: true,
                    syncIntervalMinutes: elements.sourceGoogleSyncInterval?.value || state.sourceConfig.googleSheets.syncIntervalMinutes,
                    fieldMapText: elements.sourceGoogleFieldMap?.value || "",
                    lastSyncedAt: state.sourceConfig.googleSheets.lastSyncedAt,
                    lastSuccessfulSyncAt: state.sourceConfig.googleSheets.lastSuccessfulSyncAt,
                    lastChecksum: state.sourceConfig.googleSheets.lastChecksum,
                    lastRowCount: state.sourceConfig.googleSheets.lastRowCount,
                    lastStatus: state.sourceConfig.googleSheets.lastStatus,
                    lastMessage: state.sourceConfig.googleSheets.lastMessage,
                    lastSourceLabel: state.sourceConfig.googleSheets.lastSourceLabel,
                  },
                });
                parseJsonObjectText(nextConfig.api.fieldMapText, getDefaultSourceFieldMap());
                parseJsonObjectText(nextConfig.googleSheets.fieldMapText, getDefaultSourceFieldMap());
                return nextConfig;
              }

              async function saveSourceConfigFromControls(options = {}) {
                const scope = options.scope || getActiveCampaignIdentity();
                const endpoint = buildScopedAdminEndpoint("source-config", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  throw new Error("שמירת חיבור API זמינה רק למנהלים מחוברים דרך שרת הניהול.");
                }
                const nextConfig = collectSourceConfigFromControls();
                const { response, payload } = await authRequest(endpoint, {
                  method: "POST",
                  body: { config: nextConfig },
                });
                if (!response.ok) {
                  throw new Error(payload?.message || "שמירת הגדרות מקור הנתונים נכשלה.");
                }
                applyServerScope(payload, scope);
                state.sourceConfig = normalizeSourceConfig(payload?.config || nextConfig);
                renderSourceConfigControls();
                syncSourceAutoRefresh();
                if (!options.silent) {
                  setSourceConfigStatus(payload?.message || "חיבור מקור הנתונים נשמר בהצלחה.", "success");
                }
                return state.sourceConfig;
              }

              function readPathValue(record, path) {
                return String(path || "")
                  .split(".")
                  .map((segment) => segment.trim())
                  .filter(Boolean)
                  .reduce((current, segment) => {
                    if (current == null) {
                      return undefined;
                    }
                    if (Array.isArray(current) && /^\\d+$/.test(segment)) {
                      return current[Number(segment)];
                    }
                    return current?.[segment];
                  }, record);
              }

              function extractApiRecords(payload, recordsPath) {
                if (Array.isArray(payload)) {
                  return payload;
                }
                if (recordsPath) {
                  const resolved = readPathValue(payload, recordsPath);
                  if (Array.isArray(resolved)) {
                    return resolved;
                  }
                }
                if (Array.isArray(payload?.rows)) {
                  return payload.rows;
                }
                if (Array.isArray(payload?.data)) {
                  return payload.data;
                }
                if (Array.isArray(payload?.items)) {
                  return payload.items;
                }
                throw new Error("תגובת ה-API לא כוללת מערך רשומות. יש לעדכן את recordsPath או את מבנה התגובה.");
              }

              function mapJsonRecordsToRawRows(records, fieldMapText) {
                const fieldMap = parseJsonObjectText(fieldMapText, getDefaultSourceFieldMap());
                return records.map((record) =>
                  Object.fromEntries(
                    Object.entries(fieldMap).map(([targetField, sourcePath]) => [
                      targetField,
                      readPathValue(record, sourcePath) ?? "",
                    ])
                  )
                );
              }

              function ingestApiRefreshPayload(payload) {
                const sourceLabel = payload?.sourceLabel || "API source";
                const format = String(payload?.format || state.sourceConfig.api.responseFormat || "csv").toLowerCase();
                if (format === "csv") {
                  return ingestCsvText(String(payload?.payload || ""), sourceLabel);
                }
                const records = extractApiRecords(payload?.payload, payload?.recordsPath || state.sourceConfig.api.recordsPath);
                const rawRows = mapJsonRecordsToRawRows(records, payload?.fieldMapText || state.sourceConfig.api.fieldMapText);
                const validation = validateRawRows(rawRows, sourceLabel);
                const normalized = normalizeUploadRows(validation.validRows);
                const meta = ensureMeta(normalized);
                return {
                  rawRows,
                  validation,
                  normalized,
                  meta,
                };
              }

              let sourceRefreshTimerId = 0;
              let sourceRefreshInFlight = false;

              function clearSourceRefreshTimer() {
                if (sourceRefreshTimerId) {
                  window.clearInterval(sourceRefreshTimerId);
                  sourceRefreshTimerId = 0;
                }
              }

              async function refreshSourceDataFromApi(options = {}) {
                const scope = options.scope || getActiveCampaignIdentity();
                const endpoint = buildScopedAdminEndpoint("source-refresh", scope);
                if (!canUseBackendAuth() || !endpoint || !isManagerAuthenticated()) {
                  throw new Error("משיכת נתונים ממקור חיצוני זמינה רק למנהלים מחוברים דרך שרת הניהול.");
                }
                if (sourceRefreshInFlight) {
                  return false;
                }
                sourceRefreshInFlight = true;
                try {
                  const { response, payload } = await authRequest(endpoint, { method: "POST" });
                  if (!response.ok) {
                    throw new Error(payload?.message || "משיכת הנתונים ממערכת המקור נכשלה.");
                  }
                  applyServerScope(payload, scope);
                  // Source sync persists Google Sheets rows server-side and returns an
                  // empty compatibility array. Only parse an inline payload when one
                  // was explicitly provided; otherwise reload the scoped dataset.
                  if (Object.prototype.hasOwnProperty.call(payload || {}, "payload")) {
                    const ingested = ingestApiRefreshPayload(payload);
                    state.validation.base = ingested.validation;
                    if (hasBlockingValidation(ingested.validation)) {
                      throw new Error("מערכת המקור החזירה נתונים, אך הם לא עומדים במבנה הנדרש לדשבורד.");
                    }
                    state.meta = ingested.meta;
                    state.rows = enrichRows(ingested.normalized, ingested.meta);
                    state.sourceLabel = payload?.sourceLabel || "Source sync";
                    state.filters = getDefaultFilters(ingested.meta);
                    state.auth.adminDatasetLoaded = true;
                    resetFilterOptions();
                  } else {
                    await loadAdminDataset(scope);
                  }
                  setSourceConfigStatus(
                    `הנתונים סונכרנו בהצלחה${payload?.fetchedAt ? ` · עדכון אחרון ${formatDateTime(payload.fetchedAt)}` : ""}.`,
                    "success"
                  );
                  if (!options.silent) {
                    setImportMessage("הנתונים נמשכו בהצלחה ממערכת המקור במקום טעינת קובץ ידנית.", "success");
                  }
                  if (options.render !== false) {
                    renderAll();
                  }
                  return true;
                } finally {
                  sourceRefreshInFlight = false;
                }
              }

              function syncSourceAutoRefresh() {
                clearSourceRefreshTimer();
                const config = normalizeSourceConfig(state.sourceConfig);
                state.sourceConfig = config;
                if (!isManagerAuthenticated() || config.mode === "file") {
                  return;
                }
                const refreshMinutes = Number(
                  config.mode === "google_sheets"
                    ? config.googleSheets.syncIntervalMinutes || 0
                    : config.api.autoRefreshMinutes || 0
                );
                if (!Number.isFinite(refreshMinutes) || refreshMinutes < 1) {
                  return;
                }
                sourceRefreshTimerId = window.setInterval(async () => {
                  try {
                    if (config.mode === "google_sheets") {
                      // The manager session is a safe fallback for live campaigns:
                      // pull the source first, then render the fresh persisted dataset.
                      await refreshSourceDataFromApi({ silent: true });
                    } else {
                      await refreshSourceDataFromApi({ silent: true });
                    }
                  } catch (error) {
                    setSourceConfigStatus(`הרענון האוטומטי ממקור הנתונים נכשל: ${error?.message || "שגיאה לא ידועה"}`, "warning");
                  }
                }, refreshMinutes * 60 * 1000);
              }

              async function ensureCampaignBuilderConfigLoaded(scope = getActiveCampaignIdentity()) {
                if (state.auth.campaignConfigLoaded) {
                  return state.campaignBuilder;
                }
                return hydrateCampaignBuilderConfig(scope);
              }

              async function loadProtectedManagerData(scope = getActiveCampaignIdentity(), options = {}) {
                const includeCampaignBuilder = Boolean(options.includeCampaignBuilder || state.ui.adminTab === "design");
                if (includeCampaignBuilder) {
                  await Promise.all([
                    hydrateSourceConfig(scope),
                    ensureCampaignBuilderConfigLoaded(scope),
                  ]);
                } else {
                  await hydrateSourceConfig(scope);
                }
                if (state.sourceConfig.mode === "api" || state.sourceConfig.mode === "google_sheets") {
                  try {
                    return await refreshSourceDataFromApi({ silent: true, render: false, scope });
                  } catch (error) {
                    try {
                      await loadAdminDataset(scope);
                      setImportMessage(
                        `${error?.message || "משיכת הנתונים ממערכת המקור נכשלה."} נטען בינתיים מאגר הבסיס המוגן.`,
                        "warning"
                      );
                      return true;
                    } catch (_datasetError) {
                      throw error;
                    }
                  }
                }
                return loadAdminDataset(scope);
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
                const settings = normalizeCampaignPageSettings(state.campaignPage || INITIAL_CAMPAIGN_PAGE_SETTINGS);
                const campaignLogo = String(settings.campaignLogoUrl || INITIAL_CAMPAIGN_LOGO || "").trim();
                const organizationLogo = String(settings.organizationLogoUrl || INITIAL_ORG_LOGO || "").trim();
                const organizationName = String(state.campaignBuilder?.basics?.organizationName || "").trim() || "הארגון";
                const primary = sanitizeHexColor(settings.theme?.primary, "#111D4A");
                const secondary = sanitizeHexColor(settings.theme?.secondary, "#24377C");
                const accent = sanitizeHexColor(settings.theme?.accent, "#FFD629");
                root.style.setProperty("--brand-pattern-campaign", campaignLogo ? `url("${campaignLogo}")` : "none");
                root.style.setProperty("--brand-pattern-organization", organizationLogo ? `url("${organizationLogo}")` : "none");
                root.style.setProperty("--topbar-primary", primary);
                root.style.setProperty("--topbar-secondary", secondary);
                root.style.setProperty("--topbar-accent", accent);
                if (elements.topbarCampaignLogo) {
                  elements.topbarCampaignLogo.src = campaignLogo;
                  elements.topbarCampaignLogo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
                }
                if (elements.topbarLogo) {
                  elements.topbarLogo.src = organizationLogo;
                  elements.topbarLogo.alt = `לוגו ${organizationName}`;
                }
                if (elements.publicLogo) {
                  elements.publicLogo.src = campaignLogo;
                  elements.publicLogo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
                }
                if (elements.publicOrgLogo) {
                  elements.publicOrgLogo.src = organizationLogo;
                  elements.publicOrgLogo.alt = `לוגו ${organizationName}`;
                }
                if (elements.loginCampaignLogo) {
                  elements.loginCampaignLogo.src = campaignLogo;
                  elements.loginCampaignLogo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
                }
                if (elements.loginOrgLogo) {
                  elements.loginOrgLogo.src = organizationLogo;
                  elements.loginOrgLogo.alt = `לוגו ${organizationName}`;
                }
                if (elements.logo) {
                  elements.logo.src = campaignLogo;
                  elements.logo.alt = settings.title ? `לוגו ${settings.title}` : "לוגו הקמפיין";
                }
                if (elements.brandOrgLogo) {
                  elements.brandOrgLogo.src = organizationLogo;
                  elements.brandOrgLogo.alt = `לוגו ${organizationName}`;
                }
                if (elements.topbarTitle) {
                  elements.topbarTitle.textContent = "מערכת ניהול קמפיין";
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
                const nextPage = ["project", "prizes", "rules", "privacy", "admin"].includes(page) ? page : "project";
                state.ui.page = nextPage;
                const pageMap = {
                  project: elements.pageProject,
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

              function setAdminTab(tab) {
                const nextTab = tab === "design" ? "design" : "insights";
                state.ui.adminTab = nextTab;
                const panelMap = {
                  insights: elements.adminTabPanelInsights,
                  design: elements.adminTabPanelDesign,
                };
                Object.entries(panelMap).forEach(([key, panel]) => {
                  if (!panel) {
                    return;
                  }
                  panel.hidden = key !== nextTab;
                });
                elements.adminTabButtons.forEach((button) => {
                  const isActive = button.dataset.adminTabTarget === nextTab;
                  button.classList.toggle("is-active", isActive);
                  button.setAttribute("aria-selected", isActive ? "true" : "false");
                });
                if (nextTab === "design") {
                  if (isManagerAuthenticated() && !state.auth.campaignConfigLoaded) {
                    setCampaignBuilderStatus("טוענים את הגדרות הקמפיין מהשרת...", "warning");
                    ensureCampaignBuilderConfigLoaded()
                      .then(() => {
                        renderAll();
                      })
                      .catch((error) => {
                        setCampaignBuilderStatus(
                          error?.message || "טעינת הגדרות הקמפיין נכשלה. מוצגות בינתיים ההגדרות המקומיות.",
                          "warning"
                        );
                        renderCampaignDesigner();
                      });
                    return;
                  }
                  renderCampaignDesigner();
                }
              }

              function refreshAccessUi() {
                const isManager = isManagerAuthenticated();
                const isAdminPage = state.ui.page === "admin";
                elements.sessionStatus.textContent = isManager ? `מחובר/ת כמנהל/ת: ${state.session.email}` : "מצב ניהול: אורח/ת";
                elements.sessionStatus.hidden = !isAdminPage;
                if (elements.topbarMeta) {
                  elements.topbarMeta.hidden = !isAdminPage;
                }
                elements.logoutButton.hidden = !isManager;
                elements.goAdminLogin.hidden = isManager;
                elements.adminLock.hidden = isManager;
                elements.adminContent.hidden = !isManager;
                if (isAdminPage && !isManager) {
                  setLoginMessage("יש להזין מייל מורשה וסיסמה כדי לצפות בדשבורד הניהולי.");
                }
                if (isManager) {
                  setAdminTab(state.ui.adminTab);
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
                const date = value ? new Date(`${value}T00:00:00`) : null;
                return date && Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "";
              }

              function formatShortDate(value) {
                const date = value ? new Date(`${value}T00:00:00`) : null;
                return date && Number.isFinite(date.getTime()) ? dateShortFormatter.format(date) : "";
              }

              function formatDateTime(value) {
                const date = value ? new Date(value) : null;
                return date && Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : "";
              }

              function formatHourLabel(value) {
                return `${String(value).padStart(2, "0")}:00`;
              }

              function getWeekdayLabel(dateString) {
                const date = dateString ? new Date(`${dateString}T00:00:00`) : null;
                return date && Number.isFinite(date.getTime()) ? weekdayFormatter.format(date) : "";
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
                const projectDates = uniqueDates;
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
                    label: `יום ${index + 1} Â· ${formatShortDate(date)}`,
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

              function formatSignedPercent(value) {
                const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
                return `${prefix}${Math.abs(value * 100).toFixed(1)}%`;
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

              const intelligenceEngine = createGoodRaiseIntelligence({
                groupBy,
                sumAmount,
                buildLeaderboard,
              });

              function buildIntelligenceContext(rows) {
                const activeScope = getActiveCampaignIdentity();
                return {
                  organizationId: activeScope.organizationId,
                  campaignId: activeScope.campaignId,
                  rows,
                  meta: state.meta,
                  goals: state.goals,
                  prizeModel: state.prizeModel,
                  ambassadorDirectory: state.ambassadorDirectory,
                  campaignBuilder: state.campaignBuilder,
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

              function computeDailyWinners(referenceRows) {
                const projectDates = (state.meta.projectDates?.length ? state.meta.projectDates : state.meta.uniqueDates || []).slice(0, 10);
                const groupedByDate = new Map();
                referenceRows.forEach((row) => {
                  const dateKey = row.date;
                  if (!dateKey) {
                    return;
                  }
                  if (!groupedByDate.has(dateKey)) {
                    groupedByDate.set(dateKey, new Map());
                  }
                  const byAmbassador = groupedByDate.get(dateKey);
                  const ambassador = row.ambassador || "ללא שיוך";
                  if (ambassador === "ללא שיוך") {
                    return;
                  }
                  const current = byAmbassador.get(ambassador) || { ambassador, total: 0, deals: 0 };
                  current.total += Number(row.amount || 0);
                  current.deals += 1;
                  byAmbassador.set(ambassador, current);
                });

                const usedAmbassadors = new Set();
                return projectDates.map((dateKey, index) => {
                  const candidates = Array.from((groupedByDate.get(dateKey) || new Map()).values())
                    .filter((candidate) => candidate.total >= 20)
                    .sort((left, right) => {
                      if (right.total !== left.total) {
                        return right.total - left.total;
                      }
                      if (right.deals !== left.deals) {
                        return right.deals - left.deals;
                      }
                      return left.ambassador.localeCompare(right.ambassador, "he");
                    });
                  // A campaign ambassador may go on the field only once. When the daily
                  // leader has already been selected, advance to the next eligible person.
                  const uniqueCandidate = candidates.find((candidate) => !usedAmbassadors.has(candidate.ambassador)) || null;
                  if (uniqueCandidate) {
                    usedAmbassadors.add(uniqueCandidate.ambassador);
                  }
                  return {
                    date: dateKey,
                    dayNumber: index + 1,
                    winner: uniqueCandidate,
                    dailyRank: uniqueCandidate ? candidates.indexOf(uniqueCandidate) + 1 : null,
                    fieldPosition: uniqueCandidate ? usedAmbassadors.size : null,
                  };
                });
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

              function isResetDataState() {
                return Number(state.meta?.rowCount || 0) === 0 && state.rows.length === 0 && state.compare.rows.length === 0;
              }

              function setControlNote(filteredRows, prizeRows) {
                const compareText = state.compare.rows.length ? ` | השוואה: ${state.compare.label} (${formatNumber(state.compare.rows.length)} רשומות)` : "";
                const resetPrefix = isResetDataState() ? "מאופס | " : "";
                elements.controlNote.textContent = `${resetPrefix}בסיס: ${state.sourceLabel} | חלון ברירת מחדל: ${state.meta.projectWindowLabel || "לא זוהה"} | מוצגות ${formatNumber(filteredRows.length)} עסקאות במסנן | פרסים מחושבים על ${formatNumber(prizeRows.length)} עסקאות בטווח הזמן הנבחר${compareText}${getActiveFilterSummary()}`;
              }

              function renderPublicHeroBadges(prizeRows) {
                const leaderboard = buildLeaderboard(prizeRows);
                const topLeader = leaderboard[0];
                const latestCreated = getLatestCreatedIso(prizeRows);
                const total = sumAmount(prizeRows);
                const resetState = isResetDataState();
                const campaignStatus = resetState ? "מאופס" : (prizeRows.length ? "פעיל על בסיס הקובץ הנוכחי" : "ממתין לנתונים");
                const sourceWindow = state.meta.projectWindowLabel || "לא זוהה";
                const leaderValue = topLeader ? escapeHtml(topLeader.ambassador) : "טרם נקבע";
                const leaderMeta = topLeader
                  ? `הוביל/ה עד כה עם ${escapeHtml(formatAmount(topLeader.total))}`
                  : (resetState ? "כל נתוני התרומות נוקו. אפשר להתחיל להזרים נתוני בדיקה חדשים." : "ברגע שייקלטו נתונים יופיע כאן מוביל/ה נוכחי/ת");
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
                const resetState = isResetDataState();
                renderBrandAssets();
                const badges = [
                  ...(resetState ? [`<span class="hero-badge">מאופס</span>`] : []),
                  `<span class="hero-badge">${escapeHtml(formatAmount(filteredTotal))} בתצוגה הפעילה</span>`,
                  `<span class="hero-badge">${escapeHtml(formatNumber(ambassadorCount))} שגרירים פעילים בטווח</span>`,
                  `<span class="hero-badge">טווח פרויקט: ${escapeHtml(state.meta.projectWindowLabel || "טווח לא זוהה")}</span>`,
                  `<span class="hero-badge">בסיס פרסים: ${escapeHtml(formatAmount(prizeTotal))}</span>`,
                ];
                if (state.compare.rows.length) {
                  badges.push(`<span class="hero-badge">השוואה: ${escapeHtml(state.compare.label)} Â· ${escapeHtml(formatAmount(sumAmount(compareRows)))}</span>`);
                }
                if (latestCreated) {
                  badges.push(`<span class="hero-badge">עודכן לאחרונה: ${escapeHtml(formatDateTime(latestCreated))}</span>`);
                }
                elements.adminWindowLabel.textContent = state.meta.projectWindowLabel || "לא זוהה";
                elements.adminLastUpdated.textContent = latestCreated ? formatDateTime(latestCreated) : (resetState ? "מאופס" : "אין נתונים");
                elements.adminSourceFile.textContent = state.sourceLabel || "קובץ בסיס";
                elements.adminRecordCount.textContent = resetState ? "מאופס" : formatNumber(filteredRows.length);
                elements.heroBadges.innerHTML = badges.join("");
              }

              function renderMetrics(rows) {
                const context = buildIntelligenceContext(rows);
                const total = sumAmount(rows);
                const totalGoal = Number(state.goals.total || 0);
                const health = intelligenceEngine.buildHealthModel(rows, context);
                const velocity = intelligenceEngine.buildVelocityModel(rows, context);
                const forecast = intelligenceEngine.buildForecastModel(rows, context);
                const ambassadors = intelligenceEngine.buildAmbassadorModels(rows, context);
                const activeAmbassadors = ambassadors.filter((item) => item.hasStarted).length;
                const average = rows.length ? total / rows.length : 0;
                const targetPct = totalGoal > 0 ? total / totalGoal : 0;
                const timeRemainingHours = Math.max(0, Math.round(velocity.bounds.remainingHours));
                const stats = [
                  { label: "סכום שגויס", value: totalGoal ? `${formatAmount(total)} / ${formatAmount(totalGoal)}` : formatAmount(total), detail: totalGoal ? `${formatPercent(targetPct)} מהיעד` : "עדיין לא הוגדר יעד" },
                  { label: "תחזית סיום", value: formatAmount(forecast.projectedFinal), detail: totalGoal ? `${formatPercent(forecast.projectedTargetPct)} מהיעד Â· ${forecast.confidence}` : forecast.confidenceReason },
                  { label: "זמן שנותר", value: `${formatNumber(timeRemainingHours)} שעות`, detail: `חלון קמפיין: ${formatPercent(velocity.bounds.elapsedRatio)} הושלם` },
                  { label: "תרומות", value: formatNumber(rows.length), detail: `ממוצע לתרומה ${formatAmount(average)}` },
                  { label: "שגרירים פעילים", value: formatNumber(activeAmbassadors), detail: `${formatNumber(ambassadors.length)} שגרירים מזוהים` },
                  { label: "קצב גיוס נוכחי", value: `${formatAmount(velocity.last3Hours.amountPerHour)}/שעה`, detail: `שינוי ${formatSignedPercent(velocity.changeVsPrevious3Hours.amountRatio)} מול 3 השעות הקודמות` },
                  { label: "Campaign Health", value: `${formatNumber(health.score)}/100`, detail: health.label },
                  { label: "כשלי סליקה", value: formatNumber(rows.filter((row) => row.status === "failed").length), detail: `${formatPercent(rows.length ? rows.filter((row) => row.status === "failed").length / rows.length : 0)} מכלל העסקאות` },
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

                const context = buildIntelligenceContext(rows);
                const velocity = intelligenceEngine.buildVelocityModel(rows, context);
                const health = intelligenceEngine.buildHealthModel(rows, context);
                const forecast = intelligenceEngine.buildForecastModel(rows, context);
                const attentionItems = intelligenceEngine.buildAttentionNow(rows, context);
                const model = buildExecutiveModel(rows);
                elements.executiveSummary.textContent = `${health.label} Â· תחזית ${formatAmount(forecast.projectedFinal)} Â· ${attentionItems.length} נקודות טיפול פתוחות`;

                const cards = [
                  {
                    title: "Campaign Health",
                    items: [
                      `ציון בריאות הקמפיין עומד על ${formatNumber(health.score)} מתוך 100 ומסווג כ-${health.label}.`,
                      ...health.reasons.map((item) => item.text),
                    ],
                  },
                  {
                    title: "Forecast & Trajectory",
                    items: [
                      `תחזית הסיום הנוכחית היא ${formatAmount(forecast.projectedFinal)}.`,
                      Number(state.goals.total || 0) > 0
                        ? `המשמעות היא ${formatPercent(forecast.projectedTargetPct)} מהיעד הכולל ו-${forecast.gapOrSurplus >= 0 ? "עודף" : "פער"} של ${formatAmount(Math.abs(forecast.gapOrSurplus))}.`
                        : "טרם הוגדר יעד כולל, ולכן התחזית מוצגת ללא אחוז יעד.",
                      `מהירות 3 השעות האחרונות: ${formatAmount(velocity.last3Hours.amountPerHour)}/שעה מול ממוצע קמפיין של ${formatAmount(velocity.campaignAverage.amountPerHour)}/שעה.`,
                    ],
                  },
                  {
                    title: "מה דורש טיפול עכשיו?",
                    items: attentionItems.length
                      ? attentionItems.slice(0, 3).map((item) => `${item.issue} ${item.evidence ? `| ${item.evidence}` : ""} | פעולה: ${item.action}`)
                      : ["לא זוהו כרגע חריגות משמעותיות שמחייבות פעולה מיידית."],
                  },
                  {
                    title: "תמונת מצב מנהלית",
                    items: [
                      `סך הגיוס כרגע הוא ${formatAmount(model.total)} מתוך ${formatNumber(model.deals)} עסקאות.`,
                      model.topAmbassador ? `המוביל/ה כרגע: ${model.topAmbassador.ambassador} עם ${formatAmount(model.topAmbassador.total)}.` : "אין שגריר מוביל מזוהה.",
                      `יש ${formatNumber(model.failedCount)} עסקאות שנכשלו ו-${formatNumber(model.ambassadorCount)} שגרירים פעילים בפילוח הנוכחי.`,
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
                const context = buildIntelligenceContext(rows);
                const ambassadors = intelligenceEngine.buildAmbassadorModels(rows, context);
                const priorities = intelligenceEngine.buildPriorityList(rows, context);
                const largeBucket = model.buckets[model.buckets.length - 1];
                elements.segmentSummary.textContent = `זוהו ${formatNumber(ambassadors.length)} שגרירים ו-${formatNumber(priorities.length)} הזדמנויות פעולה מיידיות.`;

                elements.segmentBoard.innerHTML = `
                  <div class="segment-grid">
                    <section class="analysis-card">
                      <h4>Who Should I Contact Now?</h4>
                      <ul>
                        ${priorities.length
                          ? priorities
                              .slice(0, 6)
                              .map((item) => `<li><strong>${escapeHtml(item.ambassador)}</strong> Â· ${escapeHtml(item.reason)} Â· ${escapeHtml(item.action)}</li>`)
                              .join("")
                          : `<li>לא זוהו כרגע הזדמנויות פעולה ממוקדות.</li>`}
                      </ul>
                    </section>
                    <section class="analysis-card">
                      <h4>Ambassador Intelligence</h4>
                      <ul>
                        ${ambassadors.length
                          ? ambassadors
                              .slice()
                              .sort((left, right) => right.total - left.total)
                              .slice(0, 6)
                              .map(
                                (item) => `<li><strong>${escapeHtml(item.ambassador)}</strong> Â· ${escapeHtml(item.status)} Â· ${escapeHtml(formatAmount(item.total))} Â· ${escapeHtml(item.target ? formatPercent(item.targetProgress) : "ללא יעד")} Â· ${escapeHtml(item.hoursSinceActivity ? `${Math.round(item.hoursSinceActivity)} שעות ללא פעילות` : "פעיל כעת")}</li>`
                              )
                              .join("")
                          : `<li>אין שגרירים להצגה בטווח המסונן.</li>`}
                      </ul>
                    </section>
                    <section class="analysis-card">
                      <h4>התפלגות סכומי תרומה</h4>
                      <div class="bucket-row">
                        ${model.buckets
                          .map(
                            (bucket) => `
                              <div class="bucket-item">
                                <div class="bucket-head">
                                  <span>${escapeHtml(bucket.label)}</span>
                                  <span class="text-small text-muted">${escapeHtml(formatNumber(bucket.count))} עסקאות Â· ${escapeHtml(formatAmount(bucket.total))}</span>
                                </div>
                                <div class="bucket-bar"><div class="bucket-fill" style="width:${(bucket.count / model.maxBucketCount) * 100}%"></div></div>
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                      <div class="text-small text-muted">עסקאות של ₪1000+ מהוות ${escapeHtml(formatNumber(largeBucket.count))} עסקאות ו-${escapeHtml(formatAmount(largeBucket.total))} מהמחזור המסונן.</div>
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
                const dailyWinners = computeDailyWinners(prizeRows);
                const { placeWinners, tiers, prizeModel, selectedFocus } = standings;

                renderPrizeAmbassadorDirectory(standings.leaderboard);

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

                const dailyWinnersMarkup = dailyWinners.length
                  ? `
                      <div class="dashboard-section">
                        <div class="section-head">
                          <h3>טבלת דירוג יומית - עולים לדשא</h3>
                          <div class="text-small text-muted">עד עשרה עולים שונים: בכל יום נבחר/ת המוביל/ה היומי/ת. מי שכבר עלה/תה לדשא ביום קודם מדולג/ת והבא/ה בדירוג נבחר/ת במקומו/ה.</div>
                        </div>
                        <div class="daily-winners-table-wrap">
                          <table class="daily-winners-table">
                            <thead>
                              <tr>
                                <th scope="col">יום</th>
                                <th scope="col">תאריך</th>
                                <th scope="col">מוביל/ה יומי/ת</th>
                                <th scope="col">דירוג יומי</th>
                                <th scope="col">גיוס יומי</th>
                                <th scope="col">סטטוס</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${dailyWinners
                                .map((item) => {
                                  const winner = item.winner;
                                  return `
                                    <tr>
                                      <td><span class="daily-winner-day">יום ${escapeHtml(String(item.dayNumber))}</span></td>
                                      <td>${escapeHtml(formatDate(item.date))}</td>
                                      <td>
                                        <strong>${escapeHtml(winner ? winner.ambassador : "אין עדיין מועמד/ת חדש/ה")}</strong>
                                        ${winner ? `<span class="daily-winner-deals">${escapeHtml(formatNumber(winner.deals))} עסקאות</span>` : ""}
                                      </td>
                                      <td>${winner ? `#${escapeHtml(String(item.dailyRank))}` : "-"}</td>
                                      <td>${winner ? escapeHtml(formatAmount(winner.total)) : "-"}</td>
                                      <td>
                                        ${
                                          winner
                                            ? `<span class="daily-winner-status">עולה לדשא #${escapeHtml(String(item.fieldPosition))}</span>`
                                            : `<span class="daily-winner-status is-pending">ממתין לנתונים</span>`
                                        }
                                      </td>
                                    </tr>
                                  `;
                                })
                                .join("")}
                            </tbody>
                          </table>
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

                elements.prizeBoard.innerHTML = `${podiumMarkup}${dailyWinnersMarkup}${tiersMarkup}`;
              }

              function renderPrizeAmbassadorDirectory(leaderboard) {
                if (!elements.prizeAmbassadorDirectory) {
                  return;
                }
                const search = normalizeSearchToken(state.ui.prizeAmbassadorSearch);
                const eligible = (Array.isArray(leaderboard) ? leaderboard : []).filter((entry) => Number(entry.total || 0) >= 20);
                const matches = eligible.filter((entry) => !search || normalizeSearchToken(entry.ambassador).includes(search));

                if (elements.prizeAmbassadorSearch && elements.prizeAmbassadorSearch.value !== state.ui.prizeAmbassadorSearch) {
                  elements.prizeAmbassadorSearch.value = state.ui.prizeAmbassadorSearch;
                }

                elements.prizeAmbassadorDirectory.innerHTML = matches.length
                  ? matches
                      .map((entry) => {
                        const rank = eligible.findIndex((candidate) => candidate.ambassador === entry.ambassador) + 1;
                        return `
                          <article class="prize-directory-item">
                            <span class="prize-directory-rank">${escapeHtml(String(rank))}</span>
                            <span class="prize-directory-name" title="${escapeAttribute(entry.ambassador)}">${escapeHtml(entry.ambassador)}</span>
                            <span class="prize-directory-amount">${escapeHtml(formatAmount(entry.total))}</span>
                          </article>
                        `;
                      })
                      .join("")
                  : `<div class="empty-state">${search ? "לא נמצאו שגרירים בשם המבוקש." : "עדיין אין שגרירים עם גיוס של ₪20 ומעלה."}</div>`;
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
                    ? { label: "יום שיא", value: `${formatShortDate(bestDay.date)} Â· ${formatMetricValue(getValue(bestDay))}`, tone: "accent" }
                    : null,
                  { label: "ממוצע יומי", value: formatMetricValue(averageValue) },
                  latestDay ? { label: "יום אחרון בטווח", value: `${formatShortDate(latestDay.date)} Â· ${formatMetricValue(getValue(latestDay))}`, tone: "dark" } : null,
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
                        value: `${formatShortDate(peakParts[0])} ${formatHourLabel(Number(peakParts[1]))} Â· ${formatMetricValue(bestCell[1])}`,
                        tone: "accent",
                      }
                    : null,
                  bestDay ? { label: "יום מוביל", value: `${formatShortDate(bestDay[0])} Â· ${formatMetricValue(bestDay[1])}` } : null,
                  bestHour ? { label: "שעה חזקה", value: `${formatHourLabel(Number(bestHour[0]))} Â· ${formatMetricValue(bestHour[1])}`, tone: "dark" } : null,
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
                  leader ? { label: "מוביל נוכחי", value: `${leader[0]} Â· ${formatMetricValue(leader[1])}`, tone: "accent" } : null,
                  bestCell ? { label: "פיק פעילות", value: `${bestParts[0]} Â· ${formatShortDate(bestParts[1])} Â· ${formatMetricValue(bestCell[1])}` } : null,
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
                              <td>${escapeHtml(`${row.projectDayLabel} Â· ${getWeekdayLabel(row.date)}`)}</td>
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

              function decodeXmlEntities(value) {
                return String(value || "")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&quot;/g, '"')
                  .replace(/&apos;/g, "'")
                  .replace(/&amp;/g, "&");
              }

              function readZipUint16(view, offset) {
                return view.getUint16(offset, true);
              }

              function readZipUint32(view, offset) {
                return view.getUint32(offset, true);
              }

              async function inflateZipEntry(bytes, compressionMethod) {
                if (compressionMethod === 0) {
                  return bytes;
                }
                if (compressionMethod !== 8 || typeof DecompressionStream === "undefined") {
                  throw new Error("הדפדפן אינו תומך בקריאת קובץ Excel זה. אפשר לשמור אותו כ-CSV ולנסות שוב.");
                }
                const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
                return new Uint8Array(await new Response(stream).arrayBuffer());
              }

              async function readXlsxEntries(buffer) {
                const bytes = new Uint8Array(buffer);
                if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
                  throw new Error("קובץ הפרסים גדול מדי. יש להעלות קובץ עד 2MB.");
                }
                const view = new DataView(buffer);
                const minimumOffset = Math.max(0, bytes.length - 65557);
                let endOfDirectory = -1;
                for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
                  if (readZipUint32(view, offset) === 0x06054b50) {
                    endOfDirectory = offset;
                    break;
                  }
                }
                if (endOfDirectory < 0) {
                  throw new Error("קובץ הפרסים אינו קובץ Excel תקין.");
                }
                const entryCount = readZipUint16(view, endOfDirectory + 10);
                const centralDirectoryOffset = readZipUint32(view, endOfDirectory + 16);
                if (entryCount > 128 || centralDirectoryOffset >= bytes.length) {
                  throw new Error("קובץ הפרסים אינו נתמך או מכיל יותר מדי קבצים פנימיים.");
                }
                const entries = new Map();
                let cursor = centralDirectoryOffset;
                let totalExtractedBytes = 0;
                for (let index = 0; index < entryCount; index += 1) {
                  if (cursor + 46 > bytes.length || readZipUint32(view, cursor) !== 0x02014b50) {
                    throw new Error("מבנה קובץ הפרסים אינו תקין.");
                  }
                  const compressionMethod = readZipUint16(view, cursor + 10);
                  const compressedSize = readZipUint32(view, cursor + 20);
                  const uncompressedSize = readZipUint32(view, cursor + 24);
                  const fileNameLength = readZipUint16(view, cursor + 28);
                  const extraLength = readZipUint16(view, cursor + 30);
                  const commentLength = readZipUint16(view, cursor + 32);
                  const localHeaderOffset = readZipUint32(view, cursor + 42);
                  const fileNameStart = cursor + 46;
                  const fileNameEnd = fileNameStart + fileNameLength;
                  if (fileNameEnd > bytes.length || uncompressedSize > 5 * 1024 * 1024) {
                    throw new Error("קובץ הפרסים חורג ממגבלת הגודל המותרת.");
                  }
                  const fileName = new TextDecoder("utf-8").decode(bytes.slice(fileNameStart, fileNameEnd));
                  totalExtractedBytes += uncompressedSize;
                  if (totalExtractedBytes > 8 * 1024 * 1024 || localHeaderOffset + 30 > bytes.length || readZipUint32(view, localHeaderOffset) !== 0x04034b50) {
                    throw new Error("קובץ הפרסים חורג ממגבלת הגודל המותרת.");
                  }
                  const localNameLength = readZipUint16(view, localHeaderOffset + 26);
                  const localExtraLength = readZipUint16(view, localHeaderOffset + 28);
                  const payloadStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
                  const payloadEnd = payloadStart + compressedSize;
                  if (payloadEnd > bytes.length) {
                    throw new Error("מבנה קובץ הפרסים אינו תקין.");
                  }
                  entries.set(fileName, await inflateZipEntry(bytes.slice(payloadStart, payloadEnd), compressionMethod));
                  cursor = fileNameEnd + extraLength + commentLength;
                }
                return entries;
              }

              function parseXlsxSharedStrings(xml) {
                const values = [];
                String(xml || "").match(/<si(?:\\s[^>]*)?>([\\s\\S]*?)<\\/si>/g)?.forEach((item) => {
                  const text = [...item.matchAll(/<t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/t>/g)].map((match) => decodeXmlEntities(match[1])).join("");
                  values.push(text);
                });
                return values;
              }

              function spreadsheetColumnIndex(reference) {
                const letters = String(reference || "").match(/[A-Z]+/i)?.[0] || "";
                return [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
              }

              function parseXlsxSheet(xml, sharedStrings) {
                const matrix = [];
                String(xml || "").match(/<row(?:\\s[^>]*)?>([\\s\\S]*?)<\\/row>/g)?.forEach((rowXml) => {
                  const row = [];
                  [...rowXml.matchAll(/<c\\s+([^>]*)>([\\s\\S]*?)<\\/c>/g)].forEach((match) => {
                    const attributes = match[1] || "";
                    const cellXml = match[2] || "";
                    const reference = attributes.match(/\\br="([^"]+)"/)?.[1] || "";
                    const type = attributes.match(/\\bt="([^"]+)"/)?.[1] || "";
                    const column = spreadsheetColumnIndex(reference);
                    const rawValue = cellXml.match(/<v>([\\s\\S]*?)<\\/v>/)?.[1] || "";
                    const inlineValue = [...cellXml.matchAll(/<t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/t>/g)].map((value) => decodeXmlEntities(value[1])).join("");
                    row[Math.max(0, column)] = type === "s" ? (sharedStrings[Number(rawValue)] || "") : (inlineValue || decodeXmlEntities(rawValue));
                  });
                  matrix.push(row);
                });
                return matrix;
              }

              async function parseXlsxMatrix(file) {
                const entries = await readXlsxEntries(await file.arrayBuffer());
                const decoder = new TextDecoder("utf-8");
                const sharedStrings = parseXlsxSharedStrings(decoder.decode(entries.get("xl/sharedStrings.xml") || new Uint8Array()));
                const sheetName = [...entries.keys()].filter((name) => /^xl\\/worksheets\\/sheet\\d+\\.xml$/i.test(name)).sort()[0];
                if (!sheetName) {
                  throw new Error("לא נמצא גיליון נתונים בקובץ הפרסים.");
                }
                return parseXlsxSheet(decoder.decode(entries.get(sheetName)), sharedStrings);
              }

              async function loadPrizeModelFromFile(file) {
                if (file.name.toLowerCase().endsWith(".csv")) {
                  const text = await file.text();
                  return buildPrizeModelFromMatrix(parseCsv(text));
                }
                return buildPrizeModelFromMatrix(await parseXlsxMatrix(file));
              }

              async function applyPrizeModelUpload(file, options = {}) {
                const fromCampaignBuilder = Boolean(options.fromCampaignBuilder);
                try {
                  const model = await loadPrizeModelFromFile(file);
                  const validation = validatePrizeModelUpload(model, file.name);
                  if (validation.errors.length) {
                    const message = `קובץ הפרסים ${file.name} לא נטען. טבלת הפרסים הפעילה נשארה כפי שהיא.`;
                    setImportMessage(message, "error");
                    if (fromCampaignBuilder) {
                      setCampaignBuilderStatus(message, "error");
                      renderCampaignDesigner(true);
                    }
                    renderAll();
                    return false;
                  }
                  state.prizeModel = validation.normalized;
                  storePrizeModel(validation.normalized);
                  const message = validation.warnings.length
                    ? `טבלת הפרסים הוחלפה מתוך ${file.name}, אך נטענה עם אזהרות. מומלץ לבדוק שלא חסרים פרסים או מדרגות.`
                    : `טבלת הפרסים הוחלפה מתוך ${file.name}. היא נשמרת לקמפיין הפעיל ואין צורך להעלות אותה שוב בכל התחברות.`;
                  setImportMessage(message, validation.warnings.length ? "warning" : "success");
                  if (fromCampaignBuilder) {
                    setCampaignBuilderStatus(message, validation.warnings.length ? "warning" : "success");
                    queueCampaignBuilderAutosave("טבלת הפרסים עודכנה ונשמרת בטיוטת הקמפיין.");
                    renderCampaignDesigner(true);
                  }
                  renderAll();
                  return true;
                } catch (_error) {
                  const message = `טעינת קובץ הפרסים ${file.name} נכשלה.`;
                  setImportMessage(message, "error");
                  if (fromCampaignBuilder) {
                    setCampaignBuilderStatus(message, "error");
                    renderCampaignDesigner(true);
                  }
                  return false;
                }
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

              function renderSimpleMarkdown(text) {
                const escaped = escapeHtml(String(text || ""));
                return escaped
                  .split(/\\n{2,}/)
                  .map((block) => block.trim())
                  .filter(Boolean)
                  .map((block) => {
                    if (block.startsWith("## ")) {
                      return `<h3>${block.slice(3).replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>").replace(/\\n/g, "<br />")}</h3>`;
                    }
                    return `<p>${block.replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>").replace(/\\n/g, "<br />")}</p>`;
                  })
                  .join("");
              }

              function getProjectSelectedAmount() {
                const customAmount = Number(state.donation.customAmount || 0);
                if (Number.isFinite(customAmount) && customAmount > 0) {
                  return customAmount;
                }
                const presetAmount = Number(state.donation.selectedAmount || 0);
                return Number.isFinite(presetAmount) && presetAmount > 0 ? presetAmount : 0;
              }

              function getSelectedAmountCard() {
                const customAmount = Number(state.donation.customAmount || 0);
                if (Number.isFinite(customAmount) && customAmount > 0) {
                  return {
                    value: customAmount,
                    label: "סכום מותאם אישית",
                    description: "הסכום שתבחרו יועבר כפי שהוא לספק התשלום ויצורף לפרטי התרומה שתזינו כאן.",
                  };
                }
                return (state.campaignPage.amountCards || []).find((item) => Number(item.value || 0) === Number(state.donation.selectedAmount || 0)) || null;
              }

              function buildProjectDonationUrl() {
                const baseUrl = String(state.campaignPage.externalDonationUrl || "").trim();
                if (!baseUrl) {
                  throw new Error("יש להגדיר קישור יציאה לספק התשלום לפני שימוש בזרימת התרומה.");
                }
                const selectedAmount = getProjectSelectedAmount();
                const url = new URL(baseUrl, window.location.href);
                url.searchParams.set("amount", String(selectedAmount));
                url.searchParams.set("frequency", state.donation.frequency);
                url.searchParams.set("source", "yellow-project-public-page");
                if (state.donation.donorName) {
                  url.searchParams.set("full_name", state.donation.donorName);
                }
                if (state.donation.donorEmail) {
                  url.searchParams.set("email", state.donation.donorEmail);
                }
                if (state.donation.donorPhone) {
                  url.searchParams.set("phone", state.donation.donorPhone);
                }
                if (state.donation.ambassador && state.donation.ambassador !== "general") {
                  url.searchParams.set("ambassador", state.donation.ambassador);
                  const ambassadorRecord = getAmbassadorRecordByFullName(state.donation.ambassador);
                  if (ambassadorRecord?.nickname) {
                    url.searchParams.set("ambassador_nickname", ambassadorRecord.nickname);
                  }
                }
                url.searchParams.set("project_slug", getCampaignProjectSlug());
                if (state.donation.dedication) {
                  url.searchParams.set("dedication", state.donation.dedication);
                }
                return url.toString();
              }

              function renderCampaignDesigner(force = false) {
                if (!elements.campaignDesignerPanel) {
                  return;
                }
                const settings = state.campaignPage;
                const builder = normalizeCampaignBuilderConfig(state.campaignBuilder);
                state.campaignBuilder = builder;
                const snapshot = getCampaignBuilderSnapshot();
                const campaignRegistry = normalizeCampaignRegistry(state.campaignRegistry);
                state.campaignRegistry = campaignRegistry;
                const activeCampaignEntry = getCampaignRegistryActiveEntry(campaignRegistry);
                const preflight = buildCampaignPreflight(snapshot);
                const statusState = getCampaignSettingsStatus();
                const builderStatus = getCampaignBuilderStatus();
                const directoryStatus = getAmbassadorDirectoryStatus();
                const directoryRows = state.ambassadorDirectory || [];
                const currentStep = Math.max(1, Math.min(9, Number(state.ui.campaignBuilderStep || 1)));
                state.ui.campaignBuilderStep = currentStep;
                const campaignRegistryOptions = campaignRegistry.campaigns
                  .map((item) => {
                    const label = item.id === state.activeCampaignId ? snapshot.basics.campaignName || item.name : item.name;
                    const slug = item.id === state.activeCampaignId ? snapshot.basics.slug || item.slug : item.slug;
                    return `<option value="${escapeAttribute(item.id)}"${item.id === state.activeCampaignId ? " selected" : ""}>${escapeHtml(label || "ללא שם")} Â· /${escapeHtml(slug || "campaign")}</option>`;
                  })
                  .join("");
                const steps = [
                  "פרטי קמפיין",
                  "מיתוג וסיפור",
                  "חוויית תרומה",
                  "שגרירים",
                  "צוותים",
                  "יעדים ופרסים",
                  "דאטה ואינטגרציה",
                  "גישה והרשאות",
                  "Review & Publish",
                ];
                const mediaPreviewMarkup = settings.mediaUrl
                  ? settings.mediaType === "video"
                    ? `<video src="${escapeAttribute(settings.mediaUrl)}" controls playsinline></video>`
                    : `<img src="${escapeAttribute(settings.mediaUrl)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`
                  : `<div class="settings-media-preview-placeholder">עדיין לא נטענה מדיה. לאחר העלאה, תופיע כאן תצוגה מקדימה.</div>`;
                const ambassadorRowsMarkup = directoryRows.length
                  ? `
                      <div class="table-wrap ambassador-links-table-wrap">
                        <table class="records-table ambassador-links-table">
                          <thead>
                            <tr>
                              <th>שגריר/ה</th>
                              <th>כינוי</th>
                              <th>צוות</th>
                              <th>יעד אישי</th>
                              <th>מייל</th>
                              <th>לינק אישי</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${directoryRows
                              .map(
                                (record) => `
                                  <tr>
                                    <td>${escapeHtml(record.fullName)}</td>
                                    <td dir="ltr">${escapeHtml(record.nickname)}</td>
                                    <td>${escapeHtml(record.team || "-")}</td>
                                    <td>${escapeHtml(record.personalTarget ? formatAmount(record.personalTarget) : "-")}</td>
                                    <td dir="ltr">${escapeHtml(record.email || "-")}</td>
                                    <td dir="ltr"><a href="${escapeAttribute(buildAmbassadorPersonalUrl(record))}" target="_blank" rel="noopener noreferrer">${escapeHtml(buildAmbassadorPersonalUrl(record))}</a></td>
                                  </tr>
                                `
                              )
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    `
                  : `<div class="empty-state">עדיין אין שגרירים מוגדרים. אפשר להעלות CSV או להוסיף ידנית.</div>`;
                const teamsMarkup = builder.teams.groups.length
                  ? builder.teams.groups
                      .map(
                        (group, index) => `
                          <article class="analysis-card">
                            <h4>${escapeHtml(group.name)}</h4>
                            <ul>
                              <li>מנהל/ת: ${escapeHtml(group.manager || "טרם הוגדר")}</li>
                              <li>יעד: ${escapeHtml(group.target ? formatAmount(group.target) : "ללא יעד")}</li>
                            </ul>
                            <button class="button-ghost" type="button" data-builder-action="remove-team" data-team-index="${index}">הסרה</button>
                          </article>
                        `
                      )
                      .join("")
                  : `<div class="empty-state">עדיין לא נבנו צוותים. אפשר להשאיר ריק או להוסיף קבוצות גיוס.</div>`;
                const preflightMarkup = `
                  <div class="signal-grid">
                    <section class="analysis-card">
                      <h4>Ready</h4>
                      <ul>${preflight.ready.length ? preflight.ready.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין פריטים מסומנים עדיין.</li>"}</ul>
                    </section>
                    <section class="analysis-card">
                      <h4>Warning</h4>
                      <ul>${preflight.warnings.length ? preflight.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין אזהרות פעילות.</li>"}</ul>
                    </section>
                    <section class="analysis-card">
                      <h4>Blocking Issue</h4>
                      <ul>${preflight.blocking.length ? preflight.blocking.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>אין חסימות פעילות.</li>"}</ul>
                    </section>
                  </div>
                `;
                let stepMarkup = "";

                if (currentStep === 1) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        שם הקמפיין
                        <input class="form-control" type="text" value="${escapeAttribute(builder.basics.campaignName)}" data-builder-setting="basics.campaignName" />
                      </label>
                      <label class="form-label">
                        ארגון מוביל
                        <input class="form-control" type="text" value="${escapeAttribute(builder.basics.organizationName)}" data-builder-setting="basics.organizationName" />
                      </label>
                      <label class="form-label">
                        Slug ציבורי
                        <input class="form-control" type="text" value="${escapeAttribute(builder.basics.slug)}" data-builder-setting="basics.slug" dir="ltr" />
                      </label>
                      <label class="form-label">
                        יעד גיוס
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.basics.target || "")}" data-builder-goal="total" />
                      </label>
                      <label class="form-label">
                        מטבע
                        <select class="form-select" data-builder-setting="basics.currency">
                          ${["ILS", "USD", "EUR"].map((currency) => `<option value="${currency}"${builder.basics.currency === currency ? " selected" : ""}>${currency}</option>`).join("")}
                        </select>
                      </label>
                      <label class="form-label">
                        סטטוס קמפיין
                        <select class="form-select" data-builder-setting="basics.status">
                          ${[
                            ["draft", "Draft"],
                            ["scheduled", "Scheduled"],
                            ["live", "Live"],
                            ["paused", "Paused"],
                            ["completed", "Completed"],
                            ["archived", "Archived"],
                          ].map(([value, label]) => `<option value="${value}"${builder.basics.status === value ? " selected" : ""}>${label}</option>`).join("")}
                        </select>
                      </label>
                      <label class="form-label">
                        תאריך התחלה
                        <input class="form-control" type="date" value="${escapeAttribute(builder.basics.startDate)}" data-builder-setting="basics.startDate" />
                      </label>
                      <label class="form-label">
                        שעת התחלה
                        <input class="form-control" type="time" value="${escapeAttribute(builder.basics.startTime)}" data-builder-setting="basics.startTime" />
                      </label>
                      <label class="form-label">
                        תאריך סיום
                        <input class="form-control" type="date" value="${escapeAttribute(builder.basics.endDate)}" data-builder-setting="basics.endDate" />
                      </label>
                      <label class="form-label">
                        שעת סיום
                        <input class="form-control" type="time" value="${escapeAttribute(builder.basics.endTime)}" data-builder-setting="basics.endTime" />
                      </label>
                      <label class="form-label">
                        Time zone
                        <input class="form-control" type="text" value="${escapeAttribute(builder.basics.timeZone)}" data-builder-setting="basics.timeZone" dir="ltr" />
                      </label>
                    </div>
                  `;
                } else if (currentStep === 2) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        כותרת עליונה
                        <input class="form-control" type="text" value="${escapeAttribute(settings.eyebrow)}" data-campaign-setting="eyebrow" />
                      </label>
                      <label class="form-label">
                        טווח תאריכי פרויקט
                        <input class="form-control" type="text" value="${escapeAttribute(settings.projectDatesLabel)}" data-campaign-setting="projectDatesLabel" />
                      </label>
                      <label class="form-label">
                        כותרת ראשית
                        <input class="form-control" type="text" value="${escapeAttribute(settings.title)}" data-campaign-setting="title" />
                      </label>
                      <label class="form-label">
                        תת-כותרת
                        <input class="form-control" type="text" value="${escapeAttribute(settings.subtitle)}" data-campaign-setting="subtitle" />
                      </label>
                    </div>
                    <label class="form-label">
                      סיפור הפרויקט ב-Markdown
                      <textarea class="form-control settings-textarea" data-campaign-setting="storyMarkdown">${escapeHtml(settings.storyMarkdown)}</textarea>
                    </label>
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        סוג מדיה
                        <select class="form-select" data-campaign-setting="mediaType">
                          <option value="image"${settings.mediaType === "image" ? " selected" : ""}>תמונה</option>
                          <option value="video"${settings.mediaType === "video" ? " selected" : ""}>וידאו</option>
                        </select>
                      </label>
                      <label class="form-label">
                        פונט ראשי
                        <select class="form-select" data-campaign-setting="fontFamily">
                          ${["Assistant", "Heebo", "Rubik", "Arial"].map((font) => `<option value="${font}"${settings.fontFamily === font ? " selected" : ""}>${font}</option>`).join("")}
                        </select>
                      </label>
                      <label class="form-label">
                        מצב preview
                        <select class="form-select" data-builder-setting="ui.previewMode">
                          <option value="desktop"${builder.ui.previewMode === "desktop" ? " selected" : ""}>Desktop</option>
                          <option value="mobile"${builder.ui.previewMode === "mobile" ? " selected" : ""}>Mobile</option>
                        </select>
                      </label>
                      <label class="form-label form-label--full">
                        כתובת או Data URI למדיה
                        <input class="form-control" type="text" value="${escapeAttribute(settings.mediaUrl)}" data-campaign-setting="mediaUrl" />
                      </label>
                      <label class="form-label">
                        לוגו קמפיין
                        <input class="form-control" type="text" value="${escapeAttribute(settings.campaignLogoUrl || "")}" data-campaign-setting="campaignLogoUrl" />
                      </label>
                      <label class="form-label">
                        לוגו ארגון
                        <input class="form-control" type="text" value="${escapeAttribute(settings.organizationLogoUrl || "")}" data-campaign-setting="organizationLogoUrl" />
                      </label>
                      <label class="form-label form-label--full">
                        טקסט חלופי
                        <input class="form-control" type="text" value="${escapeAttribute(settings.mediaAlt)}" data-campaign-setting="mediaAlt" />
                      </label>
                      <label class="form-label form-label--full">
                        העלאת מדיה
                        <input id="campaign-media-upload" class="form-control" type="file" accept="image/*,video/*" />
                      </label>
                      <label class="form-label">
                        העלאת לוגו קמפיין
                        <input id="campaign-logo-upload" class="form-control" type="file" accept="image/*" />
                      </label>
                      <label class="form-label">
                        העלאת לוגו ארגון
                        <input id="organization-logo-upload" class="form-control" type="file" accept="image/*" />
                      </label>
                    </div>
                    <div class="settings-inline-grid settings-inline-grid--three">
                      <label class="form-label">
                        Primary
                        <input class="form-control" type="color" value="${escapeAttribute(settings.theme.primary)}" data-campaign-setting="theme.primary" />
                      </label>
                      <label class="form-label">
                        Secondary
                        <input class="form-control" type="color" value="${escapeAttribute(settings.theme.secondary)}" data-campaign-setting="theme.secondary" />
                      </label>
                      <label class="form-label">
                        Accent
                        <input class="form-control" type="color" value="${escapeAttribute(settings.theme.accent)}" data-campaign-setting="theme.accent" />
                      </label>
                      <label class="form-label">
                        Surface
                        <input class="form-control" type="color" value="${escapeAttribute(settings.theme.surface)}" data-campaign-setting="theme.surface" />
                      </label>
                      <label class="form-label">
                        Text
                        <input class="form-control" type="color" value="${escapeAttribute(settings.theme.text)}" data-campaign-setting="theme.text" />
                      </label>
                    </div>
                    <div class="settings-media-preview">
                      <div class="settings-media-preview-head">
                        <div class="settings-media-preview-label">תצוגה מקדימה</div>
                        <div class="settings-media-preview-meta">${builder.ui.previewMode === "mobile" ? "Mobile" : "Desktop"} Â· ${escapeHtml(settings.mediaType === "video" ? "וידאו" : "תמונה")}</div>
                      </div>
                      <div class="settings-media-preview-frame">
                        ${mediaPreviewMarkup}
                      </div>
                    </div>
                  `;
                } else if (currentStep === 3) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        CTA ראשי
                        <input class="form-control" type="text" value="${escapeAttribute(settings.primaryCtaLabel)}" data-campaign-setting="primaryCtaLabel" />
                      </label>
                      <label class="form-label">
                        CTA משני
                        <input class="form-control" type="text" value="${escapeAttribute(settings.secondaryCtaLabel)}" data-campaign-setting="secondaryCtaLabel" />
                      </label>
                      <label class="form-label form-label--full">
                        קישור לסליקה חיצונית
                        <input class="form-control" type="url" value="${escapeAttribute(settings.externalDonationUrl)}" data-campaign-setting="externalDonationUrl" />
                      </label>
                    </div>
                    <label class="form-label">
                      סכומי תרומה מוגדרים מראש
                      <textarea class="form-control settings-textarea" data-campaign-setting="amountCardsText">${escapeHtml(formatAmountCardText(settings.amountCards))}</textarea>
                      <div class="text-small text-muted">שורה לכל preset: <code>180|מארז חג|תיאור קצר</code></div>
                    </label>
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        מסלול חודשי
                        <select class="form-select" data-campaign-setting="showRecurring">
                          <option value="true"${settings.showRecurring ? " selected" : ""}>פעיל</option>
                          <option value="false"${!settings.showRecurring ? " selected" : ""}>כבוי</option>
                        </select>
                      </label>
                      <label class="form-label">
                        יעד יומי
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.daily || "")}" data-builder-goal="daily" />
                      </label>
                      <label class="form-label">
                        המלצה אוטומטית
                        <input class="form-control" type="number" min="0" step="10" value="${escapeAttribute(snapshot.donation.recommendedAmount || "")}" readonly />
                      </label>
                    </div>
                    <label class="form-label">
                      הודעת אמון
                      <textarea class="form-control" data-campaign-setting="trustNote">${escapeHtml(settings.trustNote)}</textarea>
                    </label>
                    <label class="form-label">
                      הודעת מעבר/תודה
                      <textarea class="form-control" data-campaign-setting="successHint">${escapeHtml(settings.successHint)}</textarea>
                    </label>
                  `;
                } else if (currentStep === 4) {
                  stepMarkup = `
                    <section class="control-group">
                      <div class="control-group-header">
                        <h4>ייבוא CSV</h4>
                        <p>תומך גם בטופס ההרשמה: חותמת זמן, שם מלא של השגריר, מפנה, כתובת מייל, טלפון, ניסיון קודם, מקור הגעה ואישורים. כינוי חסר מופק אוטומטית מהמייל.</p>
                      </div>
                      <div class="filters-grid">
                        <label class="form-label">
                          קובץ שגרירים
                          <input id="ambassador-directory-upload" class="form-control" type="file" accept=".csv,text/csv" />
                        </label>
                        <label class="form-label">
                          תבנית לינק אישי
                          <input class="form-control" type="text" value="${escapeAttribute(`${getCampaignPlatformBaseUrl()}/${getCampaignProjectSlug()}/{nickname}`)}" readonly dir="ltr" />
                        </label>
                      </div>
                      <div class="settings-actions">
                        <div class="settings-status" data-ambassador-status${directoryStatus.tone !== "neutral" ? ` data-tone="${escapeAttribute(directoryStatus.tone)}"` : ""}>${escapeHtml(directoryStatus.message)}</div>
                        <div class="project-hero-actions">
                          <button class="button-secondary" type="button" data-project-action="export-ambassador-links">ייצוא לינקים</button>
                          <button class="button-ghost" type="button" data-project-action="clear-ambassador-directory">ניקוי רשימת שגרירים</button>
                        </div>
                      </div>
                    </section>
                    <section class="control-group">
                      <div class="control-group-header">
                        <h4>הוספה ידנית</h4>
                        <p>ליצירת שגריר בודד בלי להעלות קובץ.</p>
                      </div>
                      <div class="campaign-settings-grid">
                        <label class="form-label">
                          שם מלא
                          <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.fullName)}" data-builder-setting="ambassadors.manualDraft.fullName" />
                        </label>
                        <label class="form-label">
                          כינוי
                          <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.nickname)}" data-builder-setting="ambassadors.manualDraft.nickname" dir="ltr" />
                        </label>
                        <label class="form-label">
                          מייל
                          <input class="form-control" type="email" value="${escapeAttribute(builder.ambassadors.manualDraft.email)}" data-builder-setting="ambassadors.manualDraft.email" dir="ltr" />
                        </label>
                        <label class="form-label">
                          טלפון
                          <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.phone)}" data-builder-setting="ambassadors.manualDraft.phone" dir="ltr" />
                        </label>
                        <label class="form-label">
                          צוות
                          <input class="form-control" type="text" value="${escapeAttribute(builder.ambassadors.manualDraft.team)}" data-builder-setting="ambassadors.manualDraft.team" />
                        </label>
                        <label class="form-label">
                          יעד אישי
                          <input class="form-control" type="number" min="0" step="50" value="${escapeAttribute(builder.ambassadors.manualDraft.personalTarget)}" data-builder-setting="ambassadors.manualDraft.personalTarget" />
                        </label>
                      </div>
                      <div class="control-actions control-actions--inline">
                        <button class="button-primary" type="button" data-builder-action="add-manual-ambassador">הוספת שגריר/ה</button>
                      </div>
                    </section>
                    ${ambassadorRowsMarkup}
                  `;
                } else if (currentStep === 5) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        הפעלת צוותים
                        <select class="form-select" data-builder-setting="teams.enabled">
                          <option value="true"${builder.teams.enabled ? " selected" : ""}>כן</option>
                          <option value="false"${!builder.teams.enabled ? " selected" : ""}>לא</option>
                        </select>
                      </label>
                      <label class="form-label">
                        שם צוות חדש
                        <input id="builder-team-name" class="form-control" type="text" placeholder="לדוגמה: דרום / בוגרים / סניף מרכז" />
                      </label>
                      <label class="form-label">
                        מנהל/ת
                        <input id="builder-team-manager" class="form-control" type="text" placeholder="שם מוביל/ת" />
                      </label>
                      <label class="form-label">
                        יעד צוות
                        <input id="builder-team-target" class="form-control" type="number" min="0" step="100" placeholder="למשל 50000" />
                      </label>
                    </div>
                    <div class="control-actions control-actions--inline">
                      <button class="button-secondary" type="button" data-builder-action="add-team">הוספת צוות</button>
                    </div>
                    <div class="signal-grid">${teamsMarkup}</div>
                  `;
                } else if (currentStep === 6) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        יעד קמפיין
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.total || "")}" data-builder-goal="total" />
                      </label>
                      <label class="form-label">
                        יעד יומי
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(state.goals.daily || "")}" data-builder-goal="daily" />
                      </label>
                      <label class="form-label">
                        יעד לשגריר
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.goals.ambassadorGoal || "")}" data-builder-setting="goals.ambassadorGoal" />
                      </label>
                      <label class="form-label">
                        יעד לצוות
                        <input class="form-control" type="number" min="0" step="100" value="${escapeAttribute(builder.goals.teamGoal || "")}" data-builder-setting="goals.teamGoal" />
                      </label>
                    </div>
                    <label class="form-label">
                      הערת tie-break / eligibility
                      <textarea class="form-control settings-textarea" data-builder-setting="goals.tierRuleNote">${escapeHtml(builder.goals.tierRuleNote)}</textarea>
                    </label>
                    <section class="analysis-card form-label--full">
                      <h4>רשימת פרסים לקמפיין</h4>
                      <p>כאן מגדירים את הפרסים והמדרגות של הקמפיין הפעיל. אפשר להחליף את הטבלה הקיימת באמצעות קובץ Excel או CSV; ההחלפה אינה משפיעה על קמפיינים אחרים.</p>
                      <label class="form-label">
                        העלאת קובץ פרסים
                        <input id="campaign-prize-upload" class="form-control" type="file" accept=".xlsx,.xls,.csv,text/csv" aria-describedby="campaign-prize-upload-help" />
                      </label>
                      <div id="campaign-prize-upload-help" class="text-small text-muted">פורמטים נתמכים: Excel או CSV. הקובץ צריך לכלול פרסי מיקומים ו/או מדרגות סכום. העלאה תקינה מחליפה את הטבלה הפעילה של הקמפיין בלבד.</div>
                      <div class="status-note text-small" data-prize-upload-status aria-live="polite">טבלה פעילה: ${escapeHtml(formatNumber((state.prizeModel.placePrizes || []).length))} פרסי מיקומים ו-${escapeHtml(formatNumber((state.prizeModel.tierPrizes || []).length))} מדרגות פרס.</div>
                    </section>
                    <div class="signal-grid">
                      <article class="analysis-card">
                        <h4>פרסי מיקומים</h4>
                        <ul>${(state.prizeModel.placePrizes || []).length ? state.prizeModel.placePrizes.map((item) => `<li>${escapeHtml(item.label || `מקום ${item.place}`)} Â· ${escapeHtml(item.prize || "ללא פרס")}</li>`).join("") : "<li>אין פרסי מיקומים מוגדרים.</li>"}</ul>
                      </article>
                      <article class="analysis-card">
                        <h4>מדרגות פרס</h4>
                        <ul>${(state.prizeModel.tierPrizes || []).length ? state.prizeModel.tierPrizes.map((item) => `<li>${escapeHtml(item.prize || "מדרגה")} Â· ${escapeHtml(formatAmount(item.threshold || 0))}</li>`).join("") : "<li>אין מדרגות פרס מוגדרות.</li>"}</ul>
                      </article>
                    </div>
                  `;
                } else if (currentStep === 7) {
                  stepMarkup = `
                    <div class="signal-grid">
                      <article class="analysis-card">
                        <h4>מצב מקור נתונים</h4>
                        <ul>
                          <li>Mode: ${escapeHtml(state.sourceConfig.mode === "api" ? "API" : state.sourceConfig.mode === "google_sheets" ? "Google Sheets" : "File Upload")}</li>
                          <li>Endpoint: <span dir="ltr">${escapeHtml(state.sourceConfig.api.endpoint || "לא הוגדר")}</span></li>
                          <li>Response: ${escapeHtml(state.sourceConfig.api.responseFormat || "csv")}</li>
                          <li>Auto refresh: ${escapeHtml(formatNumber(Number(state.sourceConfig.api.autoRefreshMinutes || 0)))} דקות</li>
                        </ul>
                      </article>
                      <article class="analysis-card">
                        <h4>מיפוי וחיווי</h4>
                        <ul>
                          <li>${escapeHtml(state.sourceConfig.api.recordsPath ? `נתיב רשומות: ${state.sourceConfig.api.recordsPath}` : "אין נתיב רשומות מיוחד.")}</li>
                          <li>${escapeHtml(state.sourceConfig.api.hasBearerToken ? "קיים bearer token שמור בשרת." : "לא נשמר bearer token.")}</li>
                          <li>${escapeHtml(getSourceConfigStatus().message)}</li>
                        </ul>
                      </article>
                    </div>
                    <div class="settings-actions">
                      <div class="settings-status" data-source-summary>${escapeHtml(getSourceConfigStatus().message)}</div>
                      <div class="project-hero-actions">
                        <button class="button-secondary" type="button" data-builder-action="go-to-source-center">מעבר לחיבור מקור הנתונים</button>
                      </div>
                    </div>
                  `;
                } else if (currentStep === 8) {
                  stepMarkup = `
                    <div class="campaign-settings-grid">
                      <label class="form-label form-label--full">
                        Organization Admin
                        <textarea class="form-control settings-textarea" data-builder-email-list="permissions.admins" dir="ltr" placeholder="admin@example.org&#10;owner@example.org">${escapeHtml(serializeEmailLines(builder.permissions.admins))}</textarea>
                      </label>
                      <label class="form-label form-label--full">
                        Campaign Manager
                        <textarea class="form-control settings-textarea" data-builder-email-list="permissions.managers" dir="ltr" placeholder="manager@example.org">${escapeHtml(serializeEmailLines(builder.permissions.managers))}</textarea>
                      </label>
                      <label class="form-label form-label--full">
                        Analyst / Viewer
                        <textarea class="form-control settings-textarea" data-builder-email-list="permissions.viewers" dir="ltr" placeholder="viewer@example.org">${escapeHtml(serializeEmailLines(builder.permissions.viewers))}</textarea>
                      </label>
                    </div>
                    <div class="status-note text-small">השלב הזה שומר את מבנה ההרשאות בתוך תצורת הקמפיין. מנגנון ה־auth הקיים נשאר שרת-צד ולא נשבר.</div>
                  `;
                } else {
                  stepMarkup = `
                    ${preflightMarkup}
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        תבנית קמפיין
                        <select class="form-select" data-builder-template>
                          ${[
                            ["annual-recurring", "Annual recurring"],
                            ["ambassador", "Ambassador campaign"],
                            ["community", "Community fundraising"],
                            ["emergency", "Emergency campaign"],
                            ["short", "Short campaign"],
                            ["long-running", "Long-running campaign"],
                          ].map(([value, label]) => `<option value="${value}"${builder.templates.type === value ? " selected" : ""}>${label}</option>`).join("")}
                        </select>
                      </label>
                      <label class="form-label">
                        סטטוס נוכחי
                        <input class="form-control" type="text" value="${escapeAttribute(builder.basics.status)}" readonly />
                      </label>
                    </div>
                    <div class="control-actions control-actions--inline">
                      <button class="button-primary" type="button" data-builder-action="launch-campaign"${preflight.blocking.length ? " disabled" : ""}>Launch Campaign</button>
                    </div>
                  `;
                }

                elements.campaignDesignerPanel.innerHTML = `
                  <div class="campaign-settings-panel">
                    <div class="settings-panel-note">Campaign Builder שומר את כל שכבת ההקמה של הקמפיין: פרטים עסקיים, מיתוג, תרומות, שגרירים, פרסים והרשאות. הזרימה מיועדת לעבודה חוזרת של ארגונים ולא להגדרה חד-פעמית בלבד.</div>
                    <div class="campaign-settings-grid">
                      <label class="form-label">
                        קמפיין פעיל
                        <select class="form-select" data-campaign-registry="active-id">
                          ${campaignRegistryOptions}
                        </select>
                      </label>
                      <section class="analysis-card">
                        <h4>מאגר קמפיינים</h4>
                        <ul>
                          <li>${escapeHtml(formatNumber(campaignRegistry.campaigns.length))} קמפיינים שמורים</li>
                          <li>${escapeHtml(activeCampaignEntry?.slug || snapshot.basics.slug || "-")} /slug</li>
                          <li>${escapeHtml(activeCampaignEntry?.updatedAt ? `עודכן ${formatCampaignSavedAt(activeCampaignEntry.updatedAt)}` : "טרם נשמר בשרת")}</li>
                        </ul>
                      </section>
                    </div>
                    <div class="settings-actions">
                      <div class="settings-status" data-builder-status${builderStatus.tone !== "neutral" ? ` data-tone="${escapeAttribute(builderStatus.tone)}"` : ""}>${escapeHtml(builderStatus.message)}</div>
                      <div class="project-hero-actions">
                        <button class="button-ghost" type="button" data-builder-action="create-campaign">קמפיין חדש</button>
                        <button class="button-secondary" type="button" data-builder-action="save-now">שמירת טיוטה</button>
                        <button class="button-ghost" type="button" data-builder-action="duplicate-campaign">שכפול קמפיין</button>
                        <button class="button-ghost" type="button" data-project-action="open-project-preview">תצוגה מקדימה</button>
                      </div>
                    </div>
                    <div class="data-toolbar metric-toolbar" aria-label="שלבי ה־Campaign Builder">
                      ${steps.map((label, index) => `<button class="metric-toggle${currentStep === index + 1 ? " is-active" : ""}" type="button" data-builder-step="${index + 1}">${index + 1}. ${escapeHtml(label)}</button>`).join("")}
                    </div>
                    <div class="signal-grid">
                      <section class="analysis-card">
                        <h4>תמונת מצב</h4>
                        <ul>
                          <li>${escapeHtml(snapshot.basics.campaignName || "ללא שם קמפיין")}</li>
                          <li>${escapeHtml(snapshot.basics.organizationName || "ללא ארגון")}</li>
                          <li>${escapeHtml(formatAmount(Number(snapshot.basics.target || 0)))} יעד</li>
                          <li>${escapeHtml(formatNumber(directoryRows.length))} שגרירים</li>
                        </ul>
                      </section>
                      <section class="analysis-card">
                        <h4>מצב שמירה</h4>
                        <ul>
                          <li>Last saved: ${escapeHtml(formatCampaignSavedAt(builder.meta.lastSavedAt))}</li>
                          <li dir="ltr">Saved by: ${escapeHtml(builder.meta.lastSavedBy || "-")}</li>
                          <li>${escapeHtml(preflight.blocking.length ? `${formatNumber(preflight.blocking.length)} חסימות` : "אין חסימות פתוחות")}</li>
                        </ul>
                      </section>
                      <section class="analysis-card">
                        <h4>Preflight</h4>
                        <ul>
                          <li>${escapeHtml(`${formatNumber(preflight.ready.length)} Ready`)}</li>
                          <li>${escapeHtml(`${formatNumber(preflight.warnings.length)} Warning`)}</li>
                          <li>${escapeHtml(`${formatNumber(preflight.blocking.length)} Blocking`)}</li>
                        </ul>
                      </section>
                    </div>
                    <section class="control-group">
                      <div class="control-group-header">
                        <h4>שלב ${currentStep}: ${escapeHtml(steps[currentStep - 1])}</h4>
                        <p>מסלול מונחה להגדרת קמפיין מלא, עם טיוטה, שכפול ו־review לפני עלייה לאוויר.</p>
                      </div>
                      ${stepMarkup}
                    </section>
                    <div class="settings-actions">
                      <div class="settings-status" data-settings-status${statusState.tone !== "neutral" ? ` data-tone="${escapeAttribute(statusState.tone)}"` : ""}>${escapeHtml(statusState.message)}</div>
                      <div class="project-hero-actions">
                        <button class="button-ghost" type="button" data-builder-action="prev-step"${currentStep === 1 ? " disabled" : ""}>הקודם</button>
                        <button class="button-secondary" type="button" data-builder-action="next-step"${currentStep === steps.length ? " disabled" : ""}>הבא</button>
                        <button class="button-ghost" type="button" data-project-action="reset-campaign-settings">איפוס</button>
                      </div>
                    </div>
                  </div>
                `;
                elements.campaignDesignerPanel.dataset.ready = "true";
              }

              function renderProjectPage() {
                if (!elements.projectPageRoot) {
                  return;
                }

                const settings = state.campaignPage;
                const prizeRows = getPrizeScopeRows();
                const totalRaised = sumAmount(prizeRows);
                const latestCreated = getLatestCreatedIso(prizeRows);
                const leaderboard = buildLeaderboard(prizeRows);
                const totalGoal = Number(state.goals.total || 0);
                const progressPercent = totalGoal > 0 ? Math.max(0, Math.min(100, (totalRaised / totalGoal) * 100)) : 0;
                const selectedAmount = getProjectSelectedAmount();
                const selectedAmountCard = getSelectedAmountCard();
                const donationSummary = selectedAmount ? formatAmount(selectedAmount) : "יש לבחור סכום";
                const selectedAmountLabel = selectedAmountCard?.label || "תרומה פעילה";
                const selectedAmountDescription = selectedAmountCard?.description || "הסכום שתבחרו יועבר לספק התשלום החיצוני ויצורף לפרטי התרומה שתזינו כאן.";
                const storyMarkup = renderSimpleMarkdown(settings.storyMarkdown);
                const ambassadors = [
                  ...new Set([
                    ...state.ambassadorDirectory.map((item) => item.fullName).filter(Boolean),
                    ...leaderboard.map((item) => item.ambassador).filter(Boolean),
                  ]),
                ];
                const ambassadorOptions = [
                  `<option value="general"${state.donation.ambassador === "general" ? " selected" : ""}>תרומה כללית לפרויקט</option>`,
                  ...ambassadors.map((ambassador) => `<option value="${escapeAttribute(ambassador)}"${state.donation.ambassador === ambassador ? " selected" : ""}>${escapeHtml(ambassador)}</option>`),
                ].join("");

                let mediaMarkup = "";
                if (settings.mediaType === "video" && settings.mediaUrl) {
                  mediaMarkup = `<video class="project-media" src="${escapeAttribute(settings.mediaUrl)}" poster="${escapeAttribute(INITIAL_CAMPAIGN_LOGO)}" controls playsinline></video>`;
                } else if (settings.mediaUrl) {
                  mediaMarkup = `<img class="project-media" src="${escapeAttribute(settings.mediaUrl)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`;
                } else {
                  mediaMarkup = `<img class="project-media" src="${escapeAttribute(INITIAL_CAMPAIGN_LOGO)}" alt="${escapeAttribute(settings.mediaAlt || settings.title)}" />`;
                }

                elements.projectPageRoot.innerHTML = `
                  <section class="project-landing" style="--campaign-page-primary:${escapeAttribute(settings.theme.primary)};--campaign-page-secondary:${escapeAttribute(settings.theme.secondary)};--campaign-page-accent:${escapeAttribute(settings.theme.accent)};--campaign-page-surface:${escapeAttribute(settings.theme.surface)};--campaign-page-text:${escapeAttribute(settings.theme.text)};font-family:${escapeAttribute(`"${settings.fontFamily}", Arial, sans-serif`)};">
                    <article class="project-hero app-card--dark">
                      <div class="project-hero-grid">
                        <div class="project-hero-copy">
                          <span class="project-kicker">${escapeHtml(settings.eyebrow)}</span>
                          <h1 class="project-title">${escapeHtml(settings.title)}</h1>
                          <p class="project-subtitle">${escapeHtml(settings.subtitle)}</p>
                          <div class="project-hero-actions">
                            <button class="button-primary action-button" type="button" data-project-action="scroll-donation">${escapeHtml(settings.primaryCtaLabel || "לתרומה")}</button>
                            <button class="button-secondary action-button secondary" type="button" data-project-action="go-prizes">${escapeHtml(settings.secondaryCtaLabel || "צפייה במובילים ובזוכים")}</button>
                          </div>
                          <div class="project-stat-grid">
                            ${(settings.stats || []).map((item) => `
                              <article class="project-stat-card">
                                <div class="project-stat-value">${escapeHtml(item.value)}</div>
                                <div class="project-stat-label">${escapeHtml(item.label)}</div>
                              </article>
                            `).join("")}
                          </div>
                          <div class="project-progress">
                            <div class="project-progress-meta">
                              <strong>${escapeHtml(settings.projectDatesLabel)}</strong>
                              <span>גיוס נוכחי: ${escapeHtml(formatAmount(totalRaised))}</span>
                              <span>${latestCreated ? `עדכון אחרון: ${escapeHtml(formatDateTime(latestCreated))}` : "ממתין לעדכון נתונים"}</span>
                            </div>
                            <div class="project-progress-track" aria-hidden="true">
                              <div class="project-progress-bar" style="width:${progressPercent.toFixed(2)}%"></div>
                            </div>
                            <div class="project-progress-meta">
                              <span>${totalGoal > 0 ? `התקדמות מול יעד: ${escapeHtml(formatNumber(progressPercent.toFixed(1)))}%` : "יעד כולל יוצג כאן לאחר הזנה במסך הניהול"}</span>
                              <span>${leaderboard.length ? `שגרירים פעילים: ${escapeHtml(formatNumber(leaderboard.length))}` : "עדיין אין שגרירים פעילים בתצוגה"}</span>
                            </div>
                          </div>
                        </div>
                        <div class="project-media-frame">
                          <div class="project-media-badge">עמוד פרויקט פעיל</div>
                          ${mediaMarkup}
                        </div>
                      </div>
                    </article>

                    <div class="project-body-grid">
                      <article class="project-story-panel app-card app-card--elevated">
                        <div class="section-header">
                          <div>
                            <h3>הסיפור של הפרויקט</h3>
                            <div class="text-small text-muted">טקסט גמיש שניתן לעדכן במסך הניהול ולהתאים לכל מבצע, חג או קמפיין.</div>
                          </div>
                        </div>
                        <div class="project-story-content">${storyMarkup}</div>
                      </article>

                      <aside id="project-donation-panel" class="donation-panel app-card app-card--elevated">
                        <div class="section-header">
                          <div>
                            <h3>בחירת תרומה והמשך לתשלום</h3>
                            <div class="text-small text-muted">המסך הזה מצמצם חיכוך: סכום, פרטים בסיסיים, ואז מעבר אל ספק הסליקה החיצוני.</div>
                          </div>
                        </div>
                        <div class="donation-stepper" aria-hidden="true">
                          <article class="donation-step">
                            <div class="donation-step-index">שלב 1</div>
                            <div class="donation-step-title">בוחרים סכום</div>
                            <div class="donation-step-meta">חד פעמית או חודשית, לפי הגדרות הקמפיין.</div>
                          </article>
                          <article class="donation-step">
                            <div class="donation-step-index">שלב 2</div>
                            <div class="donation-step-title">ממלאים פרטים</div>
                            <div class="donation-step-meta">שם, דוא"ל ושיוך אופציונלי לשגריר/ה.</div>
                          </article>
                          <article class="donation-step">
                            <div class="donation-step-index">שלב 3</div>
                            <div class="donation-step-title">עוברים לתשלום</div>
                            <div class="donation-step-meta">המשך לחלון מאובטח של ספק התשלום החיצוני.</div>
                          </article>
                        </div>
                        ${settings.showRecurring ? `
                          <div class="donation-frequency" role="tablist" aria-label="סוג תרומה">
                            <button class="donation-frequency-button${state.donation.frequency === "one_time" ? " is-active" : ""}" type="button" data-project-action="set-frequency" data-value="one_time">חד פעמית</button>
                            <button class="donation-frequency-button${state.donation.frequency === "monthly" ? " is-active" : ""}" type="button" data-project-action="set-frequency" data-value="monthly">חודשית</button>
                          </div>
                        ` : ""}
                        <div class="donation-impact">
                          <div class="donation-impact-head">
                            <div>
                              <div class="donation-impact-kicker">התרומה שבחרתם</div>
                              <div class="donation-impact-title">${escapeHtml(selectedAmountLabel)}</div>
                            </div>
                            <div class="donation-impact-value">${escapeHtml(donationSummary)}</div>
                          </div>
                          <div class="donation-impact-description">${escapeHtml(selectedAmountDescription)}</div>
                        </div>
                        <div class="amount-grid">
                          ${(settings.amountCards || []).map((item) => `
                            <button class="amount-card${Number(state.donation.selectedAmount) === Number(item.value) && !state.donation.customAmount ? " is-active" : ""}" type="button" data-project-action="select-amount" data-value="${Number(item.value)}">
                              <div class="amount-card-value">${escapeHtml(formatAmount(item.value))}</div>
                              <div class="amount-card-label">${escapeHtml(item.label)}</div>
                              <div class="amount-card-description">${escapeHtml(item.description || "")}</div>
                            </button>
                          `).join("")}
                        </div>
                        <label class="form-label form-label--full">
                          סכום מותאם אישית
                          <input class="form-control" type="number" min="0" step="10" value="${escapeAttribute(state.donation.customAmount)}" data-donation-field="customAmount" placeholder="למשל 720" />
                        </label>
                        <div class="donation-grid">
                          <label class="form-label">
                            שם מלא
                            <input class="form-control" type="text" value="${escapeAttribute(state.donation.donorName)}" data-donation-field="donorName" placeholder="שם התורם/ת" />
                          </label>
                          <label class="form-label">
                            דוא"ל
                            <input class="form-control" type="email" value="${escapeAttribute(state.donation.donorEmail)}" data-donation-field="donorEmail" placeholder="name@example.org" dir="ltr" />
                          </label>
                          <label class="form-label">
                            טלפון
                            <input class="form-control" type="tel" value="${escapeAttribute(state.donation.donorPhone)}" data-donation-field="donorPhone" placeholder="050-0000000" dir="ltr" />
                          </label>
                          <label class="form-label">
                            שיוך לשגריר/ה
                            <select class="form-select" data-donation-field="ambassador">
                              ${ambassadorOptions}
                            </select>
                          </label>
                          <label class="form-label form-label--full">
                            הקדשה או הערה
                            <textarea class="form-control" data-donation-field="dedication" placeholder="רשות בלבד">${escapeHtml(state.donation.dedication)}</textarea>
                          </label>
                        </div>
                        <div class="donation-summary">
                          <div><strong>סכום שנבחר:</strong> ${escapeHtml(donationSummary)}</div>
                          <div><strong>מסלול:</strong> ${state.donation.frequency === "monthly" ? "תרומה חודשית" : "תרומה חד פעמית"}</div>
                          <div><strong>יעד שיוך:</strong> ${escapeHtml(state.donation.ambassador === "general" ? "תרומה כללית לפרויקט" : state.donation.ambassador || "תרומה כללית לפרויקט")}</div>
                        </div>
                        <div class="project-trust-list">
                          <span class="project-trust-chip">SSL אצל ספק חיצוני</span>
                          <span class="project-trust-chip">שמירת פרטיות</span>
                          <span class="project-trust-chip">מעבר לחלון מאובטח</span>
                        </div>
                        <div class="donation-flow-note">${escapeHtml(settings.trustNote)}</div>
                        <button class="button-primary action-button" type="button" data-project-action="continue-donation">${escapeHtml(settings.primaryCtaLabel || "המשך לתרומה מאובטחת")}</button>
                        <div class="text-small text-muted">${escapeHtml(settings.successHint)}</div>
                        <div class="donation-feedback${state.donation.tone ? ` is-${escapeAttribute(state.donation.tone)}` : ""}" aria-live="polite">${escapeHtml(state.donation.message || "")}</div>
                      </aside>
                    </div>
                  </section>
                `;
              }

              function runRenderStep(label, callback) {
                try {
                  callback();
                  return true;
                } catch (error) {
                  const message = error?.message || "Unknown render error";
                  console.error(`[render:${label}]`, error);
                  if (elements.controlNote) {
                    elements.controlNote.textContent = `שגיאת תצוגה באזור ${label}: ${message}`;
                    elements.controlNote.className = "status-note text-small is-error";
                  }
                  return false;
                }
              }

              function renderAll() {
                syncFiltersFromInputs();
                state.view.dailyMetric = elements.dailyMetric.value;
                state.view.heatmapMetric = elements.heatmapMetric.value;
                state.view.movementMetric = elements.movementMetric.value;
                const filteredRows = getFilteredRows();
                const compareRows = getComparisonRows();
                const prizeRows = getPrizeScopeRows();
                const isAdminPage = state.ui.page === "admin";
                const canRenderAdmin = isAdminPage && isManagerAuthenticated();
                const isPrizePage = state.ui.page === "prizes";
                const shouldRenderProjectPage = state.ui.page === "project";
                if (shouldRenderProjectPage) {
                  runRenderStep("project-page", () => renderProjectPage());
                }
                runRenderStep("brand-assets", () => renderBrandAssets());
                if (isAdminPage && state.ui.adminTab === "design") {
                  runRenderStep("campaign-designer", () => renderCampaignDesigner());
                }
                runRenderStep("access-ui", () => refreshAccessUi());
                if (shouldRenderProjectPage) {
                  runRenderStep("public-hero", () => renderPublicHeroBadges(prizeRows));
                }
                if (canRenderAdmin) {
                  runRenderStep("table-visibility", () => updateTableVisibility());
                  runRenderStep("filter-summary", () => renderActiveFilterSummary());
                  runRenderStep("metric-toolbar", () => updateMetricToolbarState());
                  runRenderStep("control-note", () => setControlNote(filteredRows, prizeRows));
                  runRenderStep("admin-hero", () => renderHeroBadges(filteredRows, prizeRows, compareRows));
                  runRenderStep("metrics", () => renderMetrics(filteredRows));
                  runRenderStep("goals", () => renderGoalsBoard(filteredRows));
                  runRenderStep("validation", () => renderValidationBoard());
                  runRenderStep("executive", () => renderExecutiveBoard(filteredRows));
                  runRenderStep("quality", () => renderQualityBoard(filteredRows));
                  runRenderStep("segments", () => renderSegmentBoard(filteredRows));
                  runRenderStep("comparison", () => renderComparisonBoard(filteredRows, compareRows));
                  runRenderStep("daily-chart", () => renderDailyChart(filteredRows));
                  runRenderStep("heatmap", () => renderHeatmap(filteredRows));
                  runRenderStep("movement", () => renderMovement(filteredRows));
                  runRenderStep("table", () => renderTable(filteredRows));
                }
                if (isPrizePage || canRenderAdmin) {
                  runRenderStep("prizes", () => renderPrizeBoard(prizeRows));
                }
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
                    setAdminTab("insights");
                    if (!isManagerAuthenticated()) {
                      elements.loginEmail.focus();
                    }
                  });
                });

                elements.adminTabButtons.forEach((button) => {
                  button.addEventListener("click", () => {
                    setAdminTab(button.dataset.adminTabTarget || "insights");
                  });
                });

                if (elements.projectPageRoot) {
                  elements.projectPageRoot.addEventListener("click", (event) => {
                    const actionElement = event.target.closest("[data-project-action]");
                    if (!actionElement) {
                      return;
                    }
                    const action = actionElement.dataset.projectAction;
                    if (action === "scroll-donation") {
                      root.querySelector("#project-donation-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      return;
                    }
                    if (action === "go-prizes") {
                      setPage("prizes");
                      return;
                    }
                    if (action === "set-frequency") {
                      state.donation.frequency = actionElement.dataset.value === "monthly" ? "monthly" : "one_time";
                      state.donation.message = "";
                      state.donation.tone = "";
                      renderProjectPage();
                      return;
                    }
                    if (action === "select-amount") {
                      state.donation.selectedAmount = Number(actionElement.dataset.value || 0);
                      state.donation.customAmount = "";
                      state.donation.message = "";
                      state.donation.tone = "";
                      renderProjectPage();
                      return;
                    }
                    if (action === "continue-donation") {
                      const selectedAmount = getProjectSelectedAmount();
                      if (!selectedAmount) {
                        state.donation.message = "יש לבחור סכום תרומה לפני המעבר לתשלום.";
                        state.donation.tone = "error";
                        renderProjectPage();
                        return;
                      }
                      if (!String(state.donation.donorName || "").trim() || !String(state.donation.donorEmail || "").trim()) {
                        state.donation.message = 'יש למלא לפחות שם מלא ודוא"ל לפני המעבר לתשלום.';
                        state.donation.tone = "error";
                        renderProjectPage();
                        return;
                      }
                      try {
                        const outgoingUrl = buildProjectDonationUrl();
                        state.donation.message = "המעבר בוצע לחלון חדש של ספק התשלום.";
                        state.donation.tone = "success";
                        window.open(outgoingUrl, "_blank", "noopener,noreferrer");
                      } catch (error) {
                        state.donation.message = error?.message || "לא הוגדר עדיין קישור יציאה תקין לספק התשלום.";
                        state.donation.tone = "error";
                      }
                      renderProjectPage();
                      return;
                    }
                  });

                  elements.projectPageRoot.addEventListener("input", (event) => {
                    const field = event.target?.dataset?.donationField;
                    if (!field) {
                      return;
                    }
                    state.donation[field] = event.target.value;
                    state.donation.message = "";
                    state.donation.tone = "";
                  });

                  elements.projectPageRoot.addEventListener("change", (event) => {
                    const field = event.target?.dataset?.donationField;
                    if (!field) {
                      return;
                    }
                    if (event.target.type === "checkbox") {
                      state.donation[field] = Boolean(event.target.checked);
                    } else {
                      state.donation[field] = event.target.value;
                    }
                    state.donation.message = "";
                    state.donation.tone = "";
                    if (field === "ambassador" || field === "customAmount") {
                      renderProjectPage();
                    }
                  });
                }

                if (elements.campaignDesignerPanel) {
                  elements.campaignDesignerPanel.addEventListener("input", (event) => {
                    const builderSettingPath = event.target?.dataset?.builderSetting;
                    if (builderSettingPath) {
                      let value = event.target.value;
                      if (event.target.type === "number") {
                        value = Number(value || 0);
                      }
                      if (value === "true") {
                        value = true;
                      } else if (value === "false") {
                        value = false;
                      }
                      if (builderSettingPath.endsWith(".nickname") || builderSettingPath === "basics.slug") {
                        value = normalizeUrlSlug(value);
                        event.target.value = value;
                      }
                      if (builderSettingPath.endsWith(".email")) {
                        value = normalizeSearchToken(value);
                        event.target.value = value;
                      }
                      const nextBuilder = cloneSerializable(state.campaignBuilder);
                      setValueAtPath(nextBuilder, builderSettingPath, value);
                      state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
                      if (builderSettingPath === "basics.slug") {
                        state.campaignPage.projectSlug = value;
                      }
                      if (builderSettingPath === "basics.organizationName") {
                        renderBrandAssets();
                      }
                      queueCampaignBuilderAutosave();
                      return;
                    }

                    const builderEmailListPath = event.target?.dataset?.builderEmailList;
                    if (builderEmailListPath) {
                      const nextBuilder = cloneSerializable(state.campaignBuilder);
                      setValueAtPath(nextBuilder, builderEmailListPath, parseEmailLines(event.target.value));
                      state.campaignBuilder = normalizeCampaignBuilderConfig(nextBuilder);
                      queueCampaignBuilderAutosave();
                      return;
                    }

                    const builderGoalPath = event.target?.dataset?.builderGoal;
                    if (builderGoalPath) {
                      const numericValue = Number(event.target.value || 0);
                      if (builderGoalPath === "total") {
                        state.goals.total = numericValue;
                        state.campaignBuilder.basics.target = numericValue;
                      } else if (builderGoalPath === "daily") {
                        state.goals.daily = numericValue;
                      }
                      queueCampaignBuilderAutosave();
                      return;
                    }

                    const settingPath = event.target?.dataset?.campaignSetting;
                    if (!settingPath) {
                      return;
                    }
                    const value = event.target.value;
                    if (settingPath === "amountCardsText") {
                      state.campaignPage.amountCards = parseAmountCardText(value);
                    } else if (settingPath.startsWith("theme.")) {
                      state.campaignPage.theme[settingPath.split(".")[1]] = value;
                    } else {
                      state.campaignPage[settingPath] = value;
                    }
                    state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
                    persistCampaignPageSettings(state.campaignPage);
                    state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
                    renderBrandAssets();
                    renderProjectPage();
                    queueCampaignBuilderAutosave();
                  });

                  elements.campaignDesignerPanel.addEventListener("change", async (event) => {
                    if (event.target?.dataset?.builderStep) {
                      state.ui.campaignBuilderStep = Number(event.target.dataset.builderStep || 1);
                      renderCampaignDesigner(true);
                      return;
                    }

                    if (event.target?.dataset?.campaignRegistry === "active-id") {
                      const nextCampaignId = String(event.target.value || "").trim();
                      if (nextCampaignId && nextCampaignId !== state.activeCampaignId) {
                        await switchActiveCampaign(nextCampaignId, { message: "הקמפיין הפעיל הוחלף." });
                        renderCampaignDesigner(true);
                        renderProjectPage();
                      }
                      return;
                    }

                    if (event.target?.hasAttribute("data-builder-template")) {
                      applyCampaignTemplate(event.target.value);
                      renderCampaignDesigner(true);
                      renderProjectPage();
                      return;
                    }

                    const settingPath = event.target?.dataset?.campaignSetting;
                    if (settingPath) {
                      let value = event.target.value;
                      if (settingPath === "showRecurring") {
                        value = value === "true";
                      } else if (settingPath === "amountCardsText") {
                        value = parseAmountCardText(value);
                      }
                      if (settingPath === "amountCardsText") {
                        state.campaignPage.amountCards = value;
                      } else if (settingPath.startsWith("theme.")) {
                        state.campaignPage.theme[settingPath.split(".")[1]] = value;
                      } else {
                        state.campaignPage[settingPath] = value;
                      }
                      state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
                      persistCampaignPageSettings(state.campaignPage);
                      state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
                      renderBrandAssets();
                      if (["platformBaseUrl", "projectSlug"].includes(settingPath)) {
                        renderCampaignDesigner(true);
                      }
                      renderProjectPage();
                      queueCampaignBuilderAutosave();
                      return;
                    }

                    if (event.target.id === "campaign-media-upload") {
                      const [file] = event.target.files || [];
                      if (!file) {
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        state.campaignPage.mediaType = String(file.type || "").startsWith("video/") ? "video" : "image";
                        state.campaignPage.mediaUrl = String(reader.result || "");
                        state.campaignPage.mediaAlt = file.name;
                        state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
                        persistCampaignPageSettings(
                          state.campaignPage,
                          "המדיה נטענה ונשמרה לפאנל הניהול בדפדפן זה.",
                          "המדיה נטענה לתצוגה הנוכחית, אבל לא נשמרה בדפדפן. נסה תמונה קטנה יותר או כתובת URL קלה יותר."
                        );
                        state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
                        renderCampaignDesigner(true);
                        renderProjectPage();
                        queueCampaignBuilderAutosave("המדיה נטענה ונשמרת בטיוטת הקמפיין.");
                      };
                      reader.onerror = () => {
                        setCampaignSettingsStatus("טעינת הקובץ נכשלה. נסה שוב עם תמונה אחרת או קובץ קטן יותר.", "error");
                        renderCampaignDesigner(true);
                      };
                      reader.readAsDataURL(file);
                      return;
                    }

                    if (event.target.id === "campaign-logo-upload" || event.target.id === "organization-logo-upload") {
                      const [file] = event.target.files || [];
                      if (!file) {
                        return;
                      }
                      const targetField = event.target.id === "campaign-logo-upload" ? "campaignLogoUrl" : "organizationLogoUrl";
                      const reader = new FileReader();
                      reader.onload = () => {
                        state.campaignPage[targetField] = String(reader.result || "");
                        state.campaignPage = normalizeCampaignPageSettings(state.campaignPage);
                        persistCampaignPageSettings(
                          state.campaignPage,
                          `הלוגו נטען ונשמר עבור ${targetField === "campaignLogoUrl" ? "הקמפיין" : "הארגון"}.`,
                          "טעינת הלוגו הושלמה אך השמירה המקומית נכשלה. אפשר להדביק Data URI ידנית."
                        );
                        renderBrandAssets();
                        renderCampaignDesigner(true);
                        renderProjectPage();
                        queueCampaignBuilderAutosave("לוגו הקמפיין עודכן ונשמר בטיוטת הקמפיין.");
                      };
                      reader.onerror = () => {
                        setCampaignSettingsStatus("טעינת קובץ הלוגו נכשלה. נסה/י תמונה אחרת או הדבקת Data URI.", "error");
                        renderCampaignDesigner(true);
                      };
                      reader.readAsDataURL(file);
                      return;
                    }

                    if (event.target.id === "campaign-prize-upload") {
                      const [file] = event.target.files || [];
                      if (file) {
                        await applyPrizeModelUpload(file, { fromCampaignBuilder: true });
                      }
                      return;
                    }

                    if (event.target.id === "ambassador-directory-upload") {
                      const [file] = event.target.files || [];
                      if (!file) {
                        return;
                      }
                      try {
                        const parsed = parseAmbassadorDirectoryCsv(await file.text());
                        if (!parsed.records.length) {
                          setAmbassadorDirectoryStatus("לא זוהו שגרירים תקינים בקובץ. נדרשים שם מלא ומייל תקין או כינוי לכל שורה.", "error");
                          renderCampaignDesigner(true);
                          return;
                        }
                        const backendImport = await persistAmbassadorDirectoryToBackend(parsed.records, file.name || "ambassador-registration-csv");
                        state.ambassadorDirectory = parsed.records;
                        storeAmbassadorDirectory(state.ambassadorDirectory);
                        const notes = [];
                        notes.push(`${formatNumber(parsed.records.length)} שגרירים נשמרו עם לינקים אישיים.`);
                        if (backendImport) {
                          notes.push(`${formatNumber(backendImport.importedCount || 0)} רשומות נשמרו במסד הנתונים.`);
                          if (backendImport.duplicateRows) {
                            notes.push(`${formatNumber(backendImport.duplicateRows)} כפילויות אוחדו לפי מייל/כינוי.`);
                          }
                        }
                        if (parsed.generatedNicknames.length) {
                          notes.push(`${formatNumber(parsed.generatedNicknames.length)} \u05db\u05d9\u05e0\u05d5\u05d9\u05d9\u05dd \u05e0\u05d5\u05e6\u05e8\u05d5 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05ea \u05de\u05db\u05ea\u05d5\u05d1\u05ea \u05d4\u05de\u05d9\u05d9\u05dc.`);
                        }
                        if (parsed.missingRows.length) {
                          notes.push(`${formatNumber(parsed.missingRows.length)} שורות נדלגו בגלל שם או כינוי חסרים.`);
                        }
                        if (parsed.duplicateNicknames.length) {
                          notes.push(`${formatNumber(parsed.duplicateNicknames.length)} כפילויות כינוי נוטרלו.`);
                        }
                        setAmbassadorDirectoryStatus(notes.join(" "), parsed.missingRows.length || parsed.duplicateNicknames.length ? "warning" : "success");
                        applyAmbassadorContextFromUrl();
                        state.donation = syncDonationStateWithCampaignPage(state.donation, state.campaignPage);
                        renderCampaignDesigner(true);
                        renderProjectPage();
                        queueCampaignBuilderAutosave("רשימת השגרירים עודכנה ונשמרת בטיוטת הקמפיין.");
                      } catch (error) {
                        setAmbassadorDirectoryStatus(error?.message || "טעינת קובץ השגרירים נכשלה. ודא/י שמדובר ב-CSV תקין עם שם מלא ומייל או כינוי.", "error");
                        renderCampaignDesigner(true);
                      }
                    }
                  });

                  elements.campaignDesignerPanel.addEventListener("click", (event) => {
                    const actionElement = event.target.closest("[data-project-action]");
                    if (!actionElement) {
                      return;
                    }
                    const action = actionElement.dataset.projectAction;
                    if (action === "open-project-preview") {
                      setPage("project");
                      renderProjectPage();
                      return;
                    }
                    if (action === "reset-campaign-settings") {
                      state.campaignPage = normalizeCampaignPageSettings(cloneSerializable(INITIAL_CAMPAIGN_PAGE_SETTINGS));
                      state.campaignBuilder = normalizeCampaignBuilderConfig(null);
                      state.goals = { total: 0, daily: 0 };
                      state.prizeModel = normalizePrizeModel(cloneSerializable(INITIAL_PRIZES));
                      state.ambassadorDirectory = [];
                      state.sourceConfig = getDefaultSourceConfig();
                      persistActiveCampaignLegacyState();
                      syncCampaignRegistryFromState();
                      setCampaignSettingsStatus("הגדרות דף הפרויקט אופסו לברירת המחדל.", "success");
                      state.donation = getDefaultDonationState(state.campaignPage);
                      renderCampaignDesigner(true);
                      renderProjectPage();
                      return;
                    }
                    if (action === "export-ambassador-links") {
                      if (!state.ambassadorDirectory.length) {
                        setAmbassadorDirectoryStatus("אין עדיין שגרירים לייצוא. יש להעלות קודם קובץ CSV.", "warning");
                        renderCampaignDesigner(true);
                        return;
                      }
                      exportAmbassadorLinks(state.ambassadorDirectory);
                      setAmbassadorDirectoryStatus("קובץ הלינקים האישיים יוצא בהצלחה.", "success");
                      renderCampaignDesigner(true);
                      return;
                    }
                    if (action === "clear-ambassador-directory") {
                      state.ambassadorDirectory = [];
                      storeAmbassadorDirectory([]);
                      setAmbassadorDirectoryStatus("רשימת השגרירים המקומית נוקתה.", "warning");
                      if (state.donation.ambassador !== "general") {
                        state.donation.ambassador = "general";
                      }
                      renderCampaignDesigner(true);
                      renderProjectPage();
                      queueCampaignBuilderAutosave("רשימת השגרירים נוקתה ונשמרת בטיוטה.");
                    }
                  });

                  elements.campaignDesignerPanel.addEventListener("click", async (event) => {
                    const stepButton = event.target.closest("[data-builder-step]");
                    if (stepButton) {
                      state.ui.campaignBuilderStep = Number(stepButton.dataset.builderStep || 1);
                      renderCampaignDesigner(true);
                      return;
                    }
                    const builderActionElement = event.target.closest("[data-builder-action]");
                    if (!builderActionElement) {
                      return;
                    }
                    const action = builderActionElement.dataset.builderAction;
                    if (action === "create-campaign") {
                      createNewCampaignDraft();
                      renderCampaignDesigner(true);
                      renderProjectPage();
                      return;
                    }
                    if (action === "next-step") {
                      state.ui.campaignBuilderStep = Math.min(9, Number(state.ui.campaignBuilderStep || 1) + 1);
                      renderCampaignDesigner(true);
                      return;
                    }
                    if (action === "prev-step") {
                      state.ui.campaignBuilderStep = Math.max(1, Number(state.ui.campaignBuilderStep || 1) - 1);
                      renderCampaignDesigner(true);
                      return;
                    }
                    if (action === "save-now") {
                      try {
                        await saveCampaignBuilderConfig();
                      } catch (error) {
                        setCampaignBuilderStatus(error?.message || "שמירת טיוטת הקמפיין נכשלה.", "error");
                      }
                      renderCampaignDesigner(true);
                      return;
                    }
                    if (action === "duplicate-campaign") {
                      duplicateCampaignBuilderDraft();
                      return;
                    }
                    if (action === "go-to-source-center") {
                      setAdminTab("insights");
                      elements.sourceMode?.focus();
                      return;
                    }
                    if (action === "add-manual-ambassador") {
                      const draft = normalizeCampaignBuilderConfig(state.campaignBuilder).ambassadors.manualDraft;
                      if (!draft.fullName || !draft.nickname) {
                        setAmbassadorDirectoryStatus("כדי להוסיף שגריר ידנית יש למלא לפחות שם מלא וכינוי.", "error");
                        renderCampaignDesigner(true);
                        return;
                      }
                      state.ambassadorDirectory = normalizeAmbassadorDirectory([
                        ...state.ambassadorDirectory,
                        {
                          fullName: draft.fullName,
                          nickname: draft.nickname,
                          email: draft.email,
                          phone: draft.phone,
                          team: draft.team,
                          personalTarget: Number(draft.personalTarget || 0),
                          status: "active",
                        },
                      ]);
                      state.campaignBuilder.ambassadors.manualDraft = {
                        fullName: "",
                        nickname: "",
                        email: "",
                        phone: "",
                        team: "",
                        personalTarget: "",
                      };
                      storeAmbassadorDirectory(state.ambassadorDirectory);
                      setAmbassadorDirectoryStatus("השגריר/ה נוספו לרשימה ונשמרים בטיוטה.", "success");
                      renderCampaignDesigner(true);
                      renderProjectPage();
                      queueCampaignBuilderAutosave();
                      return;
                    }
                    if (action === "add-team") {
                      const teamName = elements.campaignDesignerPanel.querySelector("#builder-team-name")?.value || "";
                      const teamManager = elements.campaignDesignerPanel.querySelector("#builder-team-manager")?.value || "";
                      const teamTarget = Number(elements.campaignDesignerPanel.querySelector("#builder-team-target")?.value || 0);
                      if (!String(teamName).trim()) {
                        setCampaignBuilderStatus("יש להזין שם צוות לפני הוספה.", "error");
                        renderCampaignDesigner(true);
                        return;
                      }
                      state.campaignBuilder.teams.enabled = true;
                      state.campaignBuilder.teams.groups = [
                        ...state.campaignBuilder.teams.groups,
                        {
                          name: String(teamName).trim(),
                          manager: String(teamManager).trim(),
                          target: teamTarget,
                        },
                      ];
                      renderCampaignDesigner(true);
                      queueCampaignBuilderAutosave("הצוות נוסף ונשמר בטיוטה.");
                      return;
                    }
                    if (action === "remove-team") {
                      const index = Number(builderActionElement.dataset.teamIndex || -1);
                      state.campaignBuilder.teams.groups = state.campaignBuilder.teams.groups.filter((_item, itemIndex) => itemIndex !== index);
                      renderCampaignDesigner(true);
                      queueCampaignBuilderAutosave("הצוות הוסר מהטיוטה.");
                      return;
                    }
                    if (action === "launch-campaign") {
                      const preflight = buildCampaignPreflight(getCampaignBuilderSnapshot());
                      if (preflight.blocking.length) {
                        setCampaignBuilderStatus("לא ניתן להעלות קמפיין עם חסימות פתוחות. השלם/י קודם את ה־preflight.", "error");
                        renderCampaignDesigner(true);
                        return;
                      }
                      state.campaignBuilder.basics.status = "live";
                      state.campaignBuilder.review.launchedAt = new Date().toISOString();
                      try {
                        await saveCampaignBuilderConfig();
                      } catch (error) {
                        setCampaignBuilderStatus(error?.message || "שמירת סטטוס ההשקה נכשלה.", "error");
                      }
                      renderCampaignDesigner(true);
                      return;
                    }
                  });
                }

                elements.logoutButton.addEventListener("click", async () => {
                  const publicScope = getActiveCampaignIdentity();
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
                  if (elements.upload) {
                    elements.upload.value = "";
                  }
                  if (elements.compareUpload) {
                    elements.compareUpload.value = "";
                  }
                  setLoginMessage("");
                  setImportMessage(getDefaultPrizeStatusMessage());
                  resetFilterOptions();
                  renderSourceConfigControls();
                  await loadPublicDataset(publicScope).catch(() => false);
                  setPage("project");
                  renderAll();
                });

                elements.loginForm.addEventListener("submit", async (event) => {
                  event.preventDefault();
                  if (!canUseBackendAuth()) {
                    setLoginMessage(getLocalAdminEntryHint(), "error");
                    return;
                  }
                  const email = normalizeSearchToken(elements.loginEmail.value);
                  const password = elements.loginPassword.value;
                  const confirmPassword = elements.loginPasswordConfirm?.value || "";
                  storeAdminEmail(email);
                  if (!email || !password) {
                    setLoginMessage("יש למלא גם מייל וגם סיסמה.", "error");
                    return;
                  }
                  if (state.auth.setupMode && !confirmPassword) {
                    setLoginMessage("יש לאשר את הסיסמה כדי להשלים את ההגדרה הראשונית.", "error");
                    return;
                  }
                  if (state.auth.setupMode && password.length < 8) {
                    setLoginMessage("בכניסה ראשונה יש לבחור סיסמה באורך 8 תווים לפחות.", "error");
                    return;
                  }
                  if (state.auth.setupMode && password !== confirmPassword) {
                    setLoginMessage("אימות הסיסמה לא תואם.", "error");
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
                      let effectivePayload = payload;
                      let preferredScope = state?.auth?.publicScope?.organizationId && state?.auth?.publicScope?.campaignId
                        ? {
                            organizationId: state.auth.publicScope.organizationId,
                            campaignId: state.auth.publicScope.campaignId,
                          }
                        : null;
                      if (!preferredScope) {
                        try {
                          preferredScope = await fetchPublicContext();
                        } catch (_publicScopeError) {
                          preferredScope = null;
                        }
                      }
                      const payloadHasScope =
                        Array.isArray(payload?.accessibleCampaigns) &&
                        typeof payload?.role === "string" &&
                        typeof payload?.organizationSlug === "string";
                      if (!payloadHasScope) {
                        try {
                          const { response: statusResponse, payload: statusPayload } = await authRequest(AUTH_CONFIG.statusEndpoint);
                          if (statusResponse.ok && statusPayload?.authenticated && statusPayload?.email) {
                            effectivePayload = statusPayload;
                          }
                        } catch (_statusError) {
                          // If the follow-up session status request fails, continue with the login payload.
                        }
                      }
                      const scope = resolvePreferredCampaignScope(
                        effectivePayload,
                        preferredScope?.organizationId && preferredScope?.campaignId
                          ? preferredScope
                          : getActiveCampaignIdentity()
                      );
                      applyServerScope(effectivePayload, scope);
              try {
                await loadProtectedManagerData(scope, { includeCampaignBuilder: false });
                syncSourceAutoRefresh();
              } catch (datasetError) {
                const loadedPublicDataset = await loadPublicDataset(scope).catch(() => false);
                setImportMessage(
                  loadedPublicDataset
                    ? "טעינת נתוני הניהול נכשלה זמנית. מוצגים נתוני אמת עדכניים ממקור הקמפיין ללא פרטי תורמים."
                    : datasetError?.message || "הכניסה הצליחה, אך טעינת נתוני הקמפיין נכשלה.",
                  "warning"
                );
              }
                      setSetupMode(false);
                      elements.loginPassword.value = "";
                      if (elements.loginPasswordConfirm) {
                        elements.loginPasswordConfirm.value = "";
                      }
                      setLoginMessage(payload.message || "הכניסה הצליחה. הדשבורד הניהולי נפתח.", "success");
                      renderSourceConfigControls();
                      setPage("admin");
                      setAdminTab("insights");
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

                if (elements.loginResetButton) {
                  elements.loginResetButton.addEventListener("click", async () => {
                    if (!canUseLocalPasswordReset()) {
                      setLoginMessage("איפוס סיסמה זמין כרגע רק דרך השרת המקומי.", "warning");
                      return;
                    }
                    const email = normalizeSearchToken(elements.loginEmail.value);
                    if (!email) {
                      setLoginMessage("יש להזין קודם את מייל המנהל/ת שאותו רוצים לאפס.", "error");
                      elements.loginEmail.focus();
                      return;
                    }
                    const confirmed = window.confirm(`לאפס את הסיסמה עבור ${email}? בכניסה הבאה תתבקש/י להגדיר סיסמה חדשה.`);
                    if (!confirmed) {
                      return;
                    }
                    try {
                      const { response, payload } = await authRequest(AUTH_CONFIG.resetEndpoint, {
                        method: "POST",
                        body: { email },
                      });
                      state.auth.backendAvailable = true;
                      if (!response.ok) {
                        setLoginMessage(payload?.message || "איפוס הסיסמה נכשל.", "error");
                        return;
                      }
                      clearSessionState();
                      storeAdminEmail(email);
                      elements.loginEmail.value = email;
                      elements.loginPassword.value = "";
                      if (elements.loginPasswordConfirm) {
                        elements.loginPasswordConfirm.value = "";
                      }
                      setSetupMode(true);
                      setLoginMessage(payload?.message || "הסיסמה אופסה. יש להגדיר סיסמה חדשה כדי להיכנס.", "success");
                      if (elements.loginPassword) {
                        elements.loginPassword.focus();
                      }
                    } catch (_error) {
                      state.auth.backendAvailable = false;
                      setLoginMessage("שרת הניהול המקומי אינו זמין כרגע. לא ניתן לאפס סיסמה.", "error");
                    }
                  });
                }

                elements.loginEmail.addEventListener("input", () => {
                  storeAdminEmail(elements.loginEmail.value);
                  if (state.auth.setupMode) {
                    setSetupMode(false);
                  }
                  setLoginMessage("");
                });

                [
                  elements.sourceMode,
                  elements.sourceApiEndpoint,
                  elements.sourceApiMethod,
                  elements.sourceApiFormat,
                  elements.sourceApiRecordsPath,
                  elements.sourceApiAuthType,
                  elements.sourceApiAutoRefresh,
                  elements.sourceApiBearerToken,
                  elements.sourceApiHeaders,
                  elements.sourceApiBody,
                  elements.sourceApiFieldMap,
                  elements.sourceGoogleUrl,
                  elements.sourceGoogleId,
                  elements.sourceGoogleGid,
                  elements.sourceGoogleSheetName,
                  elements.sourceGoogleRange,
                  elements.sourceGoogleAccessMode,
                  elements.sourceGoogleSyncInterval,
                  elements.sourceGoogleFieldMap,
                ]
                  .filter(Boolean)
                  .forEach((element) => {
                    const eventName = element.tagName === "SELECT" ? "change" : "input";
                    element.addEventListener(eventName, () => {
                      try {
                        state.sourceConfig = collectSourceConfigFromControls();
                      } catch (_error) {
                        state.sourceConfig = normalizeSourceConfig(state.sourceConfig);
                      }
                      if (elements.sourceApiFields) {
                        elements.sourceApiFields.hidden = state.sourceConfig.mode !== "api";
                      }
                      if (elements.sourceGoogleFields) {
                        elements.sourceGoogleFields.hidden = state.sourceConfig.mode !== "google_sheets";
                      }
                      if (elements.refreshSourceApi) {
                        elements.refreshSourceApi.disabled = state.sourceConfig.mode === "file";
                      }
                    });
                  });

                if (elements.saveSourceConfig) {
                  elements.saveSourceConfig.addEventListener("click", async () => {
                    try {
                      await saveSourceConfigFromControls();
                    } catch (error) {
                      setSourceConfigStatus(error?.message || "שמירת חיבור ה-API נכשלה.", "error");
                    }
                  });
                }

                if (elements.refreshSourceApi) {
                  elements.refreshSourceApi.addEventListener("click", async () => {
                    try {
                      await saveSourceConfigFromControls({ silent: true });
                      await refreshSourceDataFromApi();
                    } catch (error) {
                      setSourceConfigStatus(error?.message || "משיכת הנתונים מהמערכת החיצונית נכשלה.", "error");
                    }
                  });
                }

                if (elements.prizeAmbassadorSearch) {
                  elements.prizeAmbassadorSearch.addEventListener("input", () => {
                    state.ui.prizeAmbassadorSearch = elements.prizeAmbassadorSearch.value;
                    renderPrizeAmbassadorDirectory(computePrizeStandings(getPrizeScopeRows()).leaderboard);
                  });
                }

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

                elements.resetWorkingData.addEventListener("click", () => {
                  restoreWorkingData();
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
                  await applyPrizeModelUpload(file, { fromCampaignBuilder: false });
                });
              }

              try {
                state.rows = enrichRows(state.rows, state.meta);
                state.validation.base = buildBaseValidationSnapshot(state.rows, state.sourceLabel);
                state.prizeModel = normalizePrizeModel(state.prizeModel);
                if (hasPrizeModelContent(state.prizeModel)) {
                  storePrizeModel(state.prizeModel);
                }
                hydrateRulesPage();
                resetFilterOptions();
                if (elements.loginEmail) {
                  elements.loginEmail.value = readStoredAdminEmail();
                }
                setSetupMode(false);
                applyAmbassadorContextFromUrl();
                await hydrateAuthSession();
                // Public data is always loaded from the live campaign endpoint. The
                // embedded file is only a startup shell and must never remain visible.
                if (!state.auth.adminDatasetLoaded) {
                  await loadPublicDataset(getActiveCampaignIdentity()).catch(() => false);
                }
                setPage(state.session ? "admin" : "project");
                setAdminTab(state.ui.adminTab);
                setLoginMessage("");
                setImportMessage(getDefaultPrizeStatusMessage());
                renderSourceConfigControls();
                bindEvents();
                renderAll();
              } catch (error) {
                console.error("[bootstrap]", error);
                const bootstrapMessage = error?.message || "Unknown bootstrap error";
                root.insertAdjacentHTML(
                  "beforeend",
                  `<div style="position:relative;z-index:30;margin:24px auto;max-width:960px;padding:16px 20px;border-radius:18px;background:rgba(255,214,41,0.16);border-inline-start:4px solid #090B10;color:#111D4A;font-weight:700;">שגיאת אתחול: ${escapeHtml(bootstrapMessage)}</div>`
                );
              }
            })();
          </script>
        </div>
        """
    ).strip()

    return (
        template.replace("__INITIAL_ROWS__", rows_json)
        .replace("__INITIAL_META__", meta_json)
        .replace("__INITIAL_SOURCE_LABEL__", source_label_json)
        .replace("__INITIAL_ORG_LOGO__", org_logo_json)
        .replace("__INITIAL_CAMPAIGN_LOGO__", campaign_logo_json)
        .replace("__INITIAL_BACKDROP__", backdrop_json)
        .replace("__INITIAL_PRIZES__", prize_json)
        .replace("__INITIAL_CAMPAIGN_PAGE_SETTINGS__", campaign_page_settings_json)
        .replace("__AUTH_CONFIG__", auth_config_json)
        .replace("__INTELLIGENCE_MODULE__", intelligence_module)
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
    browser_document = build_browser_document(browser_html)
    BROWSER_OUTPUT_HTML.write_text(browser_document, encoding="utf-8")
    INDEX_OUTPUT_HTML.write_text(browser_document, encoding="utf-8")


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
            <title>GoodRaise Dashboard</title>
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
            <title>GoodRaise | דשבורד ציבורי</title>
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
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    VIS_DIR.mkdir(parents=True, exist_ok=True)
    project_hero_url = emit_output_asset(PROJECT_HERO_IMAGE_PATH, PROJECT_HERO_IMAGE_PATH.name)
    backdrop_url = emit_output_asset(BACKDROP_PATH, BACKDROP_PATH.name)
    rows = load_rows()
    meta = build_meta(rows)
    source_label = get_source_label()
    public_rows = build_public_rows(rows)
    org_logo_data_uri = load_logo_data_uri(ORG_LOGO_PATH if ORG_LOGO_PATH.exists() else LEGACY_LOGO_PATH)
    campaign_logo_data_uri = load_logo_data_uri(CAMPAIGN_LOGO_PATH)
    prize_model = load_prize_model()
    campaign_page_settings = build_default_campaign_page_settings(project_hero_url)
    write_admin_dataset(rows, meta, source_label)
    fragment = build_fragment(
        public_rows,
        meta,
        source_label,
        org_logo_data_uri,
        campaign_logo_data_uri,
        backdrop_url,
        prize_model,
        campaign_page_settings,
    )
    FRAGMENT_PATH.write_text(fragment, encoding="utf-8")

    browser_document = build_browser_document(fragment)
    BROWSER_OUTPUT_HTML.write_text(browser_document, encoding="utf-8")
    INDEX_OUTPUT_HTML.write_text(browser_document, encoding="utf-8")

    if render_shell_output():
        export_browser_friendly_html()
    else:
        OUTPUT_HTML.write_text(browser_document, encoding="utf-8")


if __name__ == "__main__":
    main()
