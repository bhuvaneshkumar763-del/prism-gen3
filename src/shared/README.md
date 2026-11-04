# `src/shared/`

Types, schemas and pure helpers used by `src/engine/`, `src/platform/`,
`entrypoints/` and `components/`. Same purity rule as `src/engine/` — no
`chrome`/`browser` imports here either (CI checks both folders with
`scripts/check-engine-purity.mjs`).

Imports run both ways between `src/shared/` and `src/engine/`, and that is
allowed because both are pure:

- The engine imports small leaf helpers from here (`languages`, `result`,
  `text`, `withTimeout`, `config/listMutations`). These must not import
  anything from `src/engine/`, so there is no import cycle.
- A few UI view-model modules here (`pageStatus`, `popupView`,
  `translationTest`, `config/providerSetup`) import engine types and error
  wording. The engine must never import these.
