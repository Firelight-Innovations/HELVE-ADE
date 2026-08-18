"""--explain: resolve a rule ID to its fixed text or its lint_data entry."""
import json
import sys

from .rule_ids import EXPLAIN_TEXT


def explain(rule_id, engine, data):
    if rule_id in EXPLAIN_TEXT:
        print(rule_id + ":", EXPLAIN_TEXT[rule_id])
        return 0
    for section_name, section in data.items():
        found = _find_id_in(section, rule_id)
        if found:
            print(rule_id + ":", json.dumps(found, indent=2))
            return 0
    print("Unknown rule id: {}".format(rule_id), file=sys.stderr)
    return 2


def _find_id_in(obj, rule_id):
    if isinstance(obj, dict):
        if obj.get("id") == rule_id:
            return obj
        for v in obj.values():
            r = _find_id_in(v, rule_id)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_id_in(v, rule_id)
            if r:
                return r
    return None
