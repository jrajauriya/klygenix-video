"""What a role may reach before anyone has edited the matrix.

One module, imported by the middleware and by both permission routers. The master
estate keeps these dicts inside a router and imports them back into the middleware at
call time to dodge a circular import; putting them in a service removes the cycle.

Levels are "none" | "view" | "full". `global_admin` and `owner` bypass the matrix
entirely and are not listed here.
"""

from app.core.services.feature_catalog import all_feature_keys

LEVELS: dict[str, int] = {"none": 0, "view": 1, "full": 2}


ADMIN_DEFAULT_PERMISSIONS: dict[str, dict[str, str]] = {
    "admin": {
        "admin.dashboard": "full", "admin.tenants": "full", "admin.moderation": "full",
        "admin.takedowns": "full", "admin.ai_usage": "view", "admin.plans": "view",
        "admin.logs": "view", "admin.email": "none", "admin.settings": "none", "admin.team": "none",
    },
    "user": {
        "admin.dashboard": "view", "admin.tenants": "view", "admin.moderation": "full",
        "admin.takedowns": "view", "admin.ai_usage": "none", "admin.plans": "none",
        "admin.logs": "none", "admin.email": "none", "admin.settings": "none", "admin.team": "none",
    },
}


VIDEO_DEFAULT_PERMISSIONS: dict[str, dict[str, str]] = {
    "admin": {
        "video.dashboard": "full", "video.uploads": "full", "video.clips": "full",
        "video.channels": "full", "video.comments": "full", "video.analytics": "full",
        "video.billing": "view", "video.users": "view", "video.settings": "view",
    },
    "user": {
        "video.dashboard": "view", "video.uploads": "full", "video.clips": "full",
        "video.channels": "view", "video.comments": "full", "video.analytics": "view",
        "video.billing": "none", "video.users": "none", "video.settings": "none",
    },
}


DEFAULTS_BY_APP: dict[str, dict[str, dict[str, str]]] = {
    "admin": ADMIN_DEFAULT_PERMISSIONS,
    "video": VIDEO_DEFAULT_PERMISSIONS,
}


def defaults_for(role: str) -> dict[str, str]:
    """Every app's defaults for one role, merged. What the middleware falls back to."""
    merged: dict[str, str] = {}
    for app_defaults in DEFAULTS_BY_APP.values():
        merged.update(app_defaults.get(role, {}))
    return merged


def defaults_for_app(app: str, role: str) -> dict[str, str]:
    """One app's defaults for one role, with every key present."""
    declared = DEFAULTS_BY_APP.get(app, {}).get(role, {})
    return {k: declared.get(k, "none") for k in all_feature_keys(app)}
