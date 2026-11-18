const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';

export async function migratePhotosToStorage(): Promise<{ migrated: number; failed: number; total?: number; message?: string }> {
  console.log('Starting photo migration...');
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/migrate-photos-to-storage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  console.log('Response status:', response.status);
  const result = await response.json();
  console.log('Migration result:', result);
  if (!response.ok) throw new Error(result.error || `Failed: ${response.status}`);
  return result;
}
