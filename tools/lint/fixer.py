"""--fix: apply unambiguous T1 substitutions in place."""
from .masking import FENCE_RE, mask_line


def apply_fix(abs_path, engine):
    text = abs_path.read_text(encoding="utf-8")
    if not engine.t1_regex:
        return 0

    def repl(m):
        rule = engine.t1_rules.get(m.group(1).lower())
        if not rule or len(rule.get("alts", [])) != 1:
            return m.group(0)  # ambiguous (multiple alts) -- never auto-fix
        suggestion = rule["suggestion"]
        if m.group(1)[0].isupper():
            suggestion = suggestion[:1].upper() + suggestion[1:]
        return suggestion

    # Only fix outside fenced/inline code -- reuse the masked-line scan to
    # decide which lines are eligible, but write back against the real text.
    lines = text.split("\n")
    in_fence = False
    changed = False
    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        masked = mask_line(line)
        if masked != line:
            continue  # line has inline code/links; skip to avoid corrupting spans
        new_line = engine.t1_regex.sub(repl, line)
        if new_line != line:
            lines[i] = new_line
            changed = True
    if changed:
        abs_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return 1 if changed else 0
