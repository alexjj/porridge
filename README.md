# porridge

An outliner-based daily blogging platform. Content is OPML in a git repo; the editor is a static web app and the site is built by GitHub Actions.

- [File format](docs/format.md)
- [Starter blog repo](https://github.com/alexjj/porridge-blog-template) (a copy of [`template/`](template/), kept in sync by `.github/workflows/sync-template.yml`)

## Using the editor

The editor is a static web app. Visit it [here](https://porridge.alexjj.com/), the code is this repo - you could host it yourself if you want. Point it to your github repo that contains your blog's data, the app pushes updates to your repo. Authorisation is done via Github Tokens saved only in your local browser.

## Getting started with a new blog

1. Create your blog repo from [porridge-blog-template](https://github.com/alexjj/porridge-blog-template) and set it up as its README says.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for just that repo, with **Contents** and **Actions** set to read and write.
3. Open the [editor](https://porridge.alexjj.com/), choose **Connect GitHub**, and enter the repo and token. The token is kept only in that browser.

**Save** commits your changes without rebuilding the site; **Publish** commits and rebuilds, and shows when the site is live.

## Layout

```
packages/core    OPML model, site loader and HTML/RSS renderers (shared with the editor)
packages/build   the `porridge build` command line tool
packages/editor  the outliner web app (Svelte + Vite)
action.yml       GitHub Action that runs the bundled build (dist/porridge.mjs)
template/        starter content repo for a new blog (synced to porridge-blog-template)
fixtures/        test content; fixtures/expected holds the golden output
```

## Development

Needs Node 20 or later. Contributing? Read [CLAUDE.md](CLAUDE.md) first: how the pieces fit together, the commands, and the rules that are easy to break.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

Run the editor at http://localhost:5173 (your work is kept in that browser):

```bash
npm run dev
```

Editor end-to-end tests (Playwright, Chromium):

```bash
npm run e2e
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
