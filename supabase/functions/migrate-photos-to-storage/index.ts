import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req: Request) => {
  // Add CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  try {
    // Create bucket if it doesn't exist
    await supabase.storage.createBucket('photos', { public: true }).catch(() => {});

    const { data: photos, error } = await supabase
      .from('stop_photos')
      .select('id, stop_id, base64_data, position')
      .is('storage_url', null)
      .not('base64_data', 'is', null);

    if (error) throw error;
    if (!photos?.length) {
      return new Response(JSON.stringify({ message: 'No photos to migrate', migrated: 0 }), { headers });
    }

    let migrated = 0;
    let failed = 0;

    for (const photo of photos) {
      try {
        const base64 = photo.base64_data.replace(/^data:image\/\w+;base64,/, '');
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const filename = `${photo.stop_id}/${photo.id}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(filename, bytes, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) { failed++; continue; }

        const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(filename);
        await supabase.from('stop_photos').update({ storage_url: publicUrl }).eq('id', photo.id);
        migrated++;
      } catch (e) {
        failed++;
      }
    }

    return new Response(JSON.stringify({ migrated, failed, total: photos.length }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers });
  }
});
