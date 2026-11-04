from __future__ import annotations

import numpy as np

FEATURES = ["taste", "channel_watch", "follows", "log_views", "fresh", "like_rate", "lang", "reel", "log_minutes", "seen"]


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


def fit(X: np.ndarray, y: np.ndarray, *, l2: float = 1e-3, lr: float = 0.3, steps: int = 400) -> dict:
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std[std < 1e-9] = 1.0
    Z = (X - mean) / std
    w = np.zeros(Z.shape[1])
    b = 0.0
    pos = max(float(y.mean()), 1e-6)
    weight = np.where(y > 0, 0.5 / pos, 0.5 / max(1 - pos, 1e-6))
    n = len(y)
    for _ in range(steps):
        p = _sigmoid(Z @ w + b)
        g = (p - y) * weight
        w -= lr * (Z.T @ g / n + l2 * w)
        b -= lr * float(g.mean())
    return {"weights": w.tolist(), "bias": b, "mean": mean.tolist(), "std": std.tolist()}


def score(m: dict, X: np.ndarray) -> np.ndarray:
    Z = (X - np.asarray(m["mean"])) / np.asarray(m["std"])
    return _sigmoid(Z @ np.asarray(m["weights"]) + float(m["bias"]))


def auc(y: np.ndarray, s: np.ndarray) -> float:
    pos, neg = s[y > 0], s[y <= 0]
    if len(pos) == 0 or len(neg) == 0:
        return 0.5
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(len(order))
    ranks[order] = np.arange(1, len(order) + 1)
    return float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def ndcg(y: np.ndarray, s: np.ndarray, groups: np.ndarray, k: int = 10) -> float:
    total, n = 0.0, 0
    for g in np.unique(groups):
        idx = np.where(groups == g)[0]
        rel = y[idx]
        if rel.sum() == 0:
            continue
        top = idx[np.argsort(-s[idx], kind="mergesort")][:k]
        dcg = sum(y[i] / np.log2(r + 2) for r, i in enumerate(top))
        ideal = sorted(rel, reverse=True)[:k]
        idcg = sum(v / np.log2(r + 2) for r, v in enumerate(ideal))
        total += dcg / idcg if idcg else 0.0
        n += 1
    return total / n if n else 0.0


def evaluate(X: np.ndarray, y: np.ndarray, groups: np.ndarray, times: np.ndarray, baseline: np.ndarray,
             holdout: float = 0.2) -> tuple[dict, dict]:
    cut = np.quantile(times, 1 - holdout) if len(times) else 0
    train, test = times < cut, times >= cut
    if train.sum() < 20 or test.sum() < 10 or y[train].sum() == 0:
        train = test = np.ones(len(y), dtype=bool)
    m = fit(X[train], y[train])
    s = score(m, X[test])
    metrics = {"n_train": int(train.sum()), "n_test": int(test.sum()), "positives": int(y.sum()),
               "auc": round(auc(y[test], s), 4), "auc_baseline": round(auc(y[test], baseline[test]), 4),
               "ndcg10": round(float(ndcg(y[test], s, groups[test])), 4),
               "ndcg10_baseline": round(float(ndcg(y[test], baseline[test], groups[test])), 4)}
    final = fit(X, y)
    return final, metrics


def synthetic(n_users: int = 150, n_items: int = 240, per_user: int = 40, seed: int = 7) -> tuple:
    rng = np.random.default_rng(seed)
    topics = 6
    user_topic = rng.integers(0, topics, n_users)
    item_topic = rng.integers(0, topics, n_items)
    pop = rng.lognormal(3, 1.2, n_items)
    age = rng.uniform(0, 600, n_items)
    rows, ys, gs, ts, base = [], [], [], [], []
    for u in range(n_users):
        items = rng.choice(n_items, per_user, replace=False)
        for t, i in enumerate(items):
            match = 1.0 if item_topic[i] == user_topic[u] else 0.0
            taste = match * 0.6 + rng.normal(0, 0.15)
            watched_channel = np.log1p(rng.poisson(4 * match + 0.3))
            x = [taste, watched_channel, float(rng.random() < 0.3 * match), np.log1p(pop[i]), np.exp(-age[i] / 336),
                 rng.uniform(0, 0.2), float(rng.random() < 0.8), float(rng.random() < 0.4), rng.uniform(0, 3), 0.0]
            logit = -2.2 + 3.0 * match + 0.15 * np.log1p(pop[i]) + 0.5 * np.exp(-age[i] / 336)
            ys.append(float(rng.random() < 1 / (1 + np.exp(-logit))))
            rows.append(x)
            gs.append(u)
            ts.append(u * 1000 + t)
            base.append(np.log1p(pop[i]) * 4 * (1 + 0.8 * x[5]) / ((age[i] + 2) ** 1.15))
    return np.array(rows), np.array(ys), np.array(gs), np.array(ts, dtype=float), np.array(base)
