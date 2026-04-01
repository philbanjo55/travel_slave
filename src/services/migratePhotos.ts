const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const CLAUDE_API_KEY = 'philmframe-claude-2026';

export async function migratePhotosToStorage(): Promise<{ migrated: number; failed: number }> {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/migrate-photos-to-storage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
      },
      body: JSON.stringify({}),
    }
  );
  if (!response.ok) throw new Error(`Migration failed: ${response.status}`);
  return response.json();
}
