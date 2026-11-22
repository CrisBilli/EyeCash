# Contributing to EyeCash

Thanks for wanting to help! EyeCash is a small project with a few strong rules, so please read this before opening a pull request.

## The rules that never bend

1. **Privacy first.** No feature may send balances, account names, transaction lists or amounts off the device, unless the user explicitly asks for it for that one action. New AI features must send the minimum, go through `anon()`, have a switch in *Settings → Privacy* and be logged.
2. **No runtime dependencies.** Server: Node.js built-ins only. Client: the browser only, no frameworks, no CDN.
3. **No build step.** Files in `public/` are served as they are.
4. **Never commit real financial data.** Not in tests, fixtures, screenshots or issues. Use invented names, IBANs like `IT60X0542811101000000123456` and the demo data (*Impostazioni → Carica dati di esempio*).

## Getting started

```bash
git clone https://github.com/CrisBilli/eyecash.git && cd eyecash
node server.js                      # http://127.0.0.1:8080, data in ./data
```

Node.js **22.5+** is required (for `node:sqlite`).

## Code layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full map. In short:
- `public/js/*.js`: client, plain scripts sharing the global scope, loaded in the order listed in `public/index.html`. Add a new file to that list **and** to `SHELL` in `public/sw.js` (offline cache).
- `public/engine.js`: pure functions, used by both client and server. Put calculations here when you can, and unit-test them.
- `server/*.js`: CommonJS modules; `server.js` is only the entry point.

## Style

- Formatting: [Prettier](https://prettier.io) with `.prettierrc.json` (`npx prettier --write .`).
- Lint: `npm i --no-save eslint@10 && node tools/lint.js` catches undefined names, unused and unreachable code. CI runs it on every pull request.
- Buttons: add a handler to the `ACTIONS` table in `public/js/events.js` and give the element `data-act="name"`.
- Every file starts with a short header saying what it is for; public or non-obvious functions get a `/** … */` comment.
- The user interface is in Italian for now. Code, comments and documentation are in English; some older inline comments are still in Italian, and translating them is a welcome contribution.
- Escape every user-provided value with `esc()` when building HTML.

## Tests

```bash
# server, engine, local AI provider (no dependencies)
node --test tests/engine.test.js tests/api.test.js tests/local-ai.test.js

# browser end-to-end (Python + Playwright + Chrome)
node tests/mock_ai.js & node tests/mock_quotes.js &
# start the server against the mocks, see the header of each tests/e2e_*.py
python3 tests/e2e_browser.py

# or everything at once
bash tests/run-all.sh
```

Please add tests with your change: a unit test for calculations, an API test for server routes, an e2e check for UI flows.

## Pull requests

- One topic per pull request, with a clear description of what changes for the user.
- Update `CHANGELOG.md` (in Italian, like the app) and the docs when behaviour changes.
- Screenshots for UI changes, made with demo data.
- CI must pass.

## Good first contributions

- English translation of the interface
- Import presets for more banks (with synthetic sample files)
- Translating the remaining Italian code comments
- Accessibility improvements

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
