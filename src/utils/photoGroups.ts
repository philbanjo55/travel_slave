// Linked stops (stops.photo_group) are repeat visits to the same place and
// share one photo pool: every photo added to any of them shows on all. Each
// photo still belongs to the stop it was added to.

// The stops that share photos with `stop`, in trip order; just [stop] when
// it is not linked.
export function photoGroupStops(tripData: any, stop: any): any[] {
  if (!stop?.photo_group) return stop ? [stop] : [];
  const out: any[] = [];
  for (const day of tripData?.days ?? []) {
    for (const s of day?.stops ?? []) {
      if (s.photo_group === stop.photo_group) out.push(s);
    }
  }
  return out.length ? out : [stop];
}

// All photos of those stops. Linked groups keep one running order (position),
// so sorting by position alone gives the group's order; ties (never expected)
// fall back to trip order.
export function photoGroupPhotos(stops: any[]): any[] {
  const all: { p: any; i: number }[] = [];
  stops.forEach((s, i) => (s.stop_photos ?? []).forEach((p: any) => all.push({ p, i })));
  return all
    .sort((a, b) => ((a.p.position ?? 1e9) - (b.p.position ?? 1e9)) || (a.i - b.i))
    .map(x => x.p);
}

// The stop page's two photo lists from those photos: reference (no type, or 'reference') and field, each by position.
export function splitStopPhotos(all: any[]): { ref: any[]; field: any[] } {
  const byPosition = (a: any, b: any) => (a.position ?? 1e9) - (b.position ?? 1e9);
  return {
    ref: all.filter((p: any) => !p.photo_type || p.photo_type === 'reference').sort(byPosition),
    field: all.filter((p: any) => p.photo_type === 'field').sort(byPosition),
  };
}

// Every photo the stop page shows for `stopId`, in its order (reference, then field; the photo group's shared ones and,
// on a practice trip, the borrowed ones included), from the trip as the app holds it. [] when the stop isn't listed.
export function stopPagePhotos(tripData: any, stopId: string): any[] {
  let stop: any = null;
  for (const day of tripData?.days ?? []) {
    stop = (day?.stops ?? []).find((s: any) => s?.id === stopId) ?? null;
    if (stop) break;
  }
  if (!stop) return [];
  const { ref, field } = splitStopPhotos(photoGroupPhotos(photoGroupStops(tripData, stop)));
  return [...ref, ...field];
}
