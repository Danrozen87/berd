# AGENTS.md

Guidelines for agents working on Berd.

Berd is a standalone Tauri 2 + React 19 desktop. ACP is the main interface
we use for the actual agent loop - creating and running sessions, finding available
models, and setting configuration. When available, we work over ACP methods, but the
UI can handle operations that are not yet in ACP or are client specific.

## Layout

- `src/` — React UI/features/shared code
- `src-tauri/` — Tauri shell that starts or resolves `goose serve`
- `sdk/` — vendored `@aaif/goose-sdk` package and generated ACP types
- `distro/` — bundled app defaults and packaged distribution assets
- `goose-backend.lock.json` — pinned upstream Goose backend used by dev and bundles
- `acp-tools.lock.json` — release-controlled `package.json` + `package-lock.json`
  the managed ACP bridges are installed from with `npm ci`
- `scripts/ensure-local-goose.sh` — managed local Goose checkout for dev
- `scripts/prepare-goose-sidecar.sh` — stages the pinned or explicit Goose binary for Tauri bundling
- `scripts/update-goose-backend-lock.sh` — resolves and records a new Goose backend pin
- `scripts/update-acp-tools-lock.mjs` — resolves and records a new managed ACP bridge pin
- `src/features/berdctl/` — berdctl command registry
- `src-tauri/plugins/berdctl/` — berdctl broker
- `src-tauri/crates/berdctl/` — bundled berdctl CLI
- `distro/skills/berd-help/references/berdctl.md` — berdctl guidance agents
  read from the bundled `berd-help` skill

## Architectural laws

`LAWS/` defines required product and user experience behavior. Before planning,
implementing, or reviewing behavior changes, read `LAWS/README.md` and every
law file relevant to the affected behavior. Laws take correctness precedence
over the current code and tests; when they disagree, change the implementation
and tests or explicitly propose a product-approved law change.

## Startup assets

Startup artifact media is resolved by the Tauri backend and returned as local
cache paths. Renderer code should use `getArtifacts()` or
`selectProjectPreviewArtifacts()` from `src/shared/api/artifacts.ts`, then pass
paths through `convertFileSrc(..., "asset")` before rendering media. Do not
vendor startup media, fetch catalogs in the renderer, or construct CDN
URLs in UI code.

## Experimental features

Experiments are opt-in, user-local switches for in-progress UI or workflow
behavior. Use `.agents/skills/experimental-features/SKILL.md` before adding,
reviewing, graduating, or removing an experiment.

Do not create one-off localStorage keys, distro flags, Tauri commands, or
capabilities for per-user experiments unless the skill says the use case
requires it.

## Common commands

- `just setup` — install pnpm deps, build SDK, build managed local Goose
- `just dev` — run the Tauri app in dev mode
- `just fmt` — format frontend and Tauri/Rust files
- `just fmt-check` — check frontend and Tauri/Rust formatting
- `just lint` — Biome lint checks
- `just typecheck` — TypeScript type checks
- `just check` — frontend formatting/lint/i18n/type checks
- `just test` — Vitest suite
- `just tauri-check` — Rust check with external sidecars disabled
- `just clippy` — Rust clippy with warnings denied
- `just ci` — local validation gate: frontend checks, Tauri/Rust checks, clippy, tests, build
- `just bundle` — stage the pinned Goose backend and run `pnpm tauri build`

## When to validate

- Frontend changes: `just check`
- Vitest-covered behavior: `just test`
- `src-tauri/`, Tauri config, sidecars, or Rust: `just tauri-check`
- berdctl commands: `pnpm generate:berdctl-contract`, `pnpm vitest run
  src/features/berdctl`, and `cargo test -p berdctl` (from `src-tauri/`)
- Broad/release/packaging changes: `just ci`

## berdctl

berdctl lets agents control the app: CLI → broker → renderer registry.
Design and reasoning: `docs/berdctl-architecture.md`. To add or change a
command, use `.agents/skills/berdctl-new-command/SKILL.md`
(`just new-command <noun> <verb>`).

Invariants (1, 3, 4 are gated by test failures; 2, 5, 6 are review rules —
the doc has the whys and the enforcement map):

1. No command-specific knowledge below the renderer registry — the broker
   stays transport-only (single reviewed exception: the create-cap's
   `action == "create"` peek).
