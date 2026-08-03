import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export type PhotoCapture = {
  blob: Blob;
  filename: string;
  /** True when the platform successfully wrote the capture to the device gallery. */
  savedToGallery: boolean;
};

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // FileReader returns a data URL; strip the "data:...;base64," prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function randomFilename(ext = "jpg"): string {
  return `dailyforge-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
}

/**
 * Opens the camera (native) or the file input (web) and returns the raw image
 * blob. When `saveToGallery` is true on native, the platform media API writes a
 * copy to the device photo library (Android Pictures / iOS Photos).
 */
export async function takeProgressPhoto(saveToGallery: boolean): Promise<PhotoCapture> {
  const result = await Camera.takePhoto({
    quality: 88,
    correctOrientation: true,
    saveToGallery,
    webUseInput: true,
  });
  if (!result.webPath) {
    throw new Error("No image returned from camera");
  }
  const resp = await fetch(result.webPath);
  const blob = await resp.blob();
  return {
    blob,
    filename: randomFilename(),
    savedToGallery: result.saved,
  };
}

/**
 * Writes a copy of an image to the device gallery under a DailyForge album.
 * On Android this uses the shared Documents folder (MediaScanned into the
 * gallery). On iOS it writes into the app Documents container. On web it
 * triggers a download.
 */
export async function saveBlobToGallery(blob: Blob, filename?: string): Promise<boolean> {
  const name = filename ?? randomFilename();
  try {
    const base64 = await blobToBase64(blob);
    if (isNative()) {
      await Filesystem.writeFile({
        path: `DailyForge/${name}`,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      return true;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.warn("saveBlobToGallery failed:", err);
    return false;
  }
}

/**
 * Shares an image via the system share sheet (native) or the Web Share API.
 */
export async function shareBlob(blob: Blob, filename?: string): Promise<boolean> {
  const name = filename ?? randomFilename();
  try {
    if (isNative()) {
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: name,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });
      const fileUri = await Filesystem.getUri({ path: name, directory: Directory.Cache });
      await Share.share({
        title: "DailyForge Progress Photo",
        url: fileUri.uri,
        dialogTitle: "Share Progress Photo",
      });
      return true;
    }
    if (navigator.share) {
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });
      await navigator.share({ files: [file], title: "DailyForge Progress Photo" });
      return true;
    }
    return false;
  } catch (err) {
    console.warn("shareBlob failed:", err);
    return false;
  }
}