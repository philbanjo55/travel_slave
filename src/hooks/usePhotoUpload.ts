import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../services/supabase';
import { useTripStore } from '../store/tripStore';
import { downloadPhoto } from '../services/photoCache';

const STORAGE_BUCKET = 'photos';
const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';

export type PhotoType = 'reference' | 'field';

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

export function usePhotoUpload(stopId: string) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { refreshCurrentTrip } = useTripStore();

  const uploadSinglePhoto = async (uri: string, photoType: PhotoType): Promise<void> => {
    const { id: photoId, storage_url } = await uploadToStorage(stopId, uri);

    const { data: existing } = await supabase
      .from('stop_photos')
      .select('position')
      .eq('stop_id', stopId)
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
      setError(err.message || 'Upload failed');
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
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photoId: string) => {
    try {
      const { data: photo } = await supabase
        .from('stop_photos')
        .select('storage_url')
        .eq('id', photoId)
        .single();

      if (photo?.storage_url) {
        const storagePath = photo.storage_url.split(`/public/${STORAGE_BUCKET}/`)[1];
        if (storagePath) {
          await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
        }
      }

      await supabase.from('stop_photos').delete().eq('id', photoId);
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return { pickAndUpload, takePhoto, deletePhoto, uploading, uploadProgress, error };
}
