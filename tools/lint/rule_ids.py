"""Fixed (non-bulk) rule IDs -- T4/T5/structural/csv/budget -- plus --explain text.

T1/T2/T3(hedges)/T6 rule IDs are pre-assigned in tools/lint_data/*.json.
"""


def _seq_ids(prefix, items):
    return {p: f"{prefix}-{i:04d}" for i, p in enumerate(sorted(set(items)), start=1)}


# Out-of-band on purpose: t4_comp_irregular_ids auto-numbers from 0001 up
# through however many words are in t4_comparative_irregulars (12 today,
# VEI-T4-COMP-0001..0012). A hardcoded low number here previously collided
# with an irregular word's real ID (0011 was also "worse"). 9999 stays clear
# of that list at any plausible size.
T4_COMPARATIVE_GENERIC_ID = "VEI-T4-COMP-9999"
T5_NOSHAL_ID = "VEI-T5-NOSHAL-0001"
T5_MULTI_ID = "VEI-T5-MULTI-0001"
T5_PUNC_ID = "VEI-T5-PUNC-0001"
T5_ANDOR_ID = "VEI-T5-ANDOR-0001"
T5_SLASH_ID = "VEI-T5-SLASH-0001"
T5_EARS_ID = "VEI-T5-EARS-0001"
S7_BARENUM_ID = "VEI-S7-BARENUM-0001"
S7_ARTICLE_ID = "VEI-S7-ARTICLE-0001"
S7_PASSIVE_ID = "VEI-S7-PASSIVE-0001"
S7_TBD_ID = "VEI-S7-TBD-0001"
S7_ABBR_ID = "VEI-S7-ABBR-0001"
S7_TERM_ID = "VEI-S7-TERM-0001"
S7_MUST_ID = "VEI-S7-MUST-0001"
T6_NOM_ID = "VEI-T6-NOM-0001"
BUD_SENTENCE_ID = "VEI-BUD-0001"
BUD_PARAGRAPH_ID = "VEI-BUD-0002"
BUD_CSV_FIELD_ID = "VEI-BUD-0003"
BUD_WHOLE_FILE_ID = "VEI-BUD-0004"
BUD_TRUTHS_ROWS_ID = "VEI-BUD-0005"
CSV_CHECK_IDS = {i: f"VEI-CSV-{i:04d}" for i in range(1, 11)}

EXPLAIN_TEXT = {
    T4_COMPARATIVE_GENERIC_ID: "T4 Referentially open: comparative/superlative with no stated baseline (Femmer).",
    T5_NOSHAL_ID: "T5 Non-atomic: sentence in a requirement context has zero `shall` (spec profile; G1, review-tier).",
    T5_MULTI_ID: "T5 Non-atomic: more than one `shall` in one sentence (spec profile).",
    T5_PUNC_ID: "T5 Non-atomic: more than 3 of [,;:] in one sentence (NASA guidance).",
    T5_ANDOR_ID: "T5 Non-atomic: 'and/or' is always an error (MIL-STD-961E, NASA SEH).",
    T5_SLASH_ID: "T5 Non-atomic: oblique '/' outside units or fractions.",
    T5_EARS_ID: "T5 Non-atomic: sentence does not conform to an EARS template (spec §8.5, O2).",
    S7_BARENUM_ID: "Structural: a number with no unit and no %.",
    S7_ARTICLE_ID: "Structural: prefer 'the' over 'a'/'an' in requirements (INCOSE R5).",
    S7_PASSIVE_ID: "Structural: passive voice construction.",
    S7_TBD_ID: "Structural: 'tbd' is an error; use 'TBR' with a best estimate (NASA SEH).",
    S7_ABBR_ID: "Structural: abbreviation not in terminology.csv with type=ACRONYM.",
    S7_TERM_ID: "Structural: TECHNICAL_NAME used before date_added, or a DEPRECATED term.",
    S7_MUST_ID: "Structural: 'must' used where 'shall' is the mandatory keyword (O3).",
    T6_NOM_ID: "T6 Zero-information: nominalization -- a weak verb plus a noun where a verb would do.",
    BUD_SENTENCE_ID: "Budget: sentence exceeds the profile's word budget (spec §9).",
    BUD_PARAGRAPH_ID: "Budget: paragraph exceeds 6 sentences.",
    BUD_CSV_FIELD_ID: "Budget: CSV field exceeds its word budget (spec §9).",
    BUD_WHOLE_FILE_ID: "Budget: whole-file word budget exceeded (core/00-READ-FIRST.md 600, core/writing-standard.md 1200).",
    BUD_TRUTHS_ROWS_ID: "Budget: truths.csv exceeds 40 rows (warning, escalates in weekly audit).",
    CSV_CHECK_IDS[1]: "CSV integrity: status=SUPERSEDED requires a resolving superseded_by.",
    CSV_CHECK_IDS[2]: "CSV integrity: supersedes must resolve to an existing, SUPERSEDED id.",
    CSV_CHECK_IDS[3]: "CSV integrity: no supersession cycles.",
    CSV_CHECK_IDS[4]: "CSV integrity: linked_truth_ids must all resolve.",
    CSV_CHECK_IDS[5]: "CSV integrity: source_decision_id must resolve.",
    CSV_CHECK_IDS[6]: "CSV integrity: no duplicate IDs within a file or across decision files.",
    CSV_CHECK_IDS[7]: "CSV integrity: review_by is required when status=ACTIVE.",
    CSV_CHECK_IDS[8]: "CSV integrity: review_by in the past is STALE (warning, error after 30 days).",
    CSV_CHECK_IDS[9]: "CSV integrity: every field within its word budget (implemented as BUD-0003 on the field unit, not re-checked here).",
    CSV_CHECK_IDS[10]: "CSV integrity: status and enum columns must match the allowed set, case-sensitive.",
}
