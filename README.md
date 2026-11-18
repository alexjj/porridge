# porridge

An outliner-based daily blogging platform. Content is OPML in a git repo; the editor is a static web app and the site is built by GitHub Actions.

- [Build plan](docs/PLAN.md)
- [File format](docs/format.md)
- [Starter blog repo](template/)

## Layout

```
packages/core    OPML model, site loader and HTML/RSS renderers (shared with the editor)
packages/build   the `porridge build` command line tool
action.yml       GitHub Action that runs the bundled build (dist/porridge.mjs)
template/        starter content repo for a new blog
fixtures/        test content; fixtures/expected holds the golden output
```

## Development

Needs Node 20 or later.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Build the sample blog and preview it at http://localhost:8080:

```bash
npm run sample
```

```bash
python3 -m http.server 8080 -d out/sample
```

After an intended change to the HTML output, update the golden files and review the diff:

```bash
npm test -- -u
```

`dist/porridge.mjs` is what the GitHub Action runs, so rebuild and commit it whenever the build code changes (CI checks this):

```bash
npm run bundle
```
