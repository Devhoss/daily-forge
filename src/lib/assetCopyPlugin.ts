import { registerPlugin } from "@capacitor/core";

export interface AssetCopyPlugin {
  /** Streams a file from the WebView's bundled assets (public/...) straight
   * to the app's Cache directory, entirely in native code — the file's
   * bytes never cross the JS bridge, only the resulting path string does. */
  copyBundledAsset(options: {
    assetPath: string; // relative to the bundled "public/" root, e.g. "book/blueprint.pdf"
    destFileName: string; // filename to write in the Cache directory
  }): Promise<{ path: string }>;
}

export const AssetCopy = registerPlugin<AssetCopyPlugin>("AssetCopy");
