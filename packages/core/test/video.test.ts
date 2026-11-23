import { describe, expect, it } from "vitest";
import { createInlineRenderer, parseVideo } from "../src/index.js";

describe("YouTube addresses", () => {
  it.each([
    ["https://youtu.be/C-TY_XSMboY", { id: "C-TY_XSMboY" }],
    ["https://www.youtube.com/watch?v=6NzAn238PPE", { id: "6NzAn238PPE" }],
    ["https://m.youtube.com/watch?v=6NzAn238PPE&t=90", { id: "6NzAn238PPE", start: 90 }],
    ["https://youtu.be/C-TY_XSMboY?t=1m30s", { id: "C-TY_XSMboY", start: 90 }],
    ["https://youtube.com/shorts/C-TY_XSMboY", { id: "C-TY_XSMboY" }],
    ["https://www.youtube.com/live/C-TY_XSMboY?si=abc", { id: "C-TY_XSMboY" }],
    ["https://www.youtube-nocookie.com/embed/C-TY_XSMboY?start=5", { id: "C-TY_XSMboY", start: 5 }],
    ["  <https://youtu.be/C-TY_XSMboY>  ", { id: "C-TY_XSMboY" }],
  ])("%s", (text, video) => {
    expect(parseVideo(text)).toEqual(video);
  });

  it.each([
    "watch this https://youtu.be/C-TY_XSMboY",
    "[a video](https://youtu.be/C-TY_XSMboY)",
    "https://youtu.be/too-short",
    "https://www.youtube.com/channel/UC1234567890",
    "https://vimeo.com/123456",
    "youtu.be/C-TY_XSMboY",
    "",
  ])("not a video: %s", (text) => {
    expect(parseVideo(text)).toBeNull();
  });
});

describe("rendering videos", () => {
  const url = "https://youtu.be/C-TY_XSMboY?t=90";

  it("embeds a privacy-enhanced, lazy player on the site", () => {
    expect(createInlineRenderer("/").html(url)).toBe(
      `<span class="video"><iframe src="https://www.youtube-nocookie.com/embed/C-TY_XSMboY?start=90" width="1280" height="720" title="YouTube video" loading="lazy" ` +
        `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
        `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></span>`,
    );
  });

  it("links a thumbnail in RSS, and shows one in the editor", () => {
    expect(createInlineRenderer("/", "/", "link").html(url)).toBe(
      `<a href="https://www.youtube.com/watch?v=C-TY_XSMboY&amp;t=90s"><img src="https://i.ytimg.com/vi/C-TY_XSMboY/hqdefault.jpg" alt="YouTube video"></a>`,
    );
    expect(createInlineRenderer("/", "/", "thumbnail").html(url)).toContain(`<span class="video-thumb"><img src="https://i.ytimg.com/vi/C-TY_XSMboY/hqdefault.jpg"`);
  });

  it("leaves an address within other text alone", () => {
    expect(createInlineRenderer("/").html("see https://youtu.be/C-TY_XSMboY")).toBe("see https://youtu.be/C-TY_XSMboY");
  });
});
