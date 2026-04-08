# Conventions

- no "best effort" logic beside e.g. cleanups routines, everything else is considered core business logic and throwing error is the correct thing to do
- use Bun as package manager/test suite/build/etc
- never use 'new Date()' APIs, only Temporal polyfill allowed
- changes can't be considered complete unless `bun validate` and `bun test` run successfully and without warnings
- integration tests in `tests/integration.test.ts` are auto-skipped unless `FREESTYLE_API_KEY` is set; run `bun test:all` (or `bun test:integration`) with the env var to include them
