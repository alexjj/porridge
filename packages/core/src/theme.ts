// The default theme: one stylesheet, readable typography, light and dark, and
// one small script (images open in a lightbox).

/** Images in posts and pages open full size in a lightbox. Plain ES5, no dependencies. */
export const SCRIPT = `// Made by porridge: images open full size when clicked.
(function () {
  var box;
  function open(img) {
    if (!box) {
      box = document.createElement("dialog");
      box.className = "lightbox";
      box.setAttribute("aria-label", "Image");
      box.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>' +
        '<button type="button" class="lightbox-close" aria-label="Close">\\u00d7</button>';
      box.addEventListener("click", function () { box.close(); });
      document.body.appendChild(box);
    }
    var big = box.querySelector("img");
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    var caption = box.querySelector("figcaption");
    caption.textContent = img.alt;
    caption.hidden = !img.alt;
    box.showModal();
  }
  var images = document.querySelectorAll("main img");
  for (var i = 0; i < images.length; i++) {
    (function (img) {
      if (img.closest("a")) return; // an image that's a link keeps its link
      img.classList.add("zoomable");
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", (img.alt ? img.alt + ": " : "") + "open full size");
      img.addEventListener("click", function () { open(img); });
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img); }
      });
    })(images[i]);
  }
})();
`;

