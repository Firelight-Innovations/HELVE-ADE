"""Line masking, Markdown unit iteration, sentence splitting, alternation regexes.

Masking strips non-prose spans while preserving character offsets, so every
regex match's column is a true column into the original line.
"""
import re

INLINE_CODE_RE = re.compile(r"`[^`]*`")
URL_RE = re.compile(r"https?://\S+")
IMAGE_ALT_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
MD_LINK_TARGET_RE = re.compile(r"(?<=\])\([^)]*\)")


def mask_line(line):
    def blank(m):
        return " " * len(m.group(0))
    line = IMAGE_ALT_RE.sub(blank, line)
    line = MD_LINK_TARGET_RE.sub(blank, line)
    line = URL_RE.sub(blank, line)
    line = INLINE_CODE_RE.sub(blank, line)
    return line


FENCE_RE = re.compile(r"^\s*```")
HEADING_RE = re.compile(r"^\s*#+\s*")
TABLE_ROW_RE = re.compile(r"^\s*\|")
TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")
LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")
HTML_COMMENT_LINE_RE = re.compile(r"^\s*<!--.*-->\s*$")


def iter_markdown_units(text):
    """Yield (lineno, kind, masked_text, paragraph_id) for each linted line.
    kind is 'fragment' (heading/table cell) or 'sentence' (paragraph/list
    item). Fenced code, YAML front matter, blank lines are skipped entirely.

    paragraph_id groups consecutive plain-paragraph lines for the BUD_PARAGRAPH
    check (spec §9): None for fragments; a fresh int per list item (each item
    is its own small paragraph); shared across contiguous plain-text lines,
    reset by any blank line, heading, table, list item, or fence boundary.
    """
    lines = text.split("\n")
    in_fence = False
    in_frontmatter = False
    paragraph_id = 0
    last_plain_lineno = None
    for i, raw_line in enumerate(lines):
        lineno = i + 1
        stripped = raw_line.strip()
        if i == 0 and stripped == "---":
            in_frontmatter = True
            continue
        if in_frontmatter:
            if stripped == "---":
                in_frontmatter = False
            continue
        if FENCE_RE.match(raw_line):
            in_fence = not in_fence
            last_plain_lineno = None
            continue
        if HTML_COMMENT_LINE_RE.match(raw_line):
            # Whole-line HTML comments (e.g. <!-- lint-profile: NAME -->)
            # aren't prose -- without this, the profile-override comment on
            # line 1 of nearly every fixture was linted as a real sentence.
            last_plain_lineno = None
            continue
        if in_fence or not stripped:
            last_plain_lineno = None
            continue
        masked = mask_line(raw_line)
        if HEADING_RE.match(masked):
            last_plain_lineno = None
            yield lineno, "fragment", HEADING_RE.sub("", masked), None
            continue
        if TABLE_ROW_RE.match(masked):
            last_plain_lineno = None
            if TABLE_SEP_RE.match(masked):
                continue
            cells = masked.strip().strip("|").split("|")
            for cell in cells:
                yield lineno, "fragment", cell, None
            continue
        if LIST_MARKER_RE.match(masked):
            last_plain_lineno = None
            marker_len = len(LIST_MARKER_RE.match(masked).group(0))
            paragraph_id += 1
            yield lineno, "sentence", (" " * marker_len) + masked[marker_len:], paragraph_id
            continue
        if last_plain_lineno != lineno - 1:
            paragraph_id += 1
        last_plain_lineno = lineno
        yield lineno, "sentence", masked, paragraph_id


# ---------------------------------------------------------------------------
# Sentence splitting (spec §7.5) -- protect known abbreviations, decimals,
# version numbers by placeholder substitution before splitting.
# ---------------------------------------------------------------------------

PROTECTED_ABBR = ["e.g.", "i.e.", "vs.", "Fig.", "No."]
DECIMAL_RE = re.compile(r"\d+\.\d+")


def split_sentences(text):
    """Return list of (start_offset, sentence_text) within `text`."""
    placeholders = {}
    protected = text
    for idx, abbr in enumerate(PROTECTED_ABBR):
        token = "\x00A{}\x00".format(idx)
        if abbr in protected:
            protected = protected.replace(abbr, token)
            placeholders[token] = abbr

    def protect_decimal(m):
        token = "\x00D{}\x00".format(len(placeholders))
        placeholders[token] = m.group(0)
        return token

    protected = DECIMAL_RE.sub(protect_decimal, protected)

    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9`])", protected)
    results = []
    cursor = 0
    for part in parts:
        restored = part
        for token, orig in placeholders.items():
            restored = restored.replace(token, orig)
        start = text.find(restored, cursor)
        if start == -1:
            start = cursor
        results.append((start, restored))
        cursor = start + len(restored)
    return results


# ---------------------------------------------------------------------------
# Word/phrase alternation matching
# ---------------------------------------------------------------------------

def compile_alternation(patterns):
    escaped = sorted({p for p in patterns if p}, key=len, reverse=True)
    if not escaped:
        return None
    body = "|".join(re.escape(p) for p in escaped)
    return re.compile(r"(?<![A-Za-z0-9_])(" + body + r")(?![A-Za-z0-9_])", re.IGNORECASE)


def word_count(text):
    return len(re.findall(r"\S+", text))
