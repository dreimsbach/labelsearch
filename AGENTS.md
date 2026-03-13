# AGENTS.md

Repository-level working agreement for future changes.

## Always-on Maintenance Rules

When implementing any feature, bugfix, refactor, or behavior change in this repo, always do all of the following in the same change set:

1. Update `docs/SPEC.md`
- Reflect new behavior, API contracts, data flow, constraints, and any changed rules.
- If the change affects matching logic, sources, persistence, UX states, or deployment, update the relevant sections explicitly.
- Add an entry to the SPEC changelog section.

2. Update `README.md`
- Keep setup/run/test/deploy instructions accurate.
- Update feature list and usage notes if user-facing behavior changed.
- Add an entry to the README changelog section.

3. Keep container/deployment files in sync when runtime/build behavior changes
- Update `Dockerfile` and/or `docker-compose.yml` whenever changes affect build output, runtime entrypoint, env vars, exposed ports, or required files.
- Ensure docs mention these deployment changes.

4. Verify before finishing
- Run at least: `npm run check`, `npm run build`.
- Run tests (`npm run test`) when logic changed.
- If Docker-related files changed, validate container build/run path when environment permits.

## Scope

These rules apply by default to every future task in this repository unless the user explicitly says to skip documentation or deployment updates for that specific task.
