import { registerPlugin, Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

interface DocumentSavePlugin {
  saveFromCache(options: {
    cachePath: string;
    fileName: string;
    mimeType?: string;
  }): Promise<{ uri?: string; bytes?: number }>;
}

const DocumentSave = registerPlugin<DocumentSavePlugin>('DocumentSave');

// Bump whenever the Android plugin changes so a stale device build can be spotted.
export const DOCUMENT_SAVE_PLUGIN_BUILD = 3;

const CACHE_NAME = 'dailyforge-backup.json';

// Best-effort cleanup of a staged file left behind if the process was killed
// mid-export (the OS can restart the app while the SAF picker is open).
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
  Filesystem.deleteFile({ path: CACHE_NAME, directory: Directory.Cache }).catch(() => {});
}

/**
 * Save a backup to a location chosen via Android's Storage Access Framework
 * (ACTION_CREATE_DOCUMENT). To avoid process death on large backups, the payload
 * is first staged to the app's internal cache and then streamed into the chosen
 * SAF Uri in small chunks by the native plugin. Returns true only when the file
 * was actually written (resolved with a non-zero byte count). Only meaningful on
 * Android.
 */
export async function saveTextViaDocumentPicker(
  text: string,
  fileName: string,
  mimeType = 'application/json',
): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return false;
  }
  try {
    await Filesystem.writeFile({ path: CACHE_NAME, data: text, encoding: Encoding.UTF8, directory: Directory.Cache, recursive: true });
    const res = await DocumentSave.saveFromCache({ cachePath: CACHE_NAME, fileName, mimeType });
    // Best-effort cleanup of the staged file; failing here must not fail the save.
    try {
      await Filesystem.deleteFile({ path: CACHE_NAME, directory: Directory.Cache });
    } catch {
      /* ignore */
    }
    return !!res && typeof res.bytes === 'number' && res.bytes > 0;
  } catch (err) {
    console.warn('Document save cancelled or failed', err);
    return false;
  }
}