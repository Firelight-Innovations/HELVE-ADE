#!/usr/bin/env python3
"""ste_lint.py -- Veistra writing-quality linter.

Stdlib only (D1). Enforces the six-test slop definition from
core/writing-standard.md against Markdown and CSV files.

CLI entrypoint only; the rules live in tools/lint/.
Usage: python -X utf8 tools/ste_lint.py [PATH ...] [options]
See --help for options, or docs/handoffs/2026-08-09-implementation-handoff.md
and handoff/VEISTRA-DOC-CONTROL-SPEC.md for the design this implements.
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from lint.csv_integrity import check_csv_integrity, load_all_csvs
from lint.discovery import detect_profile, discover_files
from lint.engine import Engine
from lint.explain import explain
from lint.fixer import apply_fix
from lint.paths import DEFAULT_CONFIG, load_json, load_lint_data
from lint.report import build_summary, emit
from lint.units import build_csv_units, build_markdown_units


def build_arg_parser():
    p = argparse.ArgumentParser(prog="ste_lint.py", description="Veistra writing-quality linter (stdlib only).")
    p.add_argument("paths", nargs="*", help="Files or directories to lint. Default: whole project.")
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("--profile", default=None, help="Override profile detection for all targeted files.")
    p.add_argument("--config", default=str(DEFAULT_CONFIG))
    p.add_argument("--fix", action="store_true", help="Apply unambiguous T1 substitutions in place.")
    p.add_argument("--explain", metavar="RULE_ID", default=None)
    p.add_argument("--baseline", metavar="PATH", default=None)
    p.add_argument("--stats", action="store_true")
    p.add_argument("--today", metavar="YYYY-MM-DD", default=None, help="Override 'now' for staleness checks (C4).")
    return p


def main(argv=None):
    args = build_arg_parser().parse_args(argv)
    try:
        config = load_json(Path(args.config))
        data = load_lint_data()
        engine = Engine(config, data)
    except Exception as e:
        print("tool failure loading config/data: {}".format(e), file=sys.stderr)
        return 2

    if args.explain:
        return explain(args.explain, engine, data)

    today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else datetime.now(timezone.utc).date()

    try:
        targets = discover_files(args.paths, config)
        if not targets:
            print("No files to lint.", file=sys.stderr)
            return 2

        target_rel_set = {rel for rel, _ in targets}
        # The registry backing CSV integrity checks needs the whole-project
        # view (cross-file id resolution) PLUS whatever was explicitly
        # targeted -- otherwise an explicit run against a never_lint path
        # (e.g. tools/tests/corpus_dirty/*.csv, for the test harness) would
        # never appear in the registry at all and no integrity check could
        # ever fire for it.
        csv_targets_all = dict((rel, abs_) for rel, abs_ in discover_files([], config) if rel.endswith(".csv"))
        for rel, abs_ in targets:
            if rel.endswith(".csv"):
                csv_targets_all[rel] = abs_
        registry = load_all_csvs(sorted(csv_targets_all.items()))
        engine.index_terminology(registry, today)

        findings = []
        for rel_path, abs_path in targets:
            if args.fix and rel_path.endswith(".md"):
                apply_fix(abs_path, engine)
            text = abs_path.read_text(encoding="utf-8")
            first_line = text.split("\n", 1)[0] if text else ""
            profile = detect_profile(rel_path, config, override_first_line=first_line, cli_profile=args.profile)

            if rel_path.endswith(".md"):
                units = build_markdown_units(rel_path, text, profile)
                engine.check_whole_file_budget(rel_path, text, findings)
                engine.check_paragraph_budget(units, findings)
            elif rel_path.endswith(".csv"):
                sheet = registry.get(rel_path)
                if not sheet:
                    continue
                units = build_csv_units(rel_path, sheet["rows"], sheet["header"], profile)
            else:
                continue

            profile_tests = set(config["profiles"].get(profile, config["profiles"]["prose"])["tests"])
            for unit in units:
                if "T1" in profile_tests:
                    engine.check_t1(unit, findings)
                if "T3" in profile_tests:
                    engine.check_t3(unit, findings)
                if "T6" in profile_tests:
                    engine.check_t6(unit, findings)
                if unit.kind == "field" and "budgets" in profile_tests:
                    engine.check_bud_csv_field(unit, findings)
                if unit.kind == "sentence":
                    if "T2" in profile_tests:
                        engine.check_t2(unit, findings)
                    if "T4" in profile_tests:
                        engine.check_t4(unit, findings)
                    if "T5" in profile_tests:
                        engine.check_t5_and_structural(unit, findings)

        csv_findings = check_csv_integrity(registry, today, engine, target_rel_set)
        findings.extend(csv_findings)

        if args.baseline:
            try:
                baseline = load_json(Path(args.baseline))
                seen = {(f["file"], f["rule"], f["message"]) for f in baseline.get("findings", [])}
                findings = [f for f in findings if (f.file, f.rule, f.message) not in seen]
            except Exception as e:
                print("tool failure reading baseline: {}".format(e), file=sys.stderr)
                return 2

        findings.sort(key=lambda f: (f.file, f.line, f.column, f.rule))

        summary, error_n = build_summary(targets, findings)
        report_findings = [f for f in findings if args.stats or f.severity in ("error", "warning")]
        emit(args.format, args.stats, summary, report_findings)

        return 1 if error_n > 0 else 0

    except Exception as e:
        print("tool failure: {}: {}".format(type(e).__name__, e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
