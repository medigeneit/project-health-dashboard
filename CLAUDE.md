# Project Health Dashboard: rules

## Git
- Commit author and committer must be `msisaif <61042251+msisaif@users.noreply.github.com>`. Use only this name and email.
- Commit messages must not contain attribution lines, such as `Co-Authored-By`, `Claude-Session`, or "Generated with Claude".
- Do not push unless the user says so in that conversation.

## Stack
- Built with Alo (`@msilabs/alo`). Read `AGENTS.md` before editing any `.alo` file.
- Alo only renders the page shell at build time. User data lives in the Adhar backend (`../backend-project-health`, SQLite). The browser never stores data: `PHD.store` (`global/30-store.js`) keeps it in memory only, loads it from `GET /api/data`, and sends every change as `PUT /api/data`. If the server cannot be reached the page stays empty and shows a retry banner; saving is blocked then. Lists, filters and calculations are plain JS. Writes need the admin token, which the user enters in "সেটিংস" (`phd:token`).
- Shared JS is in `global/*.js`, loaded in file-name order on every page. `10`–`40` and `60` must not touch the DOM at load time, because `tests/load.mjs` runs them in Node.
- Scoped `<style>` does not reach HTML built by JS. Put styles for JS-rendered markup in `global/03-ui.css`, using the tokens in `global/02-theme.css`.
- Four pages only, all under the `(app)/` group (the group is not in the URL): dashboard (`/`), `/projects/`, `/upgrades/` (upgrade report, printable via `@media print`), `/catalog/`. `/token/` is the token page (`pages/token/page.alo`). `(app)/layout.alo` redirects to `/token/` when `phd:token` is missing, and logout goes there too. Token is checked by the API: every request sends it, and a 401 means logout (`PHD.api.logout()`). Import, export, settings and AI prompts live in layout components (`ImportDialog`, `SettingsDialog`, `PromptDialog`). The sidebar has only two buttons below the menu: "ডেটা" (`ImportDialog`: import, AI and export tabs) and "সেটিংস" (theme, thresholds, reset); the project panel is `ProjectDrawer` and `QuickSearch` is the ⌘K palette. The topbar has search plus GitHub star and issue links built from `data.site.repo` (so forks point to their own repo); "নতুন প্রজেক্ট" lives in the page heads of the dashboard and `/projects/`. The footer credits msilabs and Alo. Open them with `PHD.ui.openImport()`, `openSettings()`, `showPrompt()`, `openProject(id)`.
- Keep the UI calm: colour only for status, neutral text for healthy parts, no new top-level pages without a strong reason. Rarely used fields go inside a `<details class="fold">`.
- Do not use native `confirm()` or `title` tooltips. Use `PHD.ui.confirm(message, okLabel)` (returns a Promise) and `data-tip="…"`. If an action can be undone with `PHD.ui.undoToast()`, do not ask for confirmation.
- Fonts are self-hosted in `public/fonts/` and declared in `global/02-theme.css`. Do not load fonts or scripts from another origin. The only other origin the app talks to is the API at `PHD.API_URL` (`global/10-core.js`), called with `fetch` and no libraries.
- Theme: tokens in `global/02-theme.css` follow the system by default; `<html data-theme="light|dark">` forces one. The dark tokens are written twice (media query and attribute), so change both. The choice is stored in `localStorage` as `phd:theme` and applied by an inline script in `pages/layout.alo` before first paint.
- In JS, build internal links with `PHD.url('/path/')` so the GitHub Pages base path is added. In templates, write `/path/` and Alo adds the base.
- Escape every user value with `PHD.esc()` before putting it into HTML.

## Data
- The catalog (tech and server products, versions, `requires`) is stored in the backend DB. "সব প্রোডাক্ট হালনাগাদ" calls `POST /api/catalog/refresh`, and the backend fetches endoflife.date itself. Manual entries are kept.
- `public/seed/catalog.json` is only the first-run seed. `npm run seed` in `backend-project-health` loads it with `public/seed/projects.json`. `npm run catalog` still rewrites it, but the DB no longer reads it on load.
- `public/seed/projects.json`: made-up sample projects shown on first visit. Never put real client or repo names here, because the site is public.
- Each tech and stack ref is `{product, version, versions: [{version, date}]}`. `versions` is the source of truth (one per date, sorted; the latest is `version`). The drawer edits it directly; merge-mode import merges lists in `mergeVersions` (same cycle is ignored, a new cycle is added with today's date). Upgrade steps come from consecutive versions in `P.upgradeJourney`.
- `private/` is git-ignored. Keep real data exports there.
- The data shape is defined in `global/20-schema.js` (`schemaVersion` 5; old `project.history` from v3 and v4 is moved into the refs' `versions` by `attachHistory`). If you change it, bump the version and migrate in `normalizeData`.

## Checks
- `npm test` runs the node:test suite in `tests/`.
- `node alo build` must finish without errors.
