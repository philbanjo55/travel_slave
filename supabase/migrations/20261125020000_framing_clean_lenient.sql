-- Framing saves failed with "The photo placement is not readable" (Phil, 25 Nov 2026): shots G2 and T2 held a photo
-- placement whose fields were all null (a NaN from the phone, let through by the older sun_vantage_frame), and the
-- framings save (sun_vantage_framings, 20261124030000) sends the whole list back, so the check refused every save of
-- those shots. Now an incomplete placement or crop is dropped instead of refused, and the two broken ones are cleared.
CREATE OR REPLACE FUNCTION public.sun_framing_clean(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_heading double precision;
  v_pitch double precision;
  v_eye double precision;
  v_at timestamptz;
  v_photo jsonb;
  v_crop jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A framing is not readable'; end if;
  if jsonb_typeof(p->'heading') <> 'number' or jsonb_typeof(p->'pitch') <> 'number' then
    raise exception 'The heading or tilt is missing';
  end if;
  v_heading := (p->>'heading')::float8;
  v_pitch := (p->>'pitch')::float8;
  if not (v_heading between -100000 and 100000) then raise exception 'The heading is out of range'; end if;
  if not (v_pitch between -90 and 90) then raise exception 'The tilt is out of range'; end if;
  if jsonb_typeof(p->'lens') <> 'string' or length(p->>'lens') = 0 or length(p->>'lens') > 20 then
    raise exception 'The lens is missing';
  end if;
  if coalesce(p->>'orient', '') not in ('landscape', 'portrait') then
    raise exception 'The orientation must be landscape or portrait';
  end if;
  if jsonb_typeof(p->'eye') = 'number' then
    v_eye := (p->>'eye')::float8;
    if not (v_eye between 0.3 and 10000) then raise exception 'The camera height is out of range'; end if;
  end if;
  begin
    v_at := case when jsonb_typeof(p->'at') = 'string' then (p->>'at')::timestamptz end;
  exception when others then v_at := null;
  end;
  -- a photo placement or crop that is not complete (a NaN from the phone arrives as null) is dropped, never a refusal:
  -- 25 Nov 2026, two shots held an all-null placement and every save of their framings failed
  if jsonb_typeof(p->'photo') = 'object' and jsonb_typeof(p->'photo'->'key') = 'string'
     and jsonb_typeof(p->'photo'->'s') = 'number' and jsonb_typeof(p->'photo'->'x') = 'number' and jsonb_typeof(p->'photo'->'y') = 'number'
     and jsonb_typeof(p->'photo'->'w') = 'number' and jsonb_typeof(p->'photo'->'h') = 'number' then
    if length(p->'photo'->>'key') > 600
       or not ((p->'photo'->>'s')::float8 between 0.05 and 20) or not ((p->'photo'->>'x')::float8 between -20000 and 20000)
       or not ((p->'photo'->>'y')::float8 between -20000 and 20000) or not ((p->'photo'->>'w')::float8 between 1 and 20000)
       or not ((p->'photo'->>'h')::float8 between 1 and 20000) then
      raise exception 'The photo placement is not readable';
    end if;
    v_photo := jsonb_build_object('key', p->'photo'->>'key', 's', round((p->'photo'->>'s')::numeric, 4), 'x', round((p->'photo'->>'x')::numeric, 1),
                                  'y', round((p->'photo'->>'y')::numeric, 1), 'w', round((p->'photo'->>'w')::numeric, 1), 'h', round((p->'photo'->>'h')::numeric, 1));
  end if;
  if jsonb_typeof(p->'crop') = 'object' and jsonb_typeof(p->'crop'->'ratio') = 'string'
     and jsonb_typeof(p->'crop'->'cx') = 'number' and jsonb_typeof(p->'crop'->'cy') = 'number'
     and jsonb_typeof(p->'crop'->'w') = 'number' and jsonb_typeof(p->'crop'->'h') = 'number' then
    if (p->'crop'->>'ratio') not in ('1:1', '11x14', '5x7', '3:2', '16:9', '2:1', '3:1', 'custom')
       or not ((p->'crop'->>'cx')::float8 between 0 and 1) or not ((p->'crop'->>'cy')::float8 between 0 and 1)
       or not ((p->'crop'->>'w')::float8 between 0.05 and 1) or not ((p->'crop'->>'h')::float8 between 0.05 and 1) then
      raise exception 'The crop is not readable';
    end if;
    v_crop := jsonb_build_object('ratio', p->'crop'->>'ratio', 'cx', round((p->'crop'->>'cx')::numeric, 4), 'cy', round((p->'crop'->>'cy')::numeric, 4),
                                 'w', round((p->'crop'->>'w')::numeric, 4), 'h', round((p->'crop'->>'h')::numeric, 4));
  end if;
  v_heading := v_heading - 360 * floor(v_heading / 360);
  if v_heading >= 360 then v_heading := 0; end if;
  return jsonb_build_object(
    'heading', round(v_heading::numeric, 2), 'pitch', round(v_pitch::numeric, 2),
    'lens', p->>'lens', 'orient', p->>'orient', 'at', v_at,
    'photo', v_photo, 'eye', case when v_eye is null then null else round(v_eye::numeric, 4) end, 'crop', v_crop);
end $function$;;

update public.scout_vantages set frame_photo = null
 where frame_photo is not null and jsonb_typeof(frame_photo->'key') is distinct from 'string';
update public.scout_vantages set frame_more = (
  select jsonb_agg(case when jsonb_typeof(e->'photo') = 'object' and jsonb_typeof(e->'photo'->'key') is distinct from 'string'
                        then jsonb_set(e, '{photo}', 'null'::jsonb) else e end order by i)
    from jsonb_array_elements(frame_more) with ordinality t(e, i))
 where frame_more is not null;
