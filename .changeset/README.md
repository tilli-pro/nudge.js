# Changesets

Run `pnpm exec changeset` on every pull request that changes the published package. While the package is
0.x: `minor` for a breaking change (its summary carries a migration note) or an addition, `patch` for a fix.
The Release workflow opens the version pull request from the pending changesets; merging that pull request
publishes.
