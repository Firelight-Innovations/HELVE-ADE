"""T2 (unfalsifiable) and T4 (referentially open) -- sentence-level tests."""
import re

from .rule_ids import T4_COMPARATIVE_GENERIC_ID
from .units import Finding, excerpt_around


class ReferenceChecksMixin:
    """Mixed into Engine; relies on the indexes built by Engine._build_indexes."""

    # ---- T2 --------------------------------------------------------------

    def check_t2(self, unit, findings):
        if not self.t2_regex:
            return
        text = unit.text
        has_number_unit = bool(re.search(r"\b\d+(\.\d+)?\s*(%|[a-zA-Z]{1,4})?\b", text) and re.search(r"\d", text))
        has_id_ref = any(p in text for p in self.t2_id_prefixes)
        suppressed = has_number_unit and re.search(r"\d", text) or has_id_ref
        # A number alone doesn't suppress; require a unit word or % adjacent, or an ID ref.
        suppressed = bool(re.search(r"\d+(\.\d+)?\s?(ms|s|sec|min|hr|hrs|fps|hz|%|px|kg|g|m|km|cm|mm|db)\b", text, re.IGNORECASE)) or has_id_ref
        if suppressed:
            return
        for m in self.t2_regex.finditer(text):
            entry = self.t2_terms.get(m.group(1).lower())
            if not entry:
                continue
            sev = self.severity("T2", unit.profile, "warning", test="T2")
            findings.append(Finding(
                unit.file, unit.line, m.start() + unit.col_offset + 1,
                entry["id"], "T2", sev,
                "Unfalsifiable: '{}' with no number, unit, or named acceptance condition.".format(m.group(1)),
                excerpt_around(text, m.start(), m.end()), source="INCOSE R7 / QuARS / NASA SEH",
                row_id=unit.row_id, field=unit.field,
            ))

    # ---- T4 (sentence units only) ----------------------------------------

    def check_t4(self, unit, findings):
        if unit.kind != "sentence":
            return
        text = unit.text
        if self.t4_pronoun_re:
            for m in self.t4_pronoun_re.finditer(text):
                word = m.group(1).lower()
                rid = self.t4_pronoun_ids.get(word)
                if not rid:
                    continue
                sev = self.severity("T4", unit.profile, "warning", test="T4")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    rid, "T4", sev,
                    "Referentially open: pronoun '{}' with no clear antecedent in this unit.".format(m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="INCOSE R24 / QuARS",
                    row_id=unit.row_id, field=unit.field,
                ))
        if self.t4_comp_irregular_re:
            for m in self.t4_comp_irregular_re.finditer(text):
                word = m.group(1).lower()
                rid = self.t4_comp_irregular_ids.get(word)
                if not rid:
                    continue
                if self._has_baseline(text, m.start(), m.end()):
                    continue
                sev = self.severity("comparative_superlative", unit.profile, "warning", test="T4")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    rid, "T4", sev,
                    "Referentially open: comparative '{}' with no stated baseline.".format(m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="Femmer et al.",
                    row_id=unit.row_id, field=unit.field,
                ))
        for m in re.finditer(r"\b(\w+)(er than|est)\b|\bmore (\w+)\b|\bmost (\w+)\b", text, re.IGNORECASE):
            stem = (m.group(1) or m.group(3) or m.group(4) or "")
            if len(stem) < self.t4_min_stem:
                continue
            whole = m.group(0).lower()
            if whole in self.t4_comp_exclusions or stem.lower() in self.t4_comp_exclusions:
                continue
            # The "er than" branch already bakes "than" into the match itself
            # (spec's own regex approximation, chosen to cut G5 false
            # positives on bare "-er" words like "user"/"answer"). Checking
            # the tail for a *second* "than X" after that would never fire,
            # so _has_baseline only applies to the "est"/"more X"/"most X"
            # branches, where nothing has been consumed yet.
            if "than" not in whole and self._has_baseline(text, m.start(), m.end()):
                continue
            sev = self.severity("comparative_superlative", unit.profile, "warning", test="T4")
            findings.append(Finding(
                unit.file, unit.line, m.start() + unit.col_offset + 1,
                T4_COMPARATIVE_GENERIC_ID, "T4", sev,
                "Referentially open: comparative '{}' with no stated baseline.".format(m.group(0)),
                excerpt_around(text, m.start(), m.end()), source="Femmer et al.",
                row_id=unit.row_id, field=unit.field,
            ))

    @staticmethod
    def _has_baseline(text, start, end):
        # Caveat from the source (spec §8.4): suppress when the baseline is
        # named in the same sentence -- approximated as "than X" following.
        tail = text[end:end + 20]
        return bool(re.match(r"\s+than\s+\S", tail))
