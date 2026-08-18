"""T5 (non-atomic), the structural S7 checks, and the word/paragraph/CSV-field budgets."""
import re

from .masking import word_count
from .rule_ids import (BUD_CSV_FIELD_ID, BUD_PARAGRAPH_ID, BUD_SENTENCE_ID, BUD_WHOLE_FILE_ID,
                       S7_ABBR_ID, S7_ARTICLE_ID, S7_BARENUM_ID, S7_MUST_ID, S7_PASSIVE_ID,
                       S7_TBD_ID, S7_TERM_ID, T5_ANDOR_ID, T5_EARS_ID, T5_MULTI_ID, T5_NOSHAL_ID,
                       T5_PUNC_ID, T5_SLASH_ID)
from .units import Finding, excerpt_around

# EARS templates (spec §8.5), regex-approximated the same way T4's comparative
# check is: not a parser, close enough to catch the common non-conforming
# shapes (a shall-sentence whose subject isn't introduced by While/When/Where/
# If-then/The). Only run against sentences with exactly one 'shall'.
EARS_RE = re.compile(
    r"^(?:"
    r"The\s+\S.*?\bshall\b\s+\S.*|"                          # Ubiquitous
    r"While\s+\S.*?,\s+(?:when\s+\S.*?,\s+)?the\s+\S.*?\bshall\b\s+\S.*|"  # State driven / Complex
    r"When\s+\S.*?,\s+the\s+\S.*?\bshall\b\s+\S.*|"          # Event driven
    r"Where\s+\S.*?,\s+the\s+\S.*?\bshall\b\s+\S.*|"          # Optional feature
    r"If\s+\S.*?,\s+then\s+the\s+\S.*?\bshall\b\s+\S.*"       # Unwanted
    r")$",
    re.IGNORECASE,
)
ABBR_RE = re.compile(r"\b[A-Z]{2,}s?\b")


