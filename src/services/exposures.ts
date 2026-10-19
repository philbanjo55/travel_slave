import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const EXPOSURES_KEY = 'pf_exposures';
const FILMSTOCKS_KEY = 'pf_film_stocks';

export type Exposure = {
  id: string;
  captured_at: string;
  lat: number | null;
  lng: number | null;
  ev: number | null;
  iso: number | null;
  aperture: number | null;
  shutter_seconds: number | null;
  shutter_display: string | null;
  adjust_ev: number | null;
  nd_ev: number | null;
  meter_name: string | null;
  filter: string | null;
  film_stock: string | null;
  film_stock_id: string | null;
  notes: string | null;
  frame_number: number | null;
  trip_id: string | null;
  stop_id: string | null;
  photo_url: string | null;
  source: string | null;
  source_file: string | null;
  dedupe_key: string | null;
  created_at?: string;
  updated_at?: string;
};

export type FilmStock = {
  id: string;
  name: string;
  box_iso: number | null;
  format: string | null;
  reciprocity_p: number | null;
  notes: string | null;
};

// ─────────────────────────────────────────
// FETCH (cache-first, then network — mirrors tripStore pattern)
// ─────────────────────────────────────────
export async function fetchExposures(): Promise<Exposure[]> {
  const { data, error } = await supabase
    .from('exposures')
    .select('*')
    .order('captured_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Exposure[];
}

export async function fetchFilmStocks(): Promise<FilmStock[]> {
  const { data, error } = await supabase
    .from('film_stocks')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as FilmStock[];
}

// ─────────────────────────────────────────
// OFFLINE CACHE (mirrors database.ts — JSON in AsyncStorage)
// ─────────────────────────────────────────
export async function cacheExposures(exposures: Exposure[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      EXPOSURES_KEY,
      JSON.stringify({ exposures, cachedAt: Date.now() })
    );
  } catch (e) {
    console.warn('Exposure cache write failed:', e);
  }
}

export async function getCachedExposures(): Promise<Exposure[]> {
  try {
    const raw = await AsyncStorage.getItem(EXPOSURES_KEY);
    if (!raw) return [];
    return JSON.parse(raw).exposures || [];
  } catch {
    return [];
  }
}

export async function cacheFilmStocks(stocks: FilmStock[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FILMSTOCKS_KEY, JSON.stringify(stocks));
  } catch {}
}

export async function getCachedFilmStocks(): Promise<FilmStock[]> {
  try {
    const raw = await AsyncStorage.getItem(FILMSTOCKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Load with offline fallback: try network, fall back to cache.
export async function loadExposures(): Promise<{ exposures: Exposure[]; offline: boolean }> {
  try {
    const exposures = await fetchExposures();
    await cacheExposures(exposures);
    return { exposures, offline: false };
  } catch {
    const cached = await getCachedExposures();
    return { exposures: cached, offline: true };
  }
}

export async function loadFilmStocks(): Promise<FilmStock[]> {
  try {
    const stocks = await fetchFilmStocks();
    await cacheFilmStocks(stocks);
    return stocks;
  } catch {
    return await getCachedFilmStocks();
  }
}

// ─────────────────────────────────────────
// MUTATIONS
// ─────────────────────────────────────────
export async function updateExposure(id: string, updates: Partial<Exposure>): Promise<Exposure> {
  const { data, error } = await supabase
    .from('exposures')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Exposure;
}

export async function deleteExposure(id: string): Promise<void> {
  const { error } = await supabase.from('exposures').delete().eq('id', id);
  if (error) throw error;
}

export async function addFilmStock(name: string, box_iso?: number, reciprocity_p?: number): Promise<FilmStock> {
  const { data, error } = await supabase
    .from('film_stocks')
    .insert({ name, box_iso: box_iso ?? null, reciprocity_p: reciprocity_p ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as FilmStock;
}
