# Minimal repros: codebase-memory-mcp 0.9.1-rc.1

Self-contained dummy code reproducing findings from running `codebase-memory-mcp`
**0.9.1-rc.1** (standard variant, macOS arm64, GitHub release archive) against a
TypeScript project.

Each case is independent. Nothing here is proprietary code.

## Setup

```bash
git clone https://github.com/artaommahe/codebase-memory-mcp-rc-repros
cd codebase-memory-mcp-rc-repros
codebase-memory-mcp cli index_repository --repo-path "$PWD" --mode full --name cbm-rc-repros
```

> **On the numbers below.** This README is itself indexed, so absolute node/edge
> totals shift by a few whenever it is edited. Where a case depends on a total, it is
> stated *relationally* (e.g. "equals `RETURN count(r)`") rather than as a literal, so
> the repro can't go stale. Roughly: ~44 nodes / ~58 edges, `parse_partial_count: 0`,
> `not_indexed_files_count: 600`.

> The default branch is deliberately **`trunk`**, and there is deliberately **no `main`
> branch** — that is what Case D needs. Keep it that way when cloning.

---

## Case A — cross-file method calls produce no `CALLS` edge

Filed as [#1354](https://github.com/DeusData/codebase-memory-mcp/issues/1354).

`ToastService.openSuccessUniqueXyz` is a uniquely-named method defined in
`src/lib/toast/toast.service.ts`. It is called **seven** times:

- **six times across a file boundary** — five shapes in `src/app/variants.ts` (relative
  import) and one in `src/app/alias-consumer.ts` (via the `@lib/*` tsconfig alias);
- **once from inside its own file** — `sameFileControl()` in `toast.service.ts`, which is
  *character-for-character the same shape as `v2`*.

```bash
codebase-memory-mcp cli trace_path --project cbm-rc-repros \
  --function-name openSuccessUniqueXyz --direction inbound --depth 1
```

```
function: openSuccessUniqueXyz
direction: inbound
callers_total: 1
callers: 1  (rows: name hop; qn = group prefix + "." + name)
cbm-rc-repros.src.lib.toast.toast.service:
  sameFileControl 1
```

**Only the same-file caller is found.** The control is the point of this case — identical
code, one file boundary, and the edge disappears:

| caller | location relative to callee | edge to the method? |
|---|---|---|
| `sameFileControl` | same file | ✅ `lsp_ts_method`, confidence 0.95 |
| `v2` (identical code) | another file | ❌ none |
| `v1`, `v3`, `v4`, `V5.run`, `AliasConsumer.run` | another file | ❌ none |

Every `CALLS` edge in the graph:

```bash
codebase-memory-mcp cli query_graph --project cbm-rc-repros \
  --query "MATCH (a)-[r:CALLS]->(b) RETURN a.file_path AS caller_file, a.name AS caller, b.qualified_name AS callee, r.strategy AS s, r.confidence AS conf, r.line AS line LIMIT 20"
```

```
rows: 7  (cols: caller_file caller callee s conf line)
  src/app/variants.ts constructor …toast.service.ToastService unique_name "0.75" "32"
  src/lib/toast/toast.service.ts sameFileControl …toast.service.ToastService same_module "0.90" "10"
  src/lib/toast/toast.service.ts sameFileControl …toast.service.ToastService.openSuccessUniqueXyz lsp_ts_method "0.95" "11"
  src/app/report.spec.ts src/app/report.spec.ts …report.service.ReportService.describe unique_name "0.75" "9"
  src/app/variants.ts v1 …toast.service.ToastService unique_name "0.75" "8"
  src/app/variants.ts v2 …toast.service.ToastService unique_name "0.75" "13"
  src/app/variants.ts v3 …toast.service.ToastService unique_name "0.75" "19"
```

Cross-file, only the `new ToastService()` *constructor* calls register, via the
`unique_name` heuristic. `v4` (explicitly typed parameter), `V5.run` (typed class field)
and `AliasConsumer.run` produce nothing at all.

Ruled out as explanations: import style (relative and aliased behave identically),
`moduleResolution`/`module`/`include` settings, having `typescript` in `node_modules`,
same-directory vs different-directory imports, and other edge types — no `USAGE`,
`DATA_FLOWS` or `IMPORTS` edge reaches the method either, and `trace_path --mode
data_flow` also returns 0.

## Case B — a test-runner global is bound to a same-named application method

Filed as [#1355](https://github.com/DeusData/codebase-memory-mcp/issues/1355).

`src/app/report.spec.ts` contains only Jest/Jasmine `describe`/`it`/`expect` globals.
`src/app/report.service.ts` happens to define an unrelated method named `describe`.

Row 4 of the Case A output above is the bug:

```
  src/app/report.spec.ts … ReportService.describe unique_name "0.75" "9"
```

Line 9 is the `describe('another suite', ...)` block in the spec file. A test-runner
global has been bound to an application method at confidence 0.75, and `trace_path`
reports it as a caller with no confidence or strategy column:

```bash
codebase-memory-mcp cli trace_path --project cbm-rc-repros \
  --function-name describe --direction inbound --depth 1 --include-tests true
```

## Case C — `index_status` payload is dominated by deliberately-ignored files

Filed as [#1356](https://github.com/DeusData/codebase-memory-mcp/issues/1356).

`assets/icons/` holds 600 `.svg` files, correctly classified as `ignored-suffix`
(by design, not a coverage gap).

```bash
codebase-memory-mcp cli index_status --project cbm-rc-repros | wc -c
```

```
31970      # ~8k tokens of status for a graph of ~44 nodes / ~58 edges
```

500 of the 600 `not_indexed` entries are enumerated inline and **all 500 are `.svg`
assets** — the `not_indexed` block is 31,716 of the 31,970 bytes (99.2%). The cap is
hardcoded (`COVERAGE_FILE_CAP = 500`, `src/mcp/mcp.c`); no flag, config key, env var or
tool profile trims it, and `--verbose` only *adds* a git-context block.

This repo has `parse_partial_count: 0`, so here the payload is ~all by-design entries.
On a large real repo the split is roughly even between by-design `not_indexed` entries
and genuine `parse_partial` gaps — see the issue for measured figures.

A `.cbmignore` containing `assets/icons/` collapses the response to ~495 bytes, because
a directory skip is one row instead of 500 file rows. That is a workaround, not a fix:
it also zeroes the coverage record and cannot help `parse_partial` at all.

## Case D — `detect_changes` silently accepts an unresolvable base ref

Filed as [#1357](https://github.com/DeusData/codebase-memory-mcp/issues/1357).

This repo's default branch is `trunk`; there is no `main`. With a clean tree:

```bash
git rev-parse --abbrev-ref HEAD    # trunk
git rev-parse --verify main        # fatal: Needed a single revision
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

`main` is the schema's documented default (`"base_branch": {"default": "main"}`), but it
is never validated and never falls back — `origin/HEAD` is ignored even when present
(`git remote set-head origin trunk` changes nothing). The same silence applies to an
explicitly passed bad ref:

```bash
codebase-memory-mcp cli detect_changes --project cbm-rc-repros --base-branch zzz-does-not-exist
#   base: zzz-does-not-exist
#   changed_files: 0
```

Note the machine-readable tell: `merge_base` is **present** when the base resolves and
**absent** when it doesn't, though the tool description promises "base + merge_base SHA"
either way. `--base-branch trunk` works correctly.

## Case E — aggregate grouped by `type(r)` / `labels(n)` returns a fabricated row

Filed as [#1358](https://github.com/DeusData/codebase-memory-mcp/issues/1358) — **closed
as a duplicate of the pre-existing [#1292](https://github.com/DeusData/codebase-memory-mcp/issues/1292)**.
Kept here because the repro is small and the workaround is useful.

```bash
codebase-memory-mcp cli query_graph --project cbm-rc-repros \
  --query "MATCH (a)-[r]->(b) RETURN type(r) AS t, count(*) AS c ORDER BY c DESC LIMIT 10"
```

```
rows: 1  (cols: t c)
  "58" "58"
```

One row instead of one per edge type, with the grouping-key column overwritten by the
aggregate. The value equals the graph's total edge count — compare
`MATCH (a)-[r]->(b) RETURN count(r)`. `labels(a)` behaves identically.

Controls, both correct:

```bash
# function key without an aggregate
--query "MATCH (a)-[r]->(b) RETURN type(r) AS t LIMIT 5"

# aggregate grouped by a plain property
--query "MATCH (a)-[r]->(b) RETURN a.name AS n, count(*) AS c ORDER BY c DESC LIMIT 5"
```

**Workaround** — materialise the function value through `WITH` first:

```bash
codebase-memory-mcp cli query_graph --project cbm-rc-repros \
  --query "MATCH (a)-[r]->(b) WITH type(r) AS t RETURN t, count(*) AS c ORDER BY c DESC LIMIT 10"
#   DEFINES 31 / CONTAINS_FILE 7 / CALLS 7 / DEFINES_METHOD 6 / USAGE 3 / …
```

---

## Filed issues

| Case | Issue |
|---|---|
| A — cross-file `CALLS` edges missing | [#1354](https://github.com/DeusData/codebase-memory-mcp/issues/1354) |
| B — same-name misattribution / no confidence in `trace_path` | [#1355](https://github.com/DeusData/codebase-memory-mcp/issues/1355) |
| C — `index_status` payload bloat | [#1356](https://github.com/DeusData/codebase-memory-mcp/issues/1356) |
| D — `detect_changes` unresolvable base | [#1357](https://github.com/DeusData/codebase-memory-mcp/issues/1357) |
| E — `query_graph` aggregate grouping key | [#1358](https://github.com/DeusData/codebase-memory-mcp/issues/1358) (closed, dup of [#1292](https://github.com/DeusData/codebase-memory-mcp/issues/1292)) |
| (no repo needed) `cli` stdin deadlock | [#1359](https://github.com/DeusData/codebase-memory-mcp/issues/1359) |
| (no repo needed) macOS allocator warning | [#1360](https://github.com/DeusData/codebase-memory-mcp/issues/1360) (closed — documented known issue) |
| (no repo needed) `--help` omits `check_index_coverage` | [#1361](https://github.com/DeusData/codebase-memory-mcp/issues/1361) |

## Layout

| Path | Case | Purpose |
|---|---|---|
| `src/lib/toast/toast.service.ts` | A | callee `openSuccessUniqueXyz` **plus the same-file control** |
| `src/lib/toast/index.ts` | A | barrel, reached via the `@lib/*` alias |
| `src/app/variants.ts` | A | five cross-file call shapes (v1–v5) |
| `src/app/alias-consumer.ts` | A | same call through a tsconfig `paths` alias |
| `src/app/report.service.ts` | B | application method named `describe` |
| `src/app/report.spec.ts` | B | Jest/Jasmine `describe()` globals |
| `assets/icons/*.svg` (600) | C | deliberately-ignored files that dominate `index_status` |
| `.gitignore`, `dist/`, `debug.log` | C | gitignored entries |
| branch `trunk`, no `main` | D | default branch that isn't `main` |
