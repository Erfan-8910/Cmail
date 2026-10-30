# dist-worker

Build output of `npm run build` (scripts/build-worker.mjs).

`worker.js` here is the **complete application in one file** — the API, the
email handler, the cron job, and every UI asset (HTML/CSS/JS/fonts/icons)
embedded inside it. This is the exact file published on the GitHub Releases
page and the only file you paste into the Cloudflare dashboard editor.

Nothing in this folder is meant to be edited by hand.
