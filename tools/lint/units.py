"""Findings and the linted units (Markdown lines/sentences, CSV fields)."""
from .masking import iter_markdown_units, split_sentences


class Finding:
    __slots__ = ("file", "line", "column", "row_id", "field", "rule", "test", "severity",
                 "message", "excerpt", "suggestion", "source")

    def __init__(self, file, line, column, rule, test, severity, message, excerpt,
                 suggestion=None, source=None, row_id=None, field=None):
        self.file = file
        self.line = line
        self.column = column
        self.row_id = row_id
        self.field = field
        self.rule = rule
        self.test = test
        self.severity = severity
        self.message = message
        self.excerpt = excerpt
        self.suggestion = suggestion
        self.source = source

    def to_dict(self):
        d = {"file": self.file, "line": self.line, "column": self.column}
        if self.row_id is not None:
            d["row_id"] = self.row_id
        if self.field is not None:
            d["field"] = self.field
        d.update({
            "rule": self.rule, "test": self.test, "severity": self.severity,
            "message": self.message, "excerpt": self.excerpt,
        })
        if self.suggestion is not None:
            d["suggestion"] = self.suggestion
        if self.source is not None:
            d["source"] = self.source
        return d


def excerpt_around(text, start, end, radius=15):
    lo = max(0, start - radius)
    hi = min(len(text), end + radius)
    prefix = "..." if lo > 0 else ""
    suffix = "..." if hi < len(text) else ""
    return prefix + text[lo:hi].strip() + suffix


class Unit:
    __slots__ = ("file", "line", "kind", "text", "col_offset", "profile", "row_id", "field", "paragraph_id")

    def __init__(self, file, line, kind, text, col_offset, profile, row_id=None, field=None, paragraph_id=None):
        self.file = file
        self.line = line
        self.kind = kind
        self.text = text
        self.col_offset = col_offset
        self.profile = profile
        self.row_id = row_id
        self.field = field
        self.paragraph_id = paragraph_id


def build_markdown_units(rel_path, text, profile):
    units = []
    for lineno, kind, masked, paragraph_id in iter_markdown_units(text):
        if kind == "fragment":
            units.append(Unit(rel_path, lineno, "fragment", masked, 0, profile))
        else:
            for start, sentence in split_sentences(masked):
                units.append(Unit(rel_path, lineno, "sentence", sentence, start, profile, paragraph_id=paragraph_id))
    return units


def build_csv_units(rel_path, rows, header, profile):
    units = []
    id_col = "id" if "id" in header else ("term" if "term" in header else None)
    for rownum, row in enumerate(rows, start=2):  # header is row 1
        row_id = row.get(id_col) if id_col else "row{}".format(rownum)
        for field in header:
            value = row.get(field, "") or ""
            if not value:
                continue
            units.append(Unit(rel_path, rownum, "field", value, 0, profile, row_id=row_id, field=field))
    return units
