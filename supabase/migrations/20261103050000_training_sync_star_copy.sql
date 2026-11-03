-- training_sync: when the main trip stars a DIFFERENT shot that the copy stop already has as its
-- own copy (same vantage_place), star that copy. Before, it starred the main trip's vantage id,
-- which is not on the copy stop, and the whole sync failed ("The starred shot is not on this
-- stop"; 3 Nov 2026, Faroes: "Vágar — Evening" moved to the Bøur panoramic shot).
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('public.training_sync(uuid,boolean)'::regprocedure);
  o := $o$         case when vantage_place(ti.star_vantage_id) = vantage_place(mi.star_vantage_id) then ti.star_vantage_id else mi.star_vantage_id end,$o$;
  n := $n$         case when vantage_place(ti.star_vantage_id) = vantage_place(mi.star_vantage_id) then ti.star_vantage_id
              else coalesce((select q.vantage_id from stop_sun_pairs q
                              where q.stop_id = x.tid and vantage_place(q.vantage_id) = vantage_place(mi.star_vantage_id)
                              order by (q.vantage_id = mi.star_vantage_id) desc, q.position limit 1),
                            mi.star_vantage_id) end,$n$;
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then raise exception 'star line: expected 1'; end if;
  execute replace(d, o, n);
end $$;
