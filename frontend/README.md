# Agentix Dashboard

The dashboard is a source-backed vanilla web app.

- `src/` contains the editable dashboard source.
- `dist/` is the generated static output served by `agentix dashboard` and `agentix server`.
- `npm run build` runs TypeScript compilation and then copies `frontend/src` to `frontend/dist`.
- `npm run build:frontend` rebuilds only the dashboard static assets.

The UI intentionally stays dependency-free so the published CLI can serve the dashboard without a separate frontend install step.
