import * as FileSystem from 'expo-file-system';

const PHOTO_DIR = `${FileSystem.documentDirectory}pf_photos/`;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

export async function downloadAllPhotos(tripData: any): Promise<number> {
  try {
    await ensureDir();
    const photos = tripData.days
      .flatMap((d: any) => d.stops || [])
      .flatMap((s: any) => s.stop_photos || [])
      .filter((p: any) => p.storage_url && p.id);
    
    console.log(`Starting photo download: ${photos.length} photos found`);
    if (photos.length > 0) {
      console.log('Sample photo:', JSON.stringify(photos[0]).slice(0, 200));
    }
    
    let downloaded = 0;
    let alreadyCached = 0;
    for (const photo of photos) {
      const localPath = `${PHOTO_DIR}${photo.id}.jpg`;
      const info = await FileSystem.getInfoAsync(localPath);
      if (!info.exists) {
        const result = await FileSystem.downloadAsync(photo.storage_url, localPath).catch((e) => {
          console.warn('Download failed for', photo.id, e);
          return null;
        });
        if (result?.status === 200) downloaded++;
      } else {
        alreadyCached++;
      }
    }
    console.log(`Photos: ${downloaded} downloaded, ${alreadyCached} already cached, ${photos.length} total`);
    return downloaded;
  } catch (e) {
    console.warn('Photo download error:', e);
    return 0;
  }
}

export async function getPhotoUri(photo: any): Promise<string> {
  if (!photo?.id) return photo?.storage_url || photo?.base64_data || '';
  try {
    const localPath = `${PHOTO_DIR}${photo.id}.jpg`;
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) return localPath;
  } catch {}
  return photo.storage_url || photo.base64_data || '';
}

export async function downloadPhoto(photoId: string, url: string): Promise<string> {
  await ensureDir();
  const localPath = `${PHOTO_DIR}${photoId}.jpg`;
  const info = await FileSystem.getInfoAsync(localPath);
  if (info.exists) return localPath;
  const result = await FileSystem.downloadAsync(url, localPath);
  if (result.status !== 200) throw new Error('Download failed');
  return localPath;
}
