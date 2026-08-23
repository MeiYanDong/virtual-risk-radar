# Generated schemas

Unprefixed schemas are the active v0.3 two-source contract. Files prefixed with
`legacy-v0.2-` preserve validation support for historical fixtures and code only;
they are not reachable from the v0.3 runtime composition root.

Run `pnpm schema:generate` after a schema change and `pnpm schema:check` to reject
missing, stale, or unexpectedly named generated contracts.
