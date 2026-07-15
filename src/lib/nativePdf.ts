import { AssetCopy } from '@/lib/assetCopyPlugin';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';

const ASSET_RELATIVE_PATH = 'book/blueprint.pdf';
const CACHED_FILENAME = 'blueprint.pdf';

export async function openBundledPdfNatively(): Promise<void> {
  const { path } = await AssetCopy.copyBundledAsset({
    assetPath: ASSET_RELATIVE_PATH,
    destFileName: CACHED_FILENAME,
  });

  await FileOpener.openFile({
    path,
    mimeType: 'application/pdf',
  });
}