"""T1, T3, T6 -- the word/phrase-lookup tests that run on every unit kind.

These are the three tests the `prose` profile keeps at error tier (spec §7.4).
"""
import re

from .rule_ids import T6_NOM_ID
from .units import Finding, excerpt_around


class LexicalChecksMixin:
    """Mixed into Engine; relies on the indexes built by Engine._build_indexes."""

    # ---- T1 --------------------------------------------------------------

    def check_t1(self, unit, findings):
        if not self.t1_regex:
            return
        for m in self.t1_regex.finditer(unit.text):
            pattern = m.group(1).lower()
            rule = self.t1_rules.get(pattern)
            if not rule:
                continue
            sev = self.severity("T1", unit.profile, "error", test="T1")
            findings.append(Finding(
                unit.file, unit.line, m.start() + unit.col_offset + 1,
                rule["id"], "T1", sev,
                "Replaceable: '{}' -> '{}'.".format(m.group(1), rule["suggestion"]),
                excerpt_around(unit.text, m.start(), m.end()),
                suggestion=rule["suggestion"], source=rule["source"],
                row_id=unit.row_id, field=unit.field,
            ))

    # ---- T3 --------------------------------------------------------------

    def check_t3(self, unit, findings):
        text = unit.text
        low = text.lower()

        def emit(m, table, rule_key_field, message_kind, source):
            entry = table[m.group(1).lower()]
            sev = self.severity(rule_key_field, unit.profile, "error", test="T3")
            findings.append(Finding(
                unit.file, unit.line, m.start() + unit.col_offset + 1,
                entry["id"], "T3", sev,
                "Optional ({}): '{}'.".format(message_kind, m.group(1)),
                excerpt_around(text, m.start(), m.end()), source=source,
                row_id=unit.row_id, field=unit.field,
            ))

        if self.t3_escape_re:
            for m in self.t3_escape_re.finditer(text):
                emit(m, self.t3_escape, "escape_clause", "escape clause", "INCOSE R8")
        if self.t3_open_re:
            for m in self.t3_open_re.finditer(text):
                emit(m, self.t3_open, "open_ended_clause", "open-ended clause", "INCOSE R9")
        if self.t3_superfluous_re:
            for m in self.t3_superfluous_re.finditer(text):
                emit(m, self.t3_superfluous, "superfluous_infinitive", "superfluous infinitive", "INCOSE R10")
        if self.t3_optionality_re:
            for m in self.t3_optionality_re.finditer(text):
                entry = self.t3_optionality[m.group(1).lower()]
                rule_key = "single_modal_verb" if entry.get("kind") == "single_modal" else "optionality_phrase"
                sev = self.severity(rule_key, unit.profile, "error" if rule_key == "optionality_phrase" else "warning", test="T3")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    entry["id"], "T3", sev,
                    "Optional (optionality): '{}'.".format(m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="NASA ARM / QuARS",
                    row_id=unit.row_id, field=unit.field,
                ))
        if self.t3_hedge_re:
            for m in self.t3_hedge_re.finditer(text):
                word = m.group(1).lower()
                entry = self.t3_hedge.get(word)
                if not entry:
                    continue
                if word in self.t3_ambiguous:
                    # context gate: only a hedge when followed by 'as' or 'to'
                    tail = low[m.end():m.end() + 4]
                    if not (tail.startswith(" as") or tail.startswith(" to")):
                        continue
                sev = self.severity("hedge_word", unit.profile, "error", test="T3")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    entry["id"], "T3", sev,
                    "Optional (hedge): '{}'.".format(m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="retext_intensify.hedges",
                    row_id=unit.row_id, field=unit.field,
                ))

    # ---- T6 (fillers, weasels, corporate speak, AI tells, nominalization) --

    def check_t6(self, unit, findings):
        text = unit.text

        def emit_word(m, table, message_kind, source):
            entry = table.get(m.group(1).lower())
            if not entry:
                return
            sev = self.severity("T6", unit.profile, "error", test="T6")
            findings.append(Finding(
                unit.file, unit.line, m.start() + unit.col_offset + 1,
                entry["id"], "T6", sev,
                "Zero-information ({}): '{}'.".format(message_kind, m.group(1)),
                excerpt_around(text, m.start(), m.end()), source=source,
                row_id=unit.row_id, field=unit.field,
            ))

        if self.t6_fill_re:
            for m in self.t6_fill_re.finditer(text):
                entry = self.t6_fill.get(m.group(1).lower()) or self.t6_overused.get(m.group(1).lower())
                if not entry:
                    continue
                sev = self.severity("T6", unit.profile, "error", test="T6")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    entry["id"], "T6", sev,
                    "Zero-information (filler/intensifier): '{}'.".format(m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="retext_intensify / MERGED.intensifiers_adverbs",
                    row_id=unit.row_id, field=unit.field,
                ))
        if self.t6_weasel_re:
            for m in self.t6_weasel_re.finditer(text):
                emit_word(m, self.t6_weasel, "weasel word", "3+ source cross-check (§8.6)")
        if self.t6_corp_re:
            for m in self.t6_corp_re.finditer(text):
                emit_word(m, self.t6_corp, "corporate speak", "proselint.corporate_speak")
        if self.ai_regex:
            for m in self.ai_regex.finditer(text):
                entry = self.ai_phrases.get(m.group(1).lower())
                if not entry:
                    continue
                sev = self.severity("T6", unit.profile, "error", test="T6")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    entry["id"], "T6", sev,
                    "Zero-information (AI tell, {}): '{}'.".format(entry.get("kind", "phrase"), m.group(1)),
                    excerpt_around(text, m.start(), m.end()), source="tbhb/vale-ai-tells",
                    row_id=unit.row_id, field=unit.field,
                ))
        for art in self.ai_artifacts:
            for m in re.finditer(art["pattern"], text):
                sev = self.severity("T6", unit.profile, "error", test="T6")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    art["id"], "T6", sev,
                    "Zero-information (machine artifact): '{}'.".format(m.group(0)),
                    excerpt_around(text, m.start(), m.end()), source="high-confidence machine artifact",
                    row_id=unit.row_id, field=unit.field,
                ))
        if unit.kind == "sentence":
            for m in self.t6_nom_re.finditer(text):
                sev = self.severity("T6", unit.profile, "error", test="T6")
                findings.append(Finding(
                    unit.file, unit.line, m.start() + unit.col_offset + 1,
                    T6_NOM_ID, "T6", sev,
                    "Zero-information (nominalization): '{}' -- prefer a single verb.".format(m.group(0)),
                    excerpt_around(text, m.start(), m.end()), source="spec §8.6",
                    row_id=unit.row_id, field=unit.field,
                ))
