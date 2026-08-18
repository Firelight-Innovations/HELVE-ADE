"""File discovery, profile detection, and the ARI readability metric."""
import fnmatch
import re
from pathlib import Path

from .paths import ROOT

PROFILE_COMMENT_RE = re.compile(r"^\s*<!--\s*lint-profile:\s*(\w+)\s*-->")


def detect_profile(rel_path_posix, config, override_first_line=None, cli_profile=None):
    if cli_profile:
        return cli_profile
    if override_first_line:
        m = PROFILE_COMMENT_RE.match(override_first_line)
        if m and m.group(1) in config["profiles"]:
            return m.group(1)
    for name in config["profile_order"]:
        for glob in config["profiles"][name]["path_globs"]:
            if fnmatch.fnmatch(rel_path_posix, glob):
                return name
    return "prose"


def is_never_lint(rel_path_posix, config):
    for prefix in config["never_lint"]:
        if rel_path_posix.startswith(prefix):
            return True
    return False


def discover_files(paths, config):
    # never_lint governs automatic discovery (directory walks, whole-project
    # scans) -- it must NOT silently swallow a file the caller named
    # explicitly. Without this split, the test harness could never point
    # ste_lint.py at tools/tests/corpus_dirty/ (which is in never_lint on
    # purpose, so normal project-wide runs skip its deliberate violations).
    explicit_files = []
    walked = []
    if paths:
        for p in paths:
            pp = Path(p)
            if pp.is_dir():
                walked.extend(sorted(pp.rglob("*.md")))
                walked.extend(sorted(pp.rglob("*.csv")))
            else:
                explicit_files.append(pp)
    else:
        walked.extend(sorted(ROOT.rglob("*.md")))
        walked.extend(sorted(ROOT.rglob("*.csv")))

    result = []
    for t in explicit_files:
        abs_path = t.resolve()
        try:
            rel = abs_path.relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(abs_path)
        result.append((rel, abs_path))
    for t in walked:
        abs_path = t.resolve()
        try:
            rel = abs_path.relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(abs_path)
        if is_never_lint(rel, config):
            continue
        result.append((rel, abs_path))
    seen = set()
    deduped = []
    for rel, abs_path in sorted(result, key=lambda x: x[0]):
        if rel not in seen:
            seen.add(rel)
            deduped.append((rel, abs_path))
    return deduped


def ari_grade(text):
    words = re.findall(r"\S+", text)
    letters = sum(len(re.sub(r"[^A-Za-z]", "", w)) for w in words)
    sentence_count = max(1, len(re.findall(r"[.!?]", text)))
    word_n = max(1, len(words))
    return 4.71 * (letters / word_n) + 0.5 * (word_n / sentence_count) - 21.43
