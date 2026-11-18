# My porridge blog

This repo holds a [porridge](https://github.com/alexjj/porridge) blog: the
content is OPML, and GitHub Actions builds it into a static site on GitHub
Pages.

```
blog.opml          blog settings, plus one include per year
blog/2026.opml     this year's posts (new years are added automatically)
pages/about.opml   an About page; add more files here for more pages
images/            uploaded images
```

## Setup

1. Create a repo from this template.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Edit `blog.opml`: set `title`, `ownerName`, `porridge:timezone`, and
   `porridge:baseUrl` to your Pages address
   (`https://YOUR-USERNAME.github.io/YOUR-REPO/`).
4. Push. The **Build blog** workflow publishes the site.

After that, write with the porridge editor. Its **Save** button commits
without rebuilding; **Save & Publish** commits and rebuilds the site.

The file format is documented in
[porridge's format.md](https://github.com/alexjj/porridge/blob/main/docs/format.md).
