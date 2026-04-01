import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import { useTripStore } from '../store/tripStore';

export function usePhotoUpload(stopId: string) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshCurrentTrip } = useTripStore();

  const pickAndUpload = async () => {
    setError(null);

    // Request permission
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera roll permission required');
      return;
    }

    // Pick image
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      setError('Could not read image');
      return;
    }

    setUploading(true);
    try {
      // Get current max position for this stop
      const { data: existing } = await supabase
        .from('stop_photos')
        .select('position')
        .eq('stop_id', stopId)
        .order('position', { ascending: false })
        .limit(1);

      const nextPos = existing?.length ? (existing[0].position + 1) : 0;

      // Save to Supabase
      const b64 = `data:image/jpeg;base64,${asset.base64}`;
      const { error: insertError } = await supabase
        .from('stop_photos')
        .insert({
          stop_id: stopId,
          base64_data: b64,
          position: nextPos,
        });

      if (insertError) throw insertError;

      // Refresh trip data
      await refreshCurrentTrip();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const takePhoto = async () => {
    setError(null);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission required');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) return;

    setUploading(true);
    try {
      const { data: existing } = await supabase
        .from('stop_photos')
        .select('position')
        .eq('stop_id', stopId)
        .order('position', { ascending: false })
        .limit(1);

      const nextPos = existing?.length ? (existing[0].position + 1) : 0;

      await supabase.from('stop_photos').insert({
        stop_id: stopId,
        base64_data: `data:image/jpeg;base64,${asset.base64}`,
        position: nextPos,
      });

      await refreshCurrentTrip();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
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
