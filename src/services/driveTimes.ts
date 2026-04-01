const SUPABASE_URL = 'https://ohshrzlvvxyovcjmdajc.supabase.co';
const CLAUDE_API_KEY = 'philmframe-claude-2026';

export async function calculateDriveTimes(tripId: string): Promise<{ updated: number; skipped: number; failed: number }> {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/calculate-drive-times`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
      },
      body: JSON.stringify({ trip_id: tripId }),
    }
  );
  if (!response.ok) throw new Error(`Function failed: ${response.status}`);
  return response.json();
}
