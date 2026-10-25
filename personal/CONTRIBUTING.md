# Working on the personal fork

`Danrozen87/berd` is our product branch; `block/berd` supplies upstream changes.
Keep fixes small enough to review and remove when upstream provides the same
behavior. Do not mix an upstream sync with product changes.

## Clone setup

After cloning `Danrozen87/berd`, fetch the upstream baseline used by local checks:

```bash
git remote add upstream https://github.com/block/berd.git
git fetch upstream main
just setup
just dev
```

If the `upstream` remote already exists, skip the `git remote add` command.

## Daily checks

`npm run dev`, `pnpm dev`, and `just dev` run the personal function gate before
starting development. `npm run lint` includes it. Installed Lefthook hooks check
the staged source before a commit and the branch before a push, alongside the
existing frontend, native, and formatting gates. Run `just ci` for packaging or
broad changes. Hooks are local checks; their installation is part of setup.

The function gate uses the installed Biome and adds no dependency. Production
JavaScript and TypeScript functions have these initial limits:

- 80 nonblank body lines, including comments.
- Cognitive complexity 15.
- Five parameters.

Existing debt is compared with Git, not stored in an exclusion list. For each
changed file and rule, the number of violations and their sorted scores may
stay level or shrink. New files must meet every limit. Commits read the Git
index so unstaged fixes cannot hide staged failures. Development and push
checks compare the branch with its merge base against `upstream/main`.
Generated SDK code and test fixtures use their existing checks. Rust retains
rustfmt and Clippy; function responsibility and size also require code review.

The numbers are guardrails, not a reason to hide logic, compress lines, split
functions arbitrarily, or move debt between files. Review must still reject a
new oversized function that trades against unrelated debt in the same file.

## Code review

Find and reuse the existing component, hook, service, token, or feature before
adding another. Keep dependencies flowing through the established layers; do
not duplicate state or create parallel implementations. Explain each new
runtime dependency, its cost, and who maintains it. Keep names and terminology
consistent. Code and developer docs use clear English; product copy follows
the existing i18n workflow.

Check keyboard use, focus, contrast, and reduced motion when changing UI.
Measure startup, streaming, scrolling, memory, or bundle cost when the change
affects them. Record the scenario, build type, and result. No static lint rule
can establish reuse, good architecture, accessibility, or faster interaction;
these remain explicit review criteria.

## Writing

Use [Wikipedia's Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
as an editorial reference. It describes patterns, not proof of authorship.
Apply this guidance to READMEs, docs, contributions, comments, and change notes:

- State the behavior or claim directly. Name the command, condition, or example.
- Remove inflated importance, promotional claims, vague attribution, and filler.
- Avoid canned contrasts, repetitive summaries, ornamental headings, and forced
  three-part lists. Use the structure the material needs.
- Support factual claims with checked sources or observed results. Never invent
  measurements, references, compatibility claims, or checks that were not run.
- Keep terms stable and sentences plain. Use formatting to help a reader act.

Review meaning and accuracy first. Do not add an AI detector or a banned-word
filter; a matching phrase alone does not make prose poor.
