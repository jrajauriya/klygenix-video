from __future__ import annotations

MAX_POINTS = 60


def fill(samples: list[tuple[int, float | None]]) -> list[tuple[int, float]]:
    known = [c for _, c in samples if c is not None]
    if not known:
        return [(t, 0.5) for t, _ in samples]
    out, last = [], known[0]
    for t, c in samples:
        if c is not None:
            last = c
        out.append((t, last))
    return out


def smooth(points: list[tuple[int, float]], alpha: float = 0.35, dead_zone: float = 0.04) -> list[tuple[int, float]]:
    if not points:
        return []
    out, cur, target = [], points[0][1], points[0][1]
    for t, c in points:
        if abs(c - target) > dead_zone:
            target = c
        cur = cur + alpha * (target - cur)
        out.append((t, round(cur, 4)))
    return out


def simplify(points: list[tuple[int, float]], tol: float = 0.01) -> list[tuple[int, float]]:
    if len(points) <= 2:
        return list(points)

    def rdp(lo: int, hi: int) -> list[int]:
        (t0, c0), (t1, c1) = points[lo], points[hi]
        best, idx = 0.0, -1
        for i in range(lo + 1, hi):
            t, c = points[i]
            expect = c0 + (c1 - c0) * (t - t0) / max(t1 - t0, 1)
            d = abs(c - expect)
            if d > best:
                best, idx = d, i
        if best <= tol or idx < 0:
            return [lo, hi]
        return rdp(lo, idx)[:-1] + rdp(idx, hi)

    keep = rdp(0, len(points) - 1)
    out = [points[i] for i in keep]
    while len(out) > MAX_POINTS:
        out = out[::2] + ([out[-1]] if len(out) % 2 == 0 else [])
    return out


def track_from(samples: list[tuple[int, float | None]]) -> list[dict]:
    return [{"t_ms": t, "cx": c} for t, c in simplify(smooth(fill(samples)))]


def clean(track: list[dict]) -> list[dict]:
    rows = sorted({int(p["t_ms"]): max(0.0, min(1.0, float(p["cx"]))) for p in track}.items())
    return [{"t_ms": t, "cx": round(c, 4)} for t, c in rows][:MAX_POINTS]


def x_expr(track: list[dict], start_ms: int, src_w: int, cw: int) -> str:
    pts = [((p["t_ms"] - start_ms) / 1000, p["cx"] * src_w - cw / 2) for p in clean(track)]
    if not pts:
        return str(int((src_w - cw) / 2))
    expr = f"{pts[-1][1]:.1f}"
    for i in range(len(pts) - 2, -1, -1):
        (t0, x0), (t1, x1) = pts[i], pts[i + 1]
        span = max(t1 - t0, 0.001)
        expr = f"if(lt(t,{t1:.3f}),{x0:.1f}+({x1 - x0:.1f})*(t-{t0:.3f})/{span:.3f},{expr})"
    expr = f"if(lt(t,{pts[0][0]:.3f}),{pts[0][1]:.1f},{expr})"
    return f"clip({expr},0,{src_w - cw})"
