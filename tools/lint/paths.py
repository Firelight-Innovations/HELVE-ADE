"""Project paths, schema version, and JSON/data loading."""
import json
from pathlib import Path

# tools/lint/paths.py -> tools/lint -> tools -> project root
ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CONFIG = ROOT / "tools" / "lint_config.json"
LINT_DATA_DIR = ROOT / "tools" / "lint_data"
SCHEMA_VERSION = 1

LINT_DATA_NAMES = ["substitutions", "hedges", "vague", "filler", "ai_tells",
                   "pos_heuristics", "budgets"]


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_lint_data():
    return {n: load_json(LINT_DATA_DIR / f"{n}.json") for n in LINT_DATA_NAMES}
