// Turning a picked or pasted file into an image ready to upload, in the browser.

import { extensionFor, keepAsIs, preferOriginal, targetSize, WEBP_QUALITY } from "../model/images.js";

export interface PreparedImage {
  blob: Blob;
  ext: string;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't resize the image."))), type, quality),
  );
}

/**
 * Resize to at most 2000px on the long side and encode as WebP. Browsers that
 * can't make WebP (older Safari hands back a PNG instead) get JPEG.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (keepAsIs(file.type)) {
    return { blob: file, ext: extensionFor(file.type), width: 0, height: 0 };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't read that image. Try a JPEG or PNG.");
  }
  try {
    const size = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    let blob = await toBlob(canvas, "image/webp", WEBP_QUALITY);
    if (blob.type !== "image/webp") {
      // JPEG has no transparency: put transparent images on white.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.width, size.height);
      blob = await toBlob(canvas, "image/jpeg", 0.85);
    }
    if (preferOriginal(file.type, file.size, bitmap.width, bitmap.height, blob.size)) {
      return { blob: file, ext: extensionFor(file.type), width: bitmap.width, height: bitmap.height };
    }
    return { blob, ext: extensionFor(blob.type), ...size };
  } finally {
    bitmap.close();
  }
}

export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
