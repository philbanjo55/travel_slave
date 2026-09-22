import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../services/supabase';
import { useTripStore } from '../store/tripStore';
import { downloadPhoto } from '../services/photoCache';

const STORAGE_BUCKET = 'photos';
const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_T0_nU1MSX1HaW3EOVZ4y_Q_07yC-Jb2';

async function uploadToStorage(stopId: string, uri: string): Promise<{ id: string; storage_url: string }> {
  // Read file as base64
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  
  // Generate a unique ID
  const photoId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = `${stopId}/${photoId}.jpg`;

  // Upload to Supabase Storage via REST
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${filename}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'image/jpeg',
      },
      body: bytes,
    }
  );

  if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

  const storage_url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${filename}`;
  return { id: photoId, storage_url };
}

export function usePhotoUpload(stopId: string) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshCurrentTrip } = useTripStore();

  const uploadPhoto = async (uri: string) => {
    setUploading(true);
    setError(null);
    try {
      // Upload to Supabase Storage
      const { id: photoId, storage_url } = await uploadToStorage(stopId, uri);

      // Get next position
      const { data: existing } = await supabase
        .from('stop_photos')
        .select('position')
        .eq('stop_id', stopId)
        .order('position', { ascending: false })
        .limit(1);
      const nextPos = existing?.length ? (existing[0].position + 1) : 0;

      // Save record with storage_url
      const { error: insertError } = await supabase
        .from('stop_photos')
        .insert({ stop_id: stopId, storage_url, position: nextPos });

      if (insertError) throw insertError;

      // Cache locally immediately
      await downloadPhoto(photoId, storage_url).catch(() => {});

      await refreshCurrentTrip();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pickAndUpload = async () => {
    setError(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { setError('Camera roll permission required'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;
    await uploadPhoto(result.assets[0].uri);
  };

  const takePhoto = async () => {
    setError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { setError('Camera permission required'); return; }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    await uploadPhoto(result.assets[0].uri);
  };

  const deletePhoto = async (photoId: string) => {
    try {
      await supabase.from('stop_photos').delete().eq('id', photoId);
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return { pickAndUpload, takePhoto, deletePhoto, uploading, error };
}
