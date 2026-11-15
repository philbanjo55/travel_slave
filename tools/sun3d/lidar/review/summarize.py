import json, numpy as np, sys
T = '/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/trees_review'
d = json.load(open(T + '/out_d/accuracy.json'))
J = {j['key']: j for j in json.load(open('/tmp/claude-0/-home-user-travel-slave/8a52edb1-f326-50db-9668-2666181de8d5/scratchpad/rv_jobs.json'))}


def agg(side, band, keys, wkey='found'):
    tot = sum(d[k][side].get(band, {}).get('trees', 0) for k in keys); fnd = sum(d[k][side].get(band, {}).get('found', 0) for k in keys)
    ext = sum(d[k][side].get(band, {}).get('extra', 0) for k in keys)
    def wmed(f):   # median of per-pin medians weighted by found trees
        v = [(d[k][side][band][f], d[k][side][band].get(wkey, 0)) for k in keys if band in d[k][side] and f in d[k][side][band]]
        if not v: return float('nan')
        a = np.array(v); o = np.argsort(a[:, 0]); c = np.cumsum(a[o, 1]); return float(a[o, 0][np.searchsorted(c, c[-1] / 2)])
    return tot, fnd, ext, wmed


keys = sorted(d)
print('pins', len(keys))
for band in ['0-100', '100-260', '260-500']:
    tot, fnd, ext, wm = agg('today', band, keys)
    print(f'\nTODAY {band} m: survey trees {tot}, with dots {fnd} ({fnd / max(tot, 1):.1%}); height err med {wm("height_err_med"):+.2f} (abs {wm("height_err_abs_med"):.2f}); drawn width / survey crown {wm("width_drawn_over_survey_med"):.2f}; dot size {wm("dot_size_m_med"):.2f} m; centre-to-top {wm("pos_err_m_med"):.2f} m (p90 {wm("pos_err_m_p90"):.2f}); angle {wm("ang_err_deg_med"):.3f} deg (p90 {wm("ang_err_deg_p90"):.3f}); lone trees: drawn width / crown {wm("alone_width_drawn_over_survey_med"):.2f}')
    if band == '260-500':
        wt = sum(d[k]['today'].get(band, {}).get('wide_trees', 0) for k in keys); ws = sum(d[k]['today'].get(band, {}).get('wide_sprite_within_5m', 0) for k in keys)
        _, _, _, wm2 = agg('today', band, keys, 'wide_sprite_within_5m')
        print(f'   park-wide sprites: survey trees >= 4 m {wt}, a sprite within 5 m {ws} ({ws / max(wt, 1):.1%}); sprite height err med {wm2("wide_height_err_med"):+.2f}; sprite width / survey crown {wm2("wide_width_over_survey_med"):.2f}; angle {wm2("wide_ang_err_deg_med"):.3f}')
    tot, fnd, ext, wm = agg('AB', band, keys)
    print(f'A/B   {band} m: survey trees {tot}, drawn one-to-one (within 1.5 m) {fnd} ({fnd / max(tot, 1):.1%}), extra drawn {ext}; position med {wm("pos_err_m_med"):.2f} m (p90 {wm("pos_err_m_p90"):.2f}); height err med {wm("height_err_med"):+.2f} (abs {wm("height_err_abs_med"):.2f}, p90 {wm("height_err_abs_p90"):.2f}); crown width err {wm("cw_err_m_med"):+.2f} m (abs {wm("cw_abs_err_m_med"):.2f}); drawn width / survey crown {wm("width_drawn_over_survey_med"):.2f} (clamped {wm("width_clamped_share"):.0%}); angle {wm("ang_err_deg_med"):.3f} deg (p90 {wm("ang_err_deg_p90"):.3f}); bare call agrees {wm("bare_agree"):.0%}; lone trees: crown err {wm("alone_cw_err_m_med"):+.2f} m, drawn width / crown {wm("alone_width_drawn_over_survey_med"):.2f}')
print('\nper pin 0-100 m (today found / dots width ratio | A found / extra / width ratio):')
for k in keys:
    t = d[k]['today'].get('0-100', {}); a = d[k]['AB'].get('0-100', {})
    if not t: continue
    print(f"  {k} {J[k]['stop'][:24]:24s} {J[k]['shot'][:18]:18s} trees {t['trees']:4d} | today {t['found']:4d} x{t.get('width_drawn_over_survey_med', float('nan')):.2f} | A {a.get('found', 0):4d} +{a.get('extra', 0):3d} x{a.get('width_drawn_over_survey_med', float('nan')):.2f}")
