import * as FileSystem from 'expo-file-system';

const PHOTO_DIR = `${FileSystem.documentDirectory}pf_photos/`;
const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';

async function log(level: string, message: string, data?: any) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/app_logs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ level, message, data }),
    });
  } catch {}
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
  }
}

function localPath(photoId: string): string {
  return `${PHOTO_DIR}${photoId}.jpg`;
}

// Get local file URI if cached, otherwise return storage URL
export async function getPhotoUri(photo: any): Promise<string> {
  if (!photo?.id) return photo?.storage_url || photo?.base64_data || '';
  try {
    const path = localPath(photo.id);
    const info = await FileSystem.getInfoAsync(path);
    await log('debug', 'getPhotoUri check', { 
      photoId: photo.id, 
      path, 
      exists: info.exists,
      info: JSON.stringify(info)
    });
    if (info.exists) {
      return path;
    }
  } catch (e) {
    await log('error', 'getPhotoUri error', { photoId: photo.id, error: String(e) });
  }
  return photo.storage_url || photo.base64_data || '';
}

// Download a single photo to local storage
export async function downloadPhoto(photoId: string, url: string): Promise<string> {
  await ensureDir();
  const path = localPath(photoId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) return path;
  const result = await FileSystem.downloadAsync(url, path);
  if (result.status !== 200) throw new Error(`Download failed: ${result.status}`);
  return path;
}

// Download ALL photos for a trip — call once after sync
export async function downloadAllPhotos(tripData: any): Promise<void> {
  try {
    await ensureDir();
    const photos = tripData.days
      .flatMap((d: any) => d.stops || [])
      .flatMap((s: any) => s.stop_photos || [])
      .filter((p: any) => p.storage_url && p.id);

    let downloaded = 0;
    let alreadyCached = 0;
    let failed = 0;

    for (const photo of photos) {
      const path = localPath(photo.id);
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists && (info as any).size > 0) {
        alreadyCached++;
        continue;
      }
      try {
        const result = await FileSystem.downloadAsync(photo.storage_url, path);
        if (result.status === 200) {
          downloaded++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    await log('info', 'Photo cache complete', {
      total: photos.length,
      downloaded,
      alreadyCached,
      failed,
      dir: PHOTO_DIR,
    });
  } catch (e) {
    await log('error', 'downloadAllPhotos failed', { error: String(e) });
  }
}
