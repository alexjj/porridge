// Turning a picked file into an image ready to upload, in the browser.

import { extensionFor, shouldReencode, targetSize } from "../model/images.js";

export interface PreparedImage {
  blob: Blob;
  ext: string;
  width: number;
  height: number;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return { blob: file, ext: extensionFor(file.type), width: 0, height: 0 };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't read that image. Try a JPEG or PNG.");
  }
  try {
    if (!shouldReencode(file.type, file.size, bitmap.width, bitmap.height)) {
      return { blob: file, ext: extensionFor(file.type), width: bitmap.width, height: bitmap.height };
    }
    const size = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d")!;
    // JPEG has no transparency: put transparent images on white.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't resize the image."))), "image/jpeg", 0.85),
    );
    return { blob, ext: "jpg", ...size };
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
