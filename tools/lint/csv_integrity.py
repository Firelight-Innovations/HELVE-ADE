"""CSV integrity (§8.8) -- whole-project registry, cross-file id resolution."""
import csv as csv_module
from datetime import datetime
from pathlib import Path

from .rule_ids import BUD_TRUTHS_ROWS_ID, CSV_CHECK_IDS
from .units import Finding

VALID_STATUS_BY_KIND = {
    "truths": {"ACTIVE", "RETIRED"},
    "decisions": {"PROPOSED", "ACTIVE", "SUPERSEDED", "RETIRED"},
    "timeline": {"PLANNED", "DONE", "MISSED", "CANCELLED"},
    "terminology": {"ACTIVE", "DEPRECATED"},
}


def kind_of(rel_path_posix):
    name = Path(rel_path_posix).name
    if name == "truths.csv":
        return "truths"
    if name == "timeline.csv":
        return "timeline"
    if name == "terminology.csv":
        return "terminology"
    if name.startswith("decisions"):
        return "decisions"
    return None


def load_all_csvs(csv_paths):
    """Returns {rel_path: {'header': [...], 'rows': [dict,...]}}"""
    registry = {}
    for rel_path, abs_path in csv_paths:
        with open(abs_path, encoding="utf-8", newline="") as f:
            reader = csv_module.DictReader(f)
            header = reader.fieldnames or []
            rows = [row for row in reader]
        registry[rel_path] = {"header": header, "rows": rows}
    return registry


def check_csv_integrity(registry, today, engine, target_files):
    findings = []
    all_ids = {}  # id -> (file, row)
    for rel_path, sheet in registry.items():
        kind = kind_of(rel_path)
        id_col = "id" if "id" in sheet["header"] else ("term" if "term" in sheet["header"] else None)
        if not id_col:
            continue
        for row in sheet["rows"]:
            rid = row.get(id_col)
            if not rid:
                continue
            if rid in all_ids and kind == "decisions" and kind_of(all_ids[rid][0]) == "decisions":
                if rel_path in target_files:
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[6], "csv_integrity", "error",
                                             "CSV integrity: duplicate id '{}' also in {}.".format(rid, all_ids[rid][0]),
                                             "", row_id=rid))
            all_ids[rid] = (rel_path, row)

    for rel_path, sheet in registry.items():
        if rel_path not in target_files:
            continue
        kind = kind_of(rel_path)
        header = sheet["header"]
        for row in sheet["rows"]:
            rid = row.get("id") or row.get("term") or "?"

            status = row.get("status", "")
            if kind and status:
                allowed = VALID_STATUS_BY_KIND.get(kind, set())
                if allowed and status not in allowed:
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[10], "csv_integrity", "error",
                                             "CSV integrity: status '{}' not in {}.".format(status, sorted(allowed)),
                                             "", row_id=rid, field="status"))

            if kind == "decisions":
                superseded_by = row.get("superseded_by", "")
                supersedes = row.get("supersedes", "")
                if status == "SUPERSEDED":
                    if not superseded_by or superseded_by not in all_ids:
                        findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[1], "csv_integrity", "error",
                                                 "CSV integrity: status=SUPERSEDED needs a resolving superseded_by.",
                                                 "", row_id=rid, field="superseded_by"))
                if supersedes:
                    target = all_ids.get(supersedes)
                    if not target or target[1].get("status") != "SUPERSEDED":
                        findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[2], "csv_integrity", "error",
                                                 "CSV integrity: supersedes '{}' must resolve to a SUPERSEDED id.".format(supersedes),
                                                 "", row_id=rid, field="supersedes"))
                seen_chain = set()
                cur = rid
                chain_ok = True
                for _ in range(len(all_ids) + 1):
                    row_data = all_ids.get(cur)
                    if not row_data:
                        break
                    nxt = row_data[1].get("supersedes")
                    if not nxt:
                        break
                    if nxt in seen_chain:
                        chain_ok = False
                        break
                    seen_chain.add(nxt)
                    cur = nxt
                if not chain_ok:
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[3], "csv_integrity", "error",
                                             "CSV integrity: supersession cycle detected at '{}'.".format(rid),
                                             "", row_id=rid))

                linked = row.get("linked_truth_ids", "")
                if linked:
                    for tid in linked.split("|"):
                        tid = tid.strip()
                        if tid and tid not in all_ids:
                            findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[4], "csv_integrity", "error",
                                                     "CSV integrity: linked_truth_ids '{}' does not resolve.".format(tid),
                                                     "", row_id=rid, field="linked_truth_ids"))

                if status == "ACTIVE" and not row.get("review_by"):
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[7], "csv_integrity", "error",
                                             "CSV integrity: review_by is required when status=ACTIVE.",
                                             "", row_id=rid, field="review_by"))

            if kind == "truths":
                sdid = row.get("source_decision_id", "")
                if sdid and sdid not in all_ids:
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[5], "csv_integrity", "error",
                                             "CSV integrity: source_decision_id '{}' does not resolve.".format(sdid),
                                             "", row_id=rid, field="source_decision_id"))
                if status == "ACTIVE" and not row.get("review_by"):
                    findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[7], "csv_integrity", "error",
                                             "CSV integrity: review_by is required when status=ACTIVE.",
                                             "", row_id=rid, field="review_by"))

            review_by = row.get("review_by", "")
            if review_by:
                try:
                    rb = datetime.strptime(review_by, "%Y-%m-%d").date()
                    delta = (today - rb).days
                    if delta > 30:
                        findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[8], "csv_integrity", "error",
                                                 "CSV integrity: review_by {} is {} days overdue.".format(review_by, delta),
                                                 "", row_id=rid, field="review_by"))
                    elif delta > 0:
                        findings.append(Finding(rel_path, 0, 1, CSV_CHECK_IDS[8], "csv_integrity", "warning",
                                                 "CSV integrity: review_by {} is in the past (STALE).".format(review_by),
                                                 "", row_id=rid, field="review_by"))
                except ValueError:
                    pass

        if kind == "truths" and len(sheet["rows"]) > 40:
            findings.append(Finding(rel_path, 0, 1, BUD_TRUTHS_ROWS_ID, "budget", "warning",
                                     "Budget: truths.csv has {} rows, over the 40-row target.".format(len(sheet["rows"])),
                                     ""))

    return findings