class AtomicityChecksMixin:
    """Mixed into Engine; relies on the indexes built by Engine._build_indexes."""

    # ---- T5 + structural (sentence units only) -----------------------------

    def check_t5_and_structural(self, unit, findings):
        if unit.kind != "sentence":
            return
        text = unit.text
        profile = unit.profile

        shall_count = len(re.findall(r"\bshall\b", text, re.IGNORECASE))
        if profile == "spec":
            if shall_count == 0:
                sev = self.severity("zero_shall_not_a_requirement", profile, "review", test="T5")
                findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, T5_NOSHAL_ID, "T5", sev,
                                         "Non-atomic: sentence has no 'shall' -- not a requirement.",
                                         excerpt_around(text, 0, min(len(text), 30)), source="spec §8.5",
                                         row_id=unit.row_id, field=unit.field))
            elif shall_count > 1:
                sev = self.severity("T5", profile, "error", test="T5")
                findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, T5_MULTI_ID, "T5", sev,
                                         "Non-atomic: {} 'shall' imperatives in one sentence.".format(shall_count),
                                         excerpt_around(text, 0, min(len(text), 30)), source="spec §8.5",
                                         row_id=unit.row_id, field=unit.field))

        if profile in ("spec", "design") and shall_count == 1:
            for m in re.finditer(r"\ba\b|\ban\b", text, re.IGNORECASE):
                sev = self.severity("indefinite_article", profile, "review", test="structural")
                findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_ARTICLE_ID,
                                         "structural", sev,
                                         "Structural: indefinite article '{}'; prefer 'the' in requirements.".format(m.group(0)),
                                         excerpt_around(text, m.start(), m.end()), source="INCOSE R5",
                                         row_id=unit.row_id, field=unit.field))

        if profile in ("spec", "design") and shall_count == 1 and not EARS_RE.match(text.strip()):
            sev = self.severity("ears", profile, "review", test="T5")
            findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, T5_EARS_ID, "T5", sev,
                                     "Non-atomic: sentence does not conform to an EARS template.",
                                     excerpt_around(text, 0, min(len(text), 40)), source="spec §8.5 / O2",
                                     row_id=unit.row_id, field=unit.field))

        punc = sum(text.count(c) for c in self.t5_punc_chars)
        if punc > self.t5_punc_max:
            sev = self.severity("punctuation_density", profile, "warning", test="T5")
            findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, T5_PUNC_ID, "T5", sev,
                                     "Non-atomic: {} punctuation marks [,;:] in one sentence.".format(punc),
                                     excerpt_around(text, 0, min(len(text), 40)), source="NASA guidance",
                                     row_id=unit.row_id, field=unit.field))

        for m in re.finditer(r"\band/or\b", text, re.IGNORECASE):
            sev = self.severity("and_or", profile, "error", test="T5")
            findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, T5_ANDOR_ID, "T5", sev,
                                     "Non-atomic: 'and/or' is always an error.",
                                     excerpt_around(text, m.start(), m.end()), source="MIL-STD-961E / NASA SEH",
                                     row_id=unit.row_id, field=unit.field))

        for m in re.finditer(r"(?<!\d)/(?!\d)", text):
            sev = self.severity("oblique_slash", profile, "error", test="T5")
            findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, T5_SLASH_ID, "T5", sev,
                                     "Non-atomic: oblique '/' outside a unit or fraction.",
                                     excerpt_around(text, m.start(), m.end()), source="spec §8.5",
                                     row_id=unit.row_id, field=unit.field))

        if self.t5_combinator_re:
            combinator_hits = list(self.t5_combinator_re.finditer(text))
            for idx, m in enumerate(combinator_hits):
                word = m.group(1).lower()
                rid = self.t5_combinator_ids.get(word)
                if not rid:
                    continue
                rule_key = "combinator_second" if idx >= 1 else "combinator"
                default = "review"
                sev = self.severity(rule_key, profile, default, test="T5")
                if profile != "spec" or idx == 0:
                    continue  # only the 2nd+ combinator in `spec` profile is a finding (spec §8.5)
                findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, rid, "T5", sev,
                                         "Non-atomic: second combinator '{}' in one sentence (spec profile).".format(m.group(1)),
                                         excerpt_around(text, m.start(), m.end()), source="INCOSE R19",
                                         row_id=unit.row_id, field=unit.field))

        budget = self.sentence_budget_by_profile.get(profile, self.sentence_budget_by_profile.get("prose"))
        if budget:
            wc = word_count(text)
            if wc > budget["words"]:
                findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, BUD_SENTENCE_ID, "T5", budget["tier"],
                                         "Budget: sentence is {} words, over the {}-word {} budget.".format(wc, budget["words"], profile),
                                         excerpt_around(text, 0, min(len(text), 40)), source="spec §9",
                                         row_id=unit.row_id, field=unit.field))

        if "must" in re.findall(r"\bmust\b", text.lower()):
            sev = self.severity("must_keyword", profile, "warning", test="structural")
            findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, S7_MUST_ID, "structural", sev,
                                     "Structural: 'must' used; 'shall' is the mandatory keyword (O3).",
                                     excerpt_around(text, 0, min(len(text), 30)), source="O3 / DEC-TEC-TOOL-003",
                                     row_id=unit.row_id, field=unit.field))

        if re.search(r"\btbd\b", text, re.IGNORECASE):
            sev = self.severity("tbd", profile, "error", test="structural")
            findings.append(Finding(unit.file, unit.line, unit.col_offset + 1, S7_TBD_ID, "structural", sev,
                                     "Structural: 'tbd' is an error; use 'TBR' with a best estimate.",
                                     excerpt_around(text, 0, min(len(text), 30)), source="NASA SEH",
                                     row_id=unit.row_id, field=unit.field))

        for m in re.finditer(r"\b\d+(\.\d+)?\b(%)?", text):
            if m.group(2) == "%":
                continue
            after = text[m.end():m.end() + 6].strip().lower()
            unit_word = re.match(r"[a-z]+", after)
            if unit_word and unit_word.group(0) in self.s7_units:
                continue
            sev = self.severity("bare_number", profile, "warning", test="structural")
            findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_BARENUM_ID, "structural", sev,
                                     "Structural: bare number '{}' with no unit and no %.".format(m.group(0)),
                                     excerpt_around(text, m.start(), m.end()), source="spec §8.7",
                                     row_id=unit.row_id, field=unit.field))

        passive_hits = list(re.finditer(
            r"\b(is|are|was|were|be|been|being)\s+\w+(ed|en)\b(\s+by\b)?", text, re.IGNORECASE))
        for m in passive_hits:
            sev = self.severity("passive_voice", profile, "warning", test="structural")
            findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_PASSIVE_ID, "structural", sev,
                                     "Structural: passive voice.", excerpt_around(text, m.start(), m.end()),
                                     source="spec §8.7", row_id=unit.row_id, field=unit.field))

        for m in ABBR_RE.finditer(text):
            token = m.group(0)
            if token in self.abbr_allowlist or token in self.acronym_allowed:
                continue
            sev = self.severity("abbreviation", profile, "warning", test="structural")
            findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_ABBR_ID, "structural", sev,
                                     "Structural: abbreviation '{}' not in terminology.csv with type=ACRONYM.".format(token),
                                     excerpt_around(text, m.start(), m.end()), source="spec §8.7",
                                     row_id=unit.row_id, field=unit.field))

        if self.deprecated_terms_re:
            for m in self.deprecated_terms_re.finditer(text):
                sev = self.severity("deprecated_term", profile, "error", test="structural")
                findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_TERM_ID, "structural", sev,
                                         "Structural: '{}' is DEPRECATED in terminology.csv.".format(m.group(0)),
                                         excerpt_around(text, m.start(), m.end()), source="spec §8.7",
                                         row_id=unit.row_id, field=unit.field))
        if self.premature_terms_re:
            for m in self.premature_terms_re.finditer(text):
                sev = self.severity("undefined_term", profile, "error", test="structural")
                findings.append(Finding(unit.file, unit.line, m.start() + unit.col_offset + 1, S7_TERM_ID, "structural", sev,
                                         "Structural: '{}' used before its terminology.csv date_added.".format(m.group(0)),
                                         excerpt_around(text, m.start(), m.end()), source="spec §8.7",
                                         row_id=unit.row_id, field=unit.field))

    # ---- budgets: whole file / paragraph / CSV field -----------------------

    def check_paragraph_budget(self, units, findings):
        by_paragraph = {}
        for u in units:
            if u.kind == "sentence" and u.paragraph_id is not None:
                by_paragraph.setdefault(u.paragraph_id, []).append(u)
        for group in by_paragraph.values():
            if len(group) > self.paragraph_budget["sentences"]:
                first = group[0]
                findings.append(Finding(first.file, first.line, 1, BUD_PARAGRAPH_ID, "budget",
                                         self.paragraph_budget["tier"],
                                         "Budget: paragraph has {} sentences, over the {}-sentence budget.".format(
                                             len(group), self.paragraph_budget["sentences"]),
                                         "", source="spec §9"))

    def check_bud_csv_field(self, unit, findings):
        budget = self.csv_field_budget(unit.file, unit.field)
        if not budget:
            return
        wc = word_count(unit.text)
        if wc > budget["words"]:
            findings.append(Finding(unit.file, unit.line, 1, BUD_CSV_FIELD_ID, "budget", budget["tier"],
                                     "Budget: field '{}' is {} words, over the {}-word budget.".format(
                                         unit.field, wc, budget["words"]),
                                     excerpt_around(unit.text, 0, min(len(unit.text), 40)), source="spec §9",
                                     row_id=unit.row_id, field=unit.field))

    def check_whole_file_budget(self, path_rel, text, findings):
        target = self.whole_file_budget_by_target.get(path_rel)
        if not target:
            return
        wc = word_count(text)
        if wc > target["words"]:
            findings.append(Finding(path_rel, 1, 1, BUD_WHOLE_FILE_ID, "budget", target["tier"],
                                     "Budget: file is {} words, over the {}-word budget.".format(wc, target["words"]),
                                     "", source="spec §9"))
