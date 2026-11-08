# Contributing

See [`docs/architecture.md`](docs/architecture.md) for engine internals and
[`docs/integration.md`](docs/integration.md) for consuming the packages.

## Quick reference

```bash
corepack enable && pnpm install
pnpm gen:fixtures     # once, on a fresh clone
pnpm build            # build packages/* (the demo consumes dist/)
pnpm test             # vitest
pnpm typecheck        # tsc -b --force
pnpm lint
pnpm --filter @pore/demo e2e:install   # once
pnpm --filter @pore/demo e2e
```

## Commits

Conventional Commits, enforced by `commitlint`. House style:
`type(scope): <TASK-CODE> — <description>` (e.g. `feat(core): H2 — host-app example`).
Scopes: `core`, `react`, `demo`, `docs`. **One author per commit — the
repository owner.**

## Versioning & releases

`porejs` and `porejs-react` are published to npm and versioned with
[Changesets](https://github.com/changesets/changesets), **fixed together** (one
version). `@pore/demo` is private and never published.

When a change affects a published package's behaviour or API:

```bash
pnpm changeset      # pick the packages, a bump type, write a summary
```

Commit the generated `.changeset/*.md`. The release workflow (H8) opens a
"Version Packages" PR that runs `changeset version`; merging it publishes with
provenance and tags the repo.

Docs / tests / CI / demo-only changes don't need a changeset.

## Milestones

See `docs/*-plan.md`. Update the relevant plan in the same commit that
completes a plan item.
