"""The rule engine: index-building over lint_data/config, plus severity resolution.

The check_* methods live in the checks_* mixins; they read the indexes built
here and call severity() the same way.
"""
import re
from datetime import datetime
from pathlib import Path

from .checks_atomicity import AtomicityChecksMixin
from .checks_lexical import LexicalChecksMixin
from .checks_reference import ReferenceChecksMixin
from .csv_integrity import kind_of
from .masking import compile_alternation
from .rule_ids import _seq_ids


class Engine(LexicalChecksMixin, ReferenceChecksMixin, AtomicityChecksMixin):
    def __init__(self, config, data):
        self.config = config
        self.data = data
        self._build_indexes()

    def _build_indexes(self):
        d = self.data
        cfg = self.config

        # T1 substitutions
        self.t1_rules = {r["pattern"]: r for r in d["substitutions"]["rules"]}
        self.t1_regex = compile_alternation(self.t1_rules.keys())

        # T3 hedges.json
        h = d["hedges"]
        self.t3_escape = {e["pattern"]: e for e in h["escape_clauses"]}
        self.t3_open = {e["pattern"]: e for e in h["open_ended_clauses"]}
        self.t3_optionality = {e["pattern"]: e for e in h["optionality"]}
        self.t3_superfluous = {e["pattern"]: e for e in h["superfluous_infinitives"]}
        self.t3_hedge = {e["pattern"]: e for e in h["hedge_words"]}
        self.t3_ambiguous = set(h["ambiguous_hedge_verbs_need_context"])
        self.t3_escape_re = compile_alternation(self.t3_escape.keys())
        self.t3_open_re = compile_alternation(self.t3_open.keys())
        self.t3_optionality_re = compile_alternation(self.t3_optionality.keys())
        self.t3_superfluous_re = compile_alternation(self.t3_superfluous.keys())
        self.t3_hedge_re = compile_alternation(self.t3_hedge.keys())

        # T2 vague.json
        v = d["vague"]
        self.t2_terms = {e["pattern"]: e for e in v["terms"]}
        self.t2_regex = compile_alternation(self.t2_terms.keys())
        self.t2_id_prefixes = tuple(v["suppression"]["id_prefixes"])

        # T6 filler.json
        f = d["filler"]
        self.t6_fill = {e["pattern"]: e for e in f["fillers_and_intensifiers"]}
        self.t6_overused = {e["pattern"]: e for e in f["overused_vocabulary"]}
        self.t6_weasel = {e["pattern"]: e for e in f["weasel_words"]}
        self.t6_corp = {e["pattern"]: e for e in f["corporate_speak"]}
        self.t6_fill_re = compile_alternation(list(self.t6_fill) + list(self.t6_overused))
        self.t6_weasel_re = compile_alternation(self.t6_weasel.keys())
        self.t6_corp_re = compile_alternation(self.t6_corp.keys())
        self.t6_nom_verbs = f["nominalization"]["weak_verbs"]
        self.t6_nom_suffixes = tuple(f["nominalization"]["noun_suffixes"])
        self.t6_nom_re = re.compile(
            r"\b(" + "|".join(re.escape(v_) for v_ in self.t6_nom_verbs) + r")\b\s+(?:a |an |the )?(\w+(?:" +
            "|".join(self.t6_nom_suffixes) + r"))\b", re.IGNORECASE)

        # ai_tells.json
        ai = d["ai_tells"]
        self.ai_phrases = {e["pattern"]: e for e in ai["phrases"]}
        self.ai_regex = compile_alternation(self.ai_phrases.keys())
        self.ai_artifacts = ai["machine_artifacts"]["rules"]

        # config-derived lists
        self.t4_pronouns = cfg["t4_pronouns"]
        self.t4_pronoun_ids = _seq_ids("VEI-T4-PRO", self.t4_pronouns)
        self.t4_pronoun_re = compile_alternation(self.t4_pronouns)
        self.t4_comp_irregulars = cfg["t4_comparative_irregulars"]
        self.t4_comp_irregular_ids = _seq_ids("VEI-T4-COMP", self.t4_comp_irregulars)
        self.t4_comp_irregular_re = compile_alternation(self.t4_comp_irregulars)
        self.t4_comp_exclusions = set(w.lower() for w in cfg["t4_comparative_exclusions"])
        self.t4_min_stem = cfg["t4_comparative_min_stem_length"]

        self.t5_combinators = cfg["t5_combinators"]
        self.t5_combinator_ids = _seq_ids("VEI-T5-COMB", self.t5_combinators)
        self.t5_combinator_re = compile_alternation(self.t5_combinators)
        self.t5_punc_max = cfg["t5_punctuation_density_max"]
        self.t5_punc_chars = cfg["t5_punctuation_chars"]

        self.s7_units = set(u.lower() for u in cfg["s7_units"])
        self.uni_quant = cfg["universal_quantifiers"]
        self.directives = cfg["nasa_arm_directives"]
        self.uni_quant_re = compile_alternation(self.uni_quant)
        self.directives_re = compile_alternation(self.directives)

        self.budgets = d["budgets"]
        self.sentence_budget_by_profile = {b["profile"]: b for b in self.budgets["sentence_budgets"]}
        self.csv_field_budget_by_target = {b["target"]: b for b in self.budgets["csv_field_budgets"]}
        self.whole_file_budget_by_target = {b["target"]: b for b in self.budgets["whole_file_budgets"]}
        self.paragraph_budget = self.budgets["paragraph_budget"]

        self.abbr_allowlist = set(cfg["abbreviation_allowlist"])
        # Populated by index_terminology() once the CSV registry is loaded;
        # empty defaults so lint runs work before that call (e.g. --explain).
        self.acronym_allowed = set()
        self.deprecated_terms = {}
        self.premature_terms = {}
        self.deprecated_terms_re = None
        self.premature_terms_re = None

    # ---- terminology.csv indexing (§6.4) -------------------------------------
    # Called once from main() after the CSV registry loads, so S7_ABBR/S7_TERM
    # and the do_not_use -> T1 rules see the owner-maintained vocabulary.
    # terminology.csv ships header-only (no rows) until the owner populates it,
    # so all three stay dormant no-ops until then -- this is expected, not a bug.

    def index_terminology(self, registry, today):
        # A production project has exactly one terminology.csv (core/), but
        # the test harness also points ste_lint.py at a nested dirty fixture
        # sharing that basename (kind_of() matches by basename, not full
        # path) -- merge every terminology-kind sheet's rows rather than
        # picking just one, so real runs and fixture runs behave the same way.
        all_rows = []
        for rel_path, sheet in registry.items():
            if kind_of(rel_path) == "terminology":
                all_rows.extend(sheet["rows"])
        if not all_rows:
            return

        do_not_use_pairs = []
        for row in all_rows:
            term = (row.get("term") or "").strip()
            if not term:
                continue
            rtype = row.get("type", "")
            status = row.get("status", "")
            if rtype == "ACRONYM":
                self.acronym_allowed.add(term)
            if status == "DEPRECATED":
                self.deprecated_terms[term] = row
            if rtype == "TECHNICAL_NAME" and status == "ACTIVE":
                date_added = row.get("date_added", "")
                try:
                    if datetime.strptime(date_added, "%Y-%m-%d").date() > today:
                        self.premature_terms[term] = row
                except ValueError:
                    pass
            for synonym in (row.get("do_not_use") or "").split("|"):
                synonym = synonym.strip()
                if synonym and status == "ACTIVE":
                    do_not_use_pairs.append((synonym, term))

        self.deprecated_terms_re = compile_alternation(self.deprecated_terms.keys())
        self.premature_terms_re = compile_alternation(self.premature_terms.keys())

        if do_not_use_pairs:
            for i, (synonym, term) in enumerate(sorted(do_not_use_pairs), start=1):
                self.t1_rules[synonym] = {
                    "id": "VEI-T1-TERM-{:04d}".format(i),
                    "suggestion": term,
                    "source": "core/terminology.csv do_not_use",
                }
            self.t1_regex = compile_alternation(self.t1_rules.keys())

    def csv_field_budget(self, rel_path, field):
        basename = Path(rel_path).name
        budget = self.csv_field_budget_by_target.get("{}:{}".format(basename, field))
        if budget:
            return budget
        if kind_of(rel_path) == "decisions":
            return self.csv_field_budget_by_target.get("decisions-*.csv:{}".format(field))
        return None

    # ---- severity resolution -------------------------------------------------

    PROSE_ERROR_TESTS = {"T1", "T3", "T6"}

    def severity(self, rule_name, profile, default, test=None):
        # spec §7.4: prose profile is T1/T3/T6 at error, everything else at
        # review. This is a profile-wide cap, so it applies before -- and
        # regardless of -- any rule-specific override.
        if profile == "prose" and test is not None and test not in self.PROSE_ERROR_TESTS:
            return "review"
        best = default
        for ov in self.config.get("severity_overrides", []):
            if ov["rule"] != rule_name:
                continue
            prof = ov["profile"]
            match = prof == "*" or prof == profile or (isinstance(prof, list) and profile in prof)
            if match:
                best = ov["tier"]
                if prof != "*":
                    return best  # specific-profile override wins outright
        return best
