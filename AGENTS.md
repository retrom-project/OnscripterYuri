# Retrom ONScripterYuri fork maintenance rules

This fork builds the ONScripterYuri browser core consumed by
`xxxsen/retrom-runtime`. It must remain independent of Retrom application APIs,
databases, review workflows, credentials, and private game content.

## Repository identity

- `master` is an unmodified, fast-forward-only mirror of `upstream/master`.
- `retrom/0.7.7beta` is the only active Retrom maintenance baseline and the
  repository default branch. Retrom changes and release tags originate there,
  never from `master`.
- `upstream` must point to `https://github.com/YuriSizuku/OnscripterYuri.git`.
- `retrom-fork.json` is the machine-readable baseline and release contract.
  Never replace its upstream tag or commit with a floating branch.
- Updating `master` may only fast-forward it to `upstream/master`. A new fixed
  baseline requires a reviewed `sync/upstream-<tag-or-git-commit>` branch and a
  new `retrom/<baseline>` maintenance branch.

## Branches and commits

- Use short-lived `fix/*`, `feat/*`, `build/*`, or
  `sync/upstream-<baseline>` branches created from `retrom/0.7.7beta`.
- Branch names use lowercase ASCII and hyphens. Do not create `temp`, `clean`,
  `final`, `runtime-clean`, parallel maintenance branches, or branches named
  after an agent or user.
- Keep downstream changes as small reviewable commits and squash or rebase PRs
  onto the maintenance branch; release ancestry must not contain merge commits
  after the fixed upstream baseline.
- Never force-push, move immutable tags, or delete another contributor's work.

## Quality and releases

- Before pushing, run `python3 .github/rpg-runtime/verify-source.py`.
- Changes that affect Web output must also run
  `.github/rpg-runtime/build-web.sh <empty-output-directory>` followed by
  `.github/rpg-runtime/verify-release.py` with a valid candidate identity.
- PRs to `retrom/0.7.7beta` must pass `.github/workflows/rpg-runtime-quality.yml`.
- Release tags are `rpg-runtime-0.7.7beta-rN`, with optional `-rc.N` only for
  integration candidates. Increment `rN` for any source, build, asset, or
  adapter-contract change on this baseline.
- Tags are annotated and immutable. The tag workflow is the only supported way
  to build and publish `onsyuri.js`, `onsyuri.wasm`, `COPYING`, and
  `rpg-runtime-release.json`; never publish aliases such as `latest` or
  `stable`.
- Repository, tag, tag commit, asset filename, and adapter ABI define release
  identity. Observed SHA-256 values are cache-integrity diagnostics only.

Do not add Retrom host-product logic, games, credentials, or private test data.
