"""Summary metrics and the text/JSON output contract."""
import json
import re
from datetime import datetime, timezone

from .discovery import ari_grade
from .paths import SCHEMA_VERSION
from .rule_ids import (BUD_CSV_FIELD_ID, BUD_PARAGRAPH_ID, BUD_SENTENCE_ID,
                       BUD_WHOLE_FILE_ID, S7_PASSIVE_ID)


def build_summary(targets, findings):
    """Returns (summary_dict, error_count)."""
    all_text = "\n".join(abs_path.read_text(encoding="utf-8") for rel, abs_path in targets if rel.endswith(".md"))
    sentence_units_count = max(1, len(re.findall(r"[.!?]", all_text)))
    error_n = sum(1 for f in findings if f.severity == "error")
    warning_n = sum(1 for f in findings if f.severity == "warning")
    review_n = sum(1 for f in findings if f.severity == "review")
    passive_n = sum(1 for f in findings if f.rule == S7_PASSIVE_ID)
    budget_violation_n = sum(1 for f in findings if f.test in ("budget",) or f.rule in
                              (BUD_SENTENCE_ID, BUD_PARAGRAPH_ID, BUD_CSV_FIELD_ID, BUD_WHOLE_FILE_ID))

    summary = {
        "files": len(targets),
        "errors": error_n, "warnings": warning_n, "review": review_n,
        "smell_density": round((error_n + warning_n) / sentence_units_count, 4) if sentence_units_count else 0.0,
        "ari_grade": round(ari_grade(all_text), 2) if all_text else 0.0,
        "passive_ratio": round(passive_n / sentence_units_count, 4) if sentence_units_count else 0.0,
        "budget_violations": budget_violation_n,
    }
    return summary, error_n


def emit(out_format, stats, summary, report_findings):
    # report_findings already reflects the stats/no-stats severity filter
    # (main() builds it as error+warning normally, or every tier under
    # --stats -- review is "advisory, only shown via --stats" per spec §4).
    # emit() always prints whatever it's handed; it must not re-filter.
    if out_format == "json":
        out = {
            "schema_version": SCHEMA_VERSION,
            "run_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "summary": summary,
            "findings": [f.to_dict() for f in report_findings],
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print("Veistra lint: {} files, {} errors, {} warnings, {} review".format(
            summary["files"], summary["errors"], summary["warnings"], summary["review"]))
        print("smell_density={} ari_grade={} passive_ratio={} budget_violations={}".format(
            summary["smell_density"], summary["ari_grade"], summary["passive_ratio"], summary["budget_violations"]))
        for f in report_findings:
            loc = "{}:{}:{}".format(f.file, f.line, f.column)
            if f.row_id:
                loc += " [{}:{}]".format(f.row_id, f.field)
            print("{} {} {} {} -- {}".format(loc, f.severity.upper(), f.test, f.rule, f.message))
            if f.excerpt:
                print("    {}".format(f.excerpt))
