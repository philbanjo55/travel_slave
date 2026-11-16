"""Pinhole camera in east-north-up metres. yaw clockwise from north, pitch up, roll clockwise (the picture turns),
hfov = horizontal field of view in degrees, principal point = image centre."""
import math
import numpy as np


def axes(yaw, pitch, roll):
    y, p, ro = map(math.radians, (yaw, pitch, roll))
    f = np.array([math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)])
    r0 = np.array([math.cos(y), -math.sin(y), 0.0])
    u0 = np.cross(r0, f)
    r = r0 * math.cos(ro) + u0 * math.sin(ro); u = -r0 * math.sin(ro) + u0 * math.cos(ro)
    return f, r, u


def fpx(hfov, W):
    return (W / 2) / math.tan(math.radians(hfov) / 2)


def rays(px, py, q, W, H):
    """pixel -> (azimuth deg, elevation deg)"""
    yaw, pitch, roll, hfov = q
    f, r, u = axes(yaw, pitch, roll); fp = fpx(hfov, W)
    d = f[None] * fp + r[None] * (np.asarray(px, float)[:, None] - W / 2) - u[None] * (np.asarray(py, float)[:, None] - H / 2)
    az = np.degrees(np.arctan2(d[:, 0], d[:, 1])) % 360
    el = np.degrees(np.arctan2(d[:, 2], np.hypot(d[:, 0], d[:, 1])))
    return az, el


def project_dirs(az, el, q, W, H):
    """direction (azimuth, elevation, deg) -> pixel x, y (nan behind the camera)"""
    yaw, pitch, roll, hfov = q
    f, r, u = axes(yaw, pitch, roll); fp = fpx(hfov, W)
    a = np.radians(np.asarray(az, float)); e = np.radians(np.asarray(el, float))
    D = np.stack([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)], -1)
    z = D @ f; x = D @ r; y = D @ u
    z = np.where(z > 1e-6, z, np.nan)
    return W / 2 + fp * x / z, H / 2 - fp * y / z


def unwrap(az, ref):
    """azimuth into (ref - 180, ref + 180]"""
    return ref + ((np.asarray(az) - ref + 180) % 360) - 180


def sky_curve(paz, pel, q, W, H, xs):
    """image y of the model sky line in each column xs, for the profile (paz ascending, unwrapped near yaw)"""
    xs = np.asarray(xs, float); lo = np.full(len(xs), -0.5 * H); hi = np.full(len(xs), 1.5 * H)
    for _ in range(26):
        m = (lo + hi) / 2
        az, el = rays(xs, m, q, W, H); az = unwrap(az, q[0])
        above = el > np.interp(az, paz, pel)
        lo = np.where(above, m, lo); hi = np.where(above, hi, m)
    return (lo + hi) / 2