export const STYLESHEET = `:root {
  --bg: #fbfaf6;
  --text: #24221e;
  --muted: #7a756c;
  --rule: #e6e1d6;
  --link: #8a4b1f;
  --link-hover: #5e3110;
  --serif: "Iowan Old Style", "Charter", "Sitka Text", Cambria, Georgia, serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1b18;
    --text: #e9e5dc;
    --muted: #9b958a;
    --rule: #34322d;
    --link: #e0a46e;
    --link-hover: #f3c79c;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 1.125rem/1.65 var(--serif);
}
.site-header, main, .site-footer {
  max-width: 38rem;
  margin: 0 auto;
  padding: 0 1rem;
}
a { color: var(--link); text-underline-offset: 0.15em; }
a:hover { color: var(--link-hover); }
img { max-width: 100%; height: auto; border-radius: 4px; }
/* An image with a description: the description is a caption underneath. */
.figure { display: block; margin: 0.5rem 0; text-align: center; }
.figure img { display: block; margin: 0 auto; }
.caption { display: block; margin-top: 0.4rem; color: var(--muted); font-size: 0.88em; line-height: 1.4; }
/* A post that starts with an image: its "#" sits just before the caption. */
.caption-line { display: block; margin-top: 0.4rem; text-align: center; color: var(--muted); font-size: 0.88em; line-height: 1.4; }
.caption-line .caption { display: inline; margin: 0; font-size: inherit; }
.caption-line .permalink { position: static; display: inline; margin-right: 0.35em; }

/* Quotations: a line starting with ">", its source on the lines under it. */
.quote { margin: 1.25rem 0; padding: 0.15rem 0 0.15rem 1.25rem; border-left: 3px solid var(--link); }
.entry > .quote:first-child { margin-top: 0; }
.quote p { margin: 0; font-size: 1.12em; font-style: italic; line-height: 1.55; }
.quote footer { margin-top: 0.5rem; font-family: var(--sans); font-size: 0.88rem; color: var(--muted); }
.quote footer::before { content: "\\2014\\00a0"; }
.quote cite { font-style: normal; }
.quote cite a { color: var(--muted); }

/* YouTube videos: a line that's just a YouTube address. */
/* A 16:9 box the full width of the column (padding sizes it, which works in
   every browser), with the player filling it. */
.video { position: relative; display: block; width: 100%; height: 0; padding-top: 56.25%; margin: 0.5rem 0; overflow: hidden; border-radius: 6px; background: var(--rule); }
.video iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

/* Lightbox: an image opened full size. */
img.zoomable { cursor: zoom-in; }
img.zoomable:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; }
.lightbox { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; }
.lightbox::backdrop { background: rgb(0 0 0 / 0.94); }
.lightbox figure { box-sizing: border-box; height: 100%; margin: 0; padding: 1rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; cursor: zoom-out; }
.lightbox img { max-width: 100%; max-height: calc(100% - 3rem); object-fit: contain; border-radius: 4px; }
.lightbox figcaption { color: #e9e5dc; font-family: var(--sans); font-size: 0.95rem; text-align: center; }
.lightbox-close { position: fixed; top: 0.5rem; right: 0.75rem; padding: 0.25rem 0.5rem; border: 0; background: none; color: #fff; font-size: 2rem; line-height: 1; cursor: pointer; }

.site-header { padding-top: 2.5rem; padding-bottom: 1rem; font-family: var(--sans); }
.site-title { font-size: 1.35rem; font-weight: 700; color: var(--text); text-decoration: none; }
/* Title on the left, navigation on the right, on one line (wrapping under the
   title when there isn't room). */
.site-bar { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.5rem 1.5rem; }
.site-description { margin: 0.2rem 0 0; color: var(--muted); font-size: 0.95rem; }
.site-nav { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 1rem; font-size: 0.95rem; }
.site-nav .search-link { align-self: center; }
.site-nav a { color: var(--muted); text-decoration: none; }
.site-nav a:hover, .site-nav a[aria-current="page"] { color: var(--text); }

.page-title { font-family: var(--sans); font-size: 1.6rem; line-height: 1.25; margin: 1.5rem 0 1rem; }

.day { border-top: 1px solid var(--rule); padding-top: 1.25rem; margin-top: 1.5rem; }
.day-title { font-family: var(--sans); font-size: 0.85rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 0.75rem; }
.day-title a { color: var(--muted); text-decoration: none; }
.day-title a:hover { color: var(--text); }

.entry { position: relative; margin: 0 0 1.5rem; scroll-margin-top: 1rem; }
.entry:target { background: color-mix(in srgb, var(--link) 8%, transparent); border-radius: 4px; box-shadow: 0 0 0 0.5rem color-mix(in srgb, var(--link) 8%, transparent); }
.entry p { margin: 0 0 0.85rem; }
.entry-title { font-family: var(--sans); font-size: 1.2rem; line-height: 1.3; margin: 0 0 0.5rem; }
.entry-title > a:not(.permalink) { color: var(--text); text-decoration: none; }
.entry-title > a:not(.permalink):hover { color: var(--link); }
/* The "#" link: in the margin to the left of the entry, on its first line. */
.permalink { position: absolute; left: -1.35rem; width: 1rem; text-align: center; color: var(--muted); opacity: 0.55; text-decoration: none; font-family: var(--sans); font-weight: 400; }
.entry:hover .permalink, .entry:target .permalink, .permalink:focus-visible { opacity: 1; }
.permalink:hover { color: var(--link); }
/* Narrow screens: widen the left gutter so the "#" fits. */
@media (max-width: 42rem) {
  .site-header, main, .site-footer { padding-left: 1.85rem; }
}

ul { padding-left: 1.4rem; margin: 0 0 0.85rem; }
li { margin: 0.15rem 0; }
li > ul { margin: 0.15rem 0 0; }
code { font-size: 0.88em; background: var(--rule); padding: 0.1em 0.3em; border-radius: 3px; }
mark { background: #f6e3a1; color: inherit; padding: 0 0.15em; }
@media (prefers-color-scheme: dark) { mark { background: #6b5718; } }

.page h2 { font-family: var(--sans); font-size: 1.25rem; margin: 2rem 0 0.5rem; }
.page h3 { font-family: var(--sans); font-size: 1.05rem; margin: 1.5rem 0 0.4rem; }
.page h4 { font-family: var(--sans); font-size: 0.95rem; margin: 1.25rem 0 0.3rem; color: var(--muted); }
.page p { margin: 0 0 0.85rem; }

.calendar { list-style: none; padding: 0; }
.calendar li { margin: 0 0 0.5rem; }
.calendar-month { font-family: var(--sans); font-weight: 600; text-decoration: none; }
.calendar-days a { display: inline-block; min-width: 1.6rem; text-align: center; font-family: var(--sans); font-size: 0.9rem; }

.pager { display: flex; justify-content: space-between; gap: 1rem; margin: 2rem 0; padding-top: 1rem; border-top: 1px solid var(--rule); font-family: var(--sans); font-size: 0.95rem; }
.pager .older { margin-left: auto; text-align: right; }
.empty { color: var(--muted); }

.search-link { display: inline-flex; align-items: center; }
.search-link svg { width: 1.05em; height: 1.05em; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
/* Pagefind's search box and results, in the site's colours and fonts. */
.search .pagefind-ui {
  --pagefind-ui-scale: 0.9;
  --pagefind-ui-primary: var(--link);
  --pagefind-ui-text: var(--text);
  --pagefind-ui-background: var(--bg);
  --pagefind-ui-border: var(--rule);
  --pagefind-ui-tag: var(--rule);
  --pagefind-ui-border-width: 1px;
  --pagefind-ui-border-radius: 6px;
  --pagefind-ui-font: var(--sans);
}
.search .pagefind-ui__search-input { color: var(--text); background: var(--bg); border: 1px solid var(--rule); }
.search .pagefind-ui__search-input::placeholder { color: var(--muted); opacity: 1; }
.search .pagefind-ui__search-clear { color: var(--muted); background: transparent; }
.search .pagefind-ui__result-link { color: var(--text); }
.search .pagefind-ui__result-excerpt { font-family: var(--serif); }
.search mark { background: color-mix(in srgb, var(--link) 22%, transparent); color: inherit; }

.site-footer { margin-top: 3rem; padding-top: 1rem; padding-bottom: 3rem; border-top: 1px solid var(--rule); color: var(--muted); font-family: var(--sans); font-size: 0.85rem; }
.site-footer a { color: var(--muted); }
`;
