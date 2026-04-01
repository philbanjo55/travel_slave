import * as FileSystem from 'expo-file-system';

const PHOTO_DIR = `${FileSystem.documentDirectory}photos/`;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

export async function getCachedPhotoUri(photoId: string, storageUrl: string): Promise<string> {
  await ensureDir();
  const localPath = `${PHOTO_DIR}${photoId}.jpg`;
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;
  
  // Download and cache
  await FileSystem.downloadAsync(storageUrl, localPath);
  return localPath;
}

export async function prefetchPhotos(photos: { id: string; storage_url: string }[]): Promise<void> {
  await ensureDir();
  for (const photo of photos) {
    if (!photo.storage_url) continue;
    const localPath = `${PHOTO_DIR}${photo.id}.jpg`;
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists) {
      await FileSystem.downloadAsync(photo.storage_url, localPath).catch(() => {});
    }
  }
}
