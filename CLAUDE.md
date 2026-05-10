# CLAUDE.md

Project-specific notes for Claude Code working in this repo.

## Releasing a new version

The pipeline is fully driven by git tags. Pushing a `v*` tag fires
`.github/workflows/publish.yml`, which builds, tests, then publishes to
both **npmjs.com** (with Sigstore provenance via Trusted Publishing)
and **GitHub Packages** (so the package shows up in the repo sidebar),
and finally creates a GitHub Release with auto-generated notes.

### Standard release steps

```bash
# 1. Make sure the working tree is clean and main is up to date.
git status
git pull --ff-only

# 2. Bump the version. This edits package.json, commits, and tags.
npm version patch       # or minor / major
# → creates commit "0.x.y" + tag "v0.x.y"

# 3. Push the commit AND the tag together.
git push --follow-tags
```

That's it — the workflow takes over from here. Watch progress at
<https://github.com/12og3r/open-context-cli/actions>.

### What `npm version patch` actually does

In order: bumps `package.json` version, runs the optional
`preversion` / `version` / `postversion` lifecycle scripts (we have
none), commits with the new version as the message, and tags the commit
`vX.Y.Z`. It refuses to run on a dirty working tree, which is a
deliberate guard against mixing release-only changes with feature work.

### What the workflow does

1. Checkout, install Bun + Node 20, **upgrade npm to latest** (Trusted
   Publishing OIDC exchange needs npm ≥ 11.5.1; the npm bundled with
   Node 20 is too old).
2. `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`.
3. Verify the pushed tag matches `package.json`'s `version` field.
4. `npm publish --provenance --access public` → npmjs.com.
5. Reconfigure `~/.npmrc` to point at `npm.pkg.github.com`, then
   `npm publish --access public` with `GITHUB_TOKEN` → GitHub Packages.
6. `softprops/action-gh-release@v2` → GitHub Release with auto notes.

### Trusted publisher config (one-time setup)

Already configured on npmjs for `@12og3r/openctx`:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Org/user | `12og3r` |
| Repository | `open-context-cli` |
| Workflow filename | `publish.yml` |
| Environment name | (empty) |

If we ever rename the workflow file or the repo, that mapping needs to
be updated on npmjs first, otherwise the OIDC exchange step will 401.

### Recovering from a failed publish

- **Workflow fails before `npm publish`:** safe to retry — fix the
  cause, then re-tag (`git tag -d vX.Y.Z; git push --delete origin
  vX.Y.Z; git tag vX.Y.Z <new-sha>; git push origin vX.Y.Z`) **or**
  bump again to a fresh patch.
- **npmjs publish succeeds, GitHub Packages publish fails:** the npmjs
  release is the canonical one and is already live; just re-run the
  GitHub Packages step (Re-run failed jobs in the Actions UI). Do
  **not** bump the version — npmjs would reject the duplicate.
- **`npm publish` rejects with "version already exists":** never
  re-publish under the same version. Bump and retry.

### Local testing of the version flag

`-v` / `--version` reads from `package.json` via a JSON import. The
bundler inlines the value at build time, so the published `dist/cli.js`
does not touch `package.json` at runtime.

```bash
bun run build
node dist/cli.js --version    # prints the version string
```

## Local development cheatsheet

```bash
bun install
bun run dev          # run the TUI from source
bun test             # 115 tests, fast
bun run typecheck    # tsc --noEmit
bun run build        # bundles to dist/cli.js
```

`dist/` is gitignored — the published bundle is built fresh by the
`prepublishOnly` hook (`bun run build && chmod +x dist/cli.js`) during
`npm publish`. Don't commit `dist/`.

## Settings file location

Lives at `~/openctx/settings.json`. Previously `~/open-ctx/settings.json`,
and before that `~/.context-cli/.settings.json` — if the user mentions
settings disappearing after an upgrade, that's why. Migrate with
`mv ~/open-ctx ~/openctx` (or copy the JSON over).

## PTY runtime selection

The continue-conversation feature picks the PTY library at runtime based
on the JS engine:

- **Node:** `@lydell/node-pty` (regular dependency)
- **Bun:** `bun-pty` (`optionalDependencies` — pulled in only when
  installed under Bun, since `@lydell/node-pty`'s spawn-helper handshake
  hangs under Bun's child-process semantics)

Don't try to unify these into a single library; the runtime split is
load-bearing.
