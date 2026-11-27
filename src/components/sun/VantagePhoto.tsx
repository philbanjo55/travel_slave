import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp, View, ViewStyle, ActivityIndicator } from 'react-native';
import { getPhotoUri } from '../../services/photoCache';

// A vantage's reference photo, from the phone's photo store when it has been
// downloaded (so it shows offline), else from the web.
export function usePhotoUri(id?: string | null, url?: string | null): string {
  const [uri, setUri] = useState('');
  useEffect(() => {
    let alive = true;
    setUri('');
    if (!id) return;
    getPhotoUri({ id, storage_url: url }).then(u => { if (alive && u) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  }, [id, url]);
  return uri;
}

export default function VantagePhoto({ id, url, style, resizeMode = 'cover' }: {
  id?: string | null;
  url?: string | null;
  style?: StyleProp<ViewStyle>;
  resizeMode?: 'cover' | 'contain';
}) {
  const uri = usePhotoUri(id, url);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' }, style]}>
      {uri
        ? <Image source={{ uri }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as StyleProp<ImageStyle>} resizeMode={resizeMode} />
        : <ActivityIndicator size="small" color="#555" />}
    </View>
  );
}
