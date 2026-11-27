import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../services/supabase';
import { useTripStore } from '../store/tripStore';
import { downloadPhoto } from '../services/photoCache';

const STORAGE_BUCKET = 'photos';
const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';

export type PhotoType = 'reference' | 'field';

export const BORROWED_MESSAGE = 'This photo is from your real trip. Open the real trip to change or remove it.';

async function uploadToStorage(stopId: string, uri: string): Promise<{ id: string; storage_url: string }> {
  const photoId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = `${stopId}/${photoId}.jpg`;

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binaryString = global.atob
    ? global.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const storage_url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${filename}`;
  return { id: photoId, storage_url };
}

// groupStopIds: the stops sharing this stop's photos (linked repeat visits);
// a new photo goes to the end of the whole group's order.
export function usePhotoUpload(stopId: string, groupStopIds?: string[]) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { refreshCurrentTrip } = useTripStore();
  const ownStopIds = groupStopIds?.length ? groupStopIds : [stopId];

  const uploadSinglePhoto = async (uri: string, photoType: PhotoType): Promise<{ id: string; storage_url: string }> => {
    const { id: photoId, storage_url } = await uploadToStorage(stopId, uri);

    const { data: existing } = await supabase
      .from('stop_photos')
      .select('position')
      .in('stop_id', groupStopIds?.length ? groupStopIds : [stopId])
      .eq('photo_type', photoType)
      .order('position', { ascending: false })
      .limit(1);
    const nextPos = existing?.length ? (existing[0].position + 1) : 0;

    const { data: inserted, error: insertError } = await supabase
      .from('stop_photos')
      .insert({ stop_id: stopId, storage_url, position: nextPos, photo_type: photoType })
      .select('id')
      .single();

    if (insertError) throw insertError;

    const dbId = inserted?.id || photoId;
    await downloadPhoto(dbId, storage_url).catch(() => {});
    return { id: dbId, storage_url };
  };

  // Picks one photo from the library and adds it to the stop's reference
  // photos. Returns the new photo, or null if cancelled or it failed.
  const pickOne = async (photoType: PhotoType = 'reference'): Promise<{ id: string; storage_url: string } | null> => {
    setError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setError('Camera roll permission required'); return null; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    setUploading(true);
    try {
      const photo = await uploadSinglePhoto(result.assets[0].uri, photoType);
      refreshCurrentTrip().catch(() => {});
      return photo;
    } catch (err: any) {
      setError(`Upload failed: ${err.message || 'unknown error'}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const pickAndUpload = async (photoType: PhotoType = 'reference') => {
    setError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setError('Camera roll permission required'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      orderedSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    const total = result.assets.length;
    let uploaded = 0;

    try {
      for (const asset of result.assets) {
        uploaded++;
        setUploadProgress(total > 1 ? `${uploaded}/${total}` : '');
        await uploadSinglePhoto(asset.uri, photoType);
      }
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(`Upload failed: ${err.message || 'unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const takePhoto = async (photoType: PhotoType = 'field') => {
    setError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { setError('Camera permission required'); return; }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      await uploadSinglePhoto(result.assets[0].uri, photoType);
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(`Upload failed: ${err.message || 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photoId: string) => {
    setError(null);
    try {
      const { data: photo, error: readErr } = await supabase
        .from('stop_photos')
        .select('storage_url, stop_id')
        .eq('id', photoId)
        .single();
      if (readErr) throw readErr;
      // A practice trip shows the main trip's photos. Those are never removed from here:
      // only a photo that belongs to this stop (or its linked repeat visits) can go.
      if (!ownStopIds.includes((photo as any)?.stop_id)) {
        setError(BORROWED_MESSAGE);
        return;
      }

      // The row goes first: if that fails nothing has changed. Removing the
      // file afterwards can only leave an unused file behind, never a photo
      // on the list whose image is gone.
      const { error: delErr } = await supabase.from('stop_photos').delete().eq('id', photoId);
      if (delErr) throw delErr;

      if (photo?.storage_url) {
        const storagePath = photo.storage_url.split(`/public/${STORAGE_BUCKET}/`)[1];
        if (storagePath) {
          const { error: fileErr } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
          if (fileErr) console.warn('Photo file left in storage:', storagePath, fileErr.message);
        }
      }
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(`Delete failed: ${err?.message || 'check your connection'}`);
    }
  };

  // Puts `photoId` first in `orderedIds` (the stop's photos of one type, in
  // their current order) and renumbers positions 0..n-1. Needs a connection.
  const makeFirst = async (photoId: string, orderedIds: string[]): Promise<boolean> => {
    const wanted = [photoId, ...orderedIds.filter(id => id !== photoId)];
    try {
      // Only this trip's own photos are renumbered; the main trip's photos shown on a practice trip keep their order.
      const { data: rows, error: rowsErr } = await supabase.from('stop_photos').select('id, stop_id').in('id', wanted);
      if (rowsErr) throw rowsErr;
      const own = new Set((rows ?? []).filter((r: any) => ownStopIds.includes(r.stop_id)).map((r: any) => r.id));
      if (!own.has(photoId)) { setError(BORROWED_MESSAGE); return false; }
      const ids = wanted.filter(id => own.has(id));
      // All positions saved at once; the trip reload that re-sorts the list
      // runs in the background, so the caller can confirm straight away.
      const results = await Promise.all(ids.map((id, i) =>
        supabase.from('stop_photos').update({ position: i }).eq('id', id)));
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;
      refreshCurrentTrip().catch(() => {});
      return true;
    } catch (err: any) {
      setError(`Could not reorder photos${err.message ? `: ${err.message}` : ''}`);
      return false;
    }
  };

  return { pickAndUpload, pickOne, takePhoto, deletePhoto, makeFirst, uploading, uploadProgress, error };
}