2. Single dispatch point in the renderer.
3. Bounds live in zod; clap only mirrors them.
4. Help is hand-authored in the command module (summary, description,
   helpFooter, `.describe()` per field); `cargo test -p berdctl` fails on
   empty/TODO prose.
5. UI-visible verbs only; prefer reversible mutations, but one-way visible
   product actions like creating a session or sending a prompt are allowed.
   Delete, bulk, silent, or invisible work reopens the auth decision as a
   design review, not a PR.
6. Reviewers identify breaking wire reshapes and bump `protocolVersion` in
   both discovery.rs copies and the contract.ts mirror; tests pin only that
   the constants are equal.

The CLI is built from the contract at startup: command modules (zod schemas
+ help prose) → `pnpm generate:berdctl-contract` → `api-surface.json` (the
client-neutral wire surface, with JSON Schema per action) +
`cli-surface.json` (the CLI projection) → embedded by the berdctl crate,
whose `tree.rs` builds the clap tree at runtime (`validate.rs` gates
consistency via the crate's tests). Never hand-edit the contract JSONs.

## Sidecar rule

Release builds should use the Goose backend pinned in `goose-backend.lock.json`:

```bash
just setup
just bundle
```

The Tauri config uses `"externalBin": ["binaries/goosed"]`; the staging script
copies to `src-tauri/binaries/goosed-$(rustc -vV | sed -n 's|host: ||p')`, which
is the filename Tauri expects. Use `GOOSE_BIN=/path/to/goose` only as an explicit
local override.

## Projects

`ProjectInfo.id` is assigned when a project is created and must remain
stable. Renaming a project updates only its display name; sessions, chat
groups, and other persisted references continue to use the original id.

## Conventions

- Use `@/` imports for frontend code.
- Use `cn()` from `@/shared/lib/cn` for Tailwind class merging.
- All `<button>` elements need `type="button"` unless intentionally submitting.
- Do not hand-edit generated SDK files unless this repo intentionally freezes a
  generated snapshot; prefer updating `sdk/schema/*` and regenerating.

## Personal fork engineering

This checkout serves `Danrozen87/berd`; `block/berd` remains upstream. Keep
personal distribution identity and build settings under `personal/` so shared
upstream mechanics remain reusable. The daily macOS build entrypoint is
`bash personal/build-macos.sh`; it builds the pinned backend and disables updates.

- Make one focused, reviewable change at a time, with a concrete user outcome.
  Avoid unrelated cleanup, broad rewrites, and repository-wide formatting.
- Before adding UI, logic, or a dependency, find the existing shared component,
  hook, service, token, or upstream feature and reuse or extend it. Do not fork
  an existing implementation merely to customize its presentation.
- Keep functions responsible for one operation; separate side effects from
  calculations, make inputs and error paths explicit, and avoid nesting that
  hides control flow. Extract helpers when they clarify a real responsibility;
  do not add speculative abstractions or duplicate state.
- Use the existing Biome, TypeScript, design-system, Rust formatting, and Clippy
  gates. Do not add a second linter or weaken rules to make a patch pass. New
  suppressions require a local explanation and a narrowly scoped exception.
  When tightening a rule, assess existing violations and enforce it deliberately.
- Add dependencies only with a concrete need that existing code or platform APIs
  cannot reasonably meet. Record bundle/runtime cost, cross-platform impact,
  maintenance ownership, and why reuse is insufficient. Prefer removing unused
  code and dependencies when the focused change makes that safe.
- Preserve accessibility, keyboard interaction, reduced motion, and semantic
  tokens when changing shared UI. Measure performance changes in the affected
  flow; do not infer improvement from a code-size reduction alone.
- Validate the changed behavior and relevant repository gates. Report baseline
  failures separately, fix regressions caused by the patch, and never claim a
  check passed when it was skipped. Avoid tests that only mirror implementation.
- Keep upstream syncs separate from product changes. Favor small additive patches
  with clear ownership and removal criteria over parallel implementations. Do
  not silently update backend pins or reuse a binary from a different pin.

Personal development, lint, commit, and push gates are documented in
`personal/CONTRIBUTING.md`. Its writing guidance applies to READMEs, docs,
contribution guides, comments, and change notes. Keep those checks wired into
the existing workflow; review reuse, architecture, performance, and prose as
well as the measurable function limits.
