import * as FileSystem from 'expo-file-system';

const PHOTO_DIR = `${FileSystem.documentDirectory}pf_photos/`;

export async function ensurePhotoDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

export function getLocalPhotoPath(photoId: string): string {
  return `${PHOTO_DIR}${photoId}.jpg`;
}

export async function downloadAllPhotos(tripData: any): Promise<void> {
  try {
    await ensurePhotoDir();
    const photos = tripData.days
      .flatMap((d: any) => d.stops || [])
      .flatMap((s: any) => s.stop_photos || [])
      .filter((p: any) => p.storage_url && p.id);

    for (const photo of photos) {
      const localPath = getLocalPhotoPath(photo.id);
      const info = await FileSystem.getInfoAsync(localPath);
      if (!info.exists) {
        await FileSystem.downloadAsync(photo.storage_url, localPath);
      }
    }
  } catch (e) {
    console.warn('Photo download error:', e);
  }
}

// Returns local URI if cached, otherwise storage URL
export async function resolvePhotoUri(photo: any): Promise<string> {
  if (!photo?.id) return photo?.storage_url || photo?.base64_data || '';
  try {
    const localPath = getLocalPhotoPath(photo.id);
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localPath;
  } catch {}
  return photo.storage_url || photo.base64_data || '';
}
