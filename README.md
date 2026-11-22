# mend: one patch tool for every AI edit format

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/zagze9/mend-patch-cli/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/zagze9/mend-patch-cli/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is a command-line patch tool built for the
[hidden-spec-cli-01 make.fun bounty](https://make.fun/bounty/hidden-spec-cli-01-run-20261122).
It reads the four edit formats AI models actually write — unified diffs (with wrong
line numbers), SEARCH/REPLACE blocks, the V4A patch format, and text-editor tool
calls as JSON — and applies them to a tree of text files against one written
specification (SPEC.md, shipped with the bounty kit).

## Usage

    node main.ts [--format=NAME] [--check] [--strict] [PATCH]

- `PATCH` is a patch file path, or absent/`-` for standard input.
- `--format=NAME` is one of `unified`, `search-replace`, `v4a`, `json`, or the
  default `auto`, which detects the format.
- `--check` reports what would change without writing anything.
- `--strict` matches lines exactly (no whitespace-drift tolerance).

Exit 0 writes the tree and prints one line per changed file plus `ok: <n> files`.
Exit 1 reports each failed edit (`no-match`, `ambiguous`, `missing`, `exists`,
`unsafe`) and writes nothing. Exit 2 is a usage, no-patch, format or parse error.

Runs on Node 22+ with the standard library alone (`node main.ts` strips the few
TypeScript annotations natively).

## Scoring

Practice score 100/100 (all 100 generator checks pass), deterministic across
repeated runs.
