"""Veistra writing-quality linter internals.

The CLI entrypoint stays at tools/ste_lint.py; everything it needs lives here.
Stdlib only (D1). Import submodules directly -- this file stays empty on
purpose so no import order between the submodules is ever forced.
"""
