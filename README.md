# Minimal repros: codebase-memory-mcp 0.9.1-rc.1

Self-contained dummy code reproducing five findings from running
`codebase-memory-mcp` **0.9.1-rc.1** (standard variant, macOS arm64, GitHub release
archive) against a TypeScript project.

Each case below is independent. Nothing here is proprietary code.

## Setup

```bash
git clone https://github.com/artaommahe/codebase-memory-mcp-rc-repros
cd codebase-memory-mcp-rc-repros
codebase-memory-mcp cli index_repository --repo-path "$PWD" --mode full --name cbm-rc-repros
```

Index result on this repo: **32 nodes / 44 edges**, `parse_partial_count: 0`,
`not_indexed_files_count: 601`.

> The default branch is deliberately **`trunk`**, and there is deliberately **no `main`
> branch** — that is what Case D needs. Keep it that way when cloning.

---

## Case A — cross-file method calls produce no `CALLS` edge

`src/app/variants.ts` and `src/app/alias-consumer.ts` contain **six** calls to
`ToastService.openSuccessUniqueXyz`, a uniquely-named method defined in
`src/lib/toast/toast.service.ts`. Five shapes use a plain relative import; the sixth
uses the `@lib/*` tsconfig `paths` alias.

```bash
codebase-memory-mcp cli trace_path --project cbm-rc-repros \
  --function-name openSuccessUniqueXyz --direction inbound --depth 1
```

```
function: openSuccessUniqueXyz
direction: inbound
callers_total: 0
callers: 0  (rows: name hop; qn = group prefix + "." + name)
```

Expected 6 callers, got 0. Listing every `CALLS` edge in the graph shows why — only
the `new ToastService()` constructor calls are recorded, and even those resolve via
the `unique_name` heuristic rather than the type-aware tier:

```bash
codebase-memory-mcp cli query_graph --project cbm-rc-repros \
  --query "MATCH (a)-[r:CALLS]->(b) RETURN a.file_path AS caller_file, a.name AS caller, b.qualified_name AS callee, r.strategy AS s, r.confidence AS conf, r.line AS line LIMIT 20"
```

```
rows: 5  (cols: caller_file caller callee s conf line)
  src/app/variants.ts constructor cbm-rc-repros.src.lib.toast.toast.service.ToastService unique_name "0.75" "32"
  src/app/report.spec.ts src/app/report.spec.ts cbm-rc-repros.src.app.report.service.ReportService.describe unique_name "0.75" "9"
  src/app/variants.ts v1 cbm-rc-repros.src.lib.toast.toast.service.ToastService unique_name "0.75" "8"
  src/app/variants.ts v2 cbm-rc-repros.src.lib.toast.toast.service.ToastService unique_name "0.75" "13"
  src/app/variants.ts v3 cbm-rc-repros.src.lib.toast.toast.service.ToastService unique_name "0.75" "19"
total: 5
```

`v4`, `V5.run` and `AliasConsumer.run` produce no edges at all. Import style makes no
difference (relative and aliased behave identically), and installing `typescript` into
`node_modules` does not change the result.

## Case B — a test-runner global is bound to a same-named application method

`src/app/report.spec.ts` calls the Jest/Jasmine `describe()` global.
`src/app/report.service.ts` happens to define a method named `describe`.

The second row of the Case A output above is the bug:

```
  src/app/report.spec.ts ... ReportService.describe unique_name "0.75" "9"
```

Line 9 is the `describe('another suite', ...)` block in the spec file. A test-runner
global has been bound to an unrelated application method at confidence 0.75, and
`trace_path` reports it as a caller with no confidence or strategy column:

```bash
codebase-memory-mcp cli trace_path --project cbm-rc-repros \
  --function-name describe --direction inbound --depth 1 --include-tests true
```

## Case C — `index_status` payload is dominated by deliberately-ignored files

`assets/icons/` holds 600 `.svg` files, which the indexer correctly classifies as
`ignored-suffix` (by design, not a gap).

```bash
codebase-memory-mcp cli index_status --project cbm-rc-repros | wc -c
```

```
31968      # ~8k tokens, for a graph of 32 nodes / 44 edges
```

500 of the 601 `not_indexed` entries are enumerated inline, and **all 500 of them are
`.svg` assets**; the `not_indexed` block alone is 33,727 chars of JSON. There is no
parameter to trim or omit the list (`--verbose` only *adds* a git-context block).

On a real ~11.8k-file repo the same call returns **105,771 chars (~26k tokens)**:
54,876 chars enumerating 402 `parse_partial` files, 53,829 chars listing 500
`not_indexed` files of which 494 are `.svg`/`.png` assets.

## Case D — `detect_changes` silently defaults to a `main` branch that does not exist

This repo's default branch is `trunk`; there is no `main`. With a clean tree:

```bash
git rev-parse --abbrev-ref HEAD    # trunk
git rev-parse --verify main        # fails: no such branch
git status --porcelain | wc -l     # 0

codebase-memory-mcp cli detect_changes --project cbm-rc-repros
```

```
base: main
direction: inbound
changed_files: 0
seed_symbols: 0
impacted_total: 0
impacted_shown: 0
impacted: 0
```

It reports `base: main` for a branch that doesn't exist and returns a clean
`changed_files: 0` with no warning — indistinguishable from a correct "nothing
changed" answer. Passing `--base-branch trunk` works correctly.

## Case E — aggregate grouped by `type(r)` / `labels(n)` returns a fabricated row

```bash
codebase-memory-mcp cli query_graph --project cbm-rc-repros \
  --query "MATCH (a)-[r]->(b) RETURN type(r) AS t, count(*) AS c ORDER BY c DESC LIMIT 10"
```

```
rows: 1  (cols: t c)
  "44" "44"
total: 1
```

`44` is the total edge count in the graph. Instead of one row per edge type, a single
row is returned and the grouping-key column has been overwritten with the aggregate
value. `labels(a)` behaves the same way. No error or warning is emitted.

Both controls work correctly:

```bash
# type(r) without an aggregate -> fine
--query "MATCH (a)-[r]->(b) RETURN type(r) AS t LIMIT 5"
#   DEFINES_METHOD / DEFINES_METHOD / ...

# aggregate grouped by a plain property -> fine
--query "MATCH (a)-[r]->(b) RETURN a.name AS n, count(*) AS c ORDER BY c DESC LIMIT 5"
#   variants.ts "8" / alias-consumer.ts "5" / app "4" / ...
```

---

## Layout

| Path | Case | Purpose |
|---|---|---|
| `src/lib/toast/toast.service.ts` | A | `ToastService.openSuccessUniqueXyz`, the cross-file callee |
| `src/lib/toast/index.ts` | A | barrel, reached via the `@lib/*` alias |
| `src/app/variants.ts` | A | five cross-file call shapes (v1–v5) |
| `src/app/alias-consumer.ts` | A | same call through a tsconfig `paths` alias |
| `src/app/report.service.ts` | B | application method named `describe` |
| `src/app/report.spec.ts` | B | Jest/Jasmine `describe()` globals |
| `assets/icons/*.svg` (600) | C | deliberately-ignored files that dominate `index_status` |
| `.gitignore`, `dist/`, `debug.log` | C | gitignored entries |
| branch `trunk`, no `main` | D | default branch that isn't `main` |
