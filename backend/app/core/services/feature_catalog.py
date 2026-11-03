"""Per-tenant feature catalogue.

Single source of truth for the menu items the global admin can toggle on or off per
tenant. The catalogue is static — defined here, in code. The *toggle state* lives in
`kv_admin.tenant_features`, and a missing row means enabled.

To add a feature: append a row to the appropriate group below, then seed the key in
`db-scripts/02-reference-data.sql`. To add a whole app, see the master plan §06 — a group
here, the app key in GATEABLE_APPS, a sidebar entry, and the route wrapped in
ProtectedRoute.

Key naming: every key is prefixed with the app that owns it. The master estate's ERP
app spans five prefixes (billing.*, erp.*, compliance.*, ops.*, reports.*), which makes
"which app owns this key" a scan rather than a split. Do not repeat that here.
"""

from typing import TypedDict


class FeatureItem(TypedDict):
    key: str
    label: str


class FeatureGroup(TypedDict):
    label: str
    items: list[FeatureItem]


class FeatureApp(TypedDict):
    label: str
    groups: list[FeatureGroup]


def _items(*pairs: tuple[str, str]) -> list[FeatureItem]:
    return [{"key": k, "label": l} for k, l in pairs]


FEATURE_CATALOG: dict[str, FeatureApp] = {
    "admin": {
        "label": "Admin Console",
        "groups": [
            {
                "label": "Platform",
                "items": _items(
                    ("admin.dashboard", "Dashboard"),
                    ("admin.tenants", "Accounts"),
                    ("admin.moderation", "Moderation & reports"),
                    ("admin.takedowns", "Takedowns & grievances"),
                    ("admin.ai_usage", "AI usage & cost"),
                    ("admin.money", "Creator money & refunds"),
                    ("admin.plans", "Plans"),
                    ("admin.logs", "Activity Log"),
                ),
            },
            {
                "label": "Configuration",
                "items": _items(
                    ("admin.email", "Email Config"),
                ),
            },
            {
                "label": "Administration",
                "items": _items(
                    ("admin.team", "Users & Roles"),
                    ("admin.settings", "Settings"),
                ),
            },
        ],
    },
    "video": {
        "label": "Klygenix Play Studio",
        "groups": [
            {
                "label": "Create",
                "items": _items(
                    ("video.dashboard", "Dashboard"),
                    ("video.uploads", "Videos & uploads"),
                    ("video.clips", "Clip maker"),
                    ("video.channels", "Channel & connected accounts"),
                ),
            },
            {
                "label": "Audience",
                "items": _items(
                    ("video.comments", "Comments & danmaku"),
                    ("video.analytics", "Analytics"),
                ),
            },
            {
                "label": "Operations",
                "items": _items(
                    ("video.earnings", "Earnings & payouts"),
                    ("video.billing", "Plan & billing"),
                    ("video.users", "Users & Roles"),
                    ("video.settings", "Settings"),
                ),
            },
        ],
    },
}


# Apps whose sidebars actually consult `kv_admin.tenant_features`. The admin console is
# in the catalogue so its permission matrix can be server-driven, but it gates on
# role_permissions only — it is the platform console, not a tenant-purchasable app, so
# per-tenant toggles for it would be meaningless.
GATEABLE_APPS: tuple[str, ...] = ("video",)


def all_feature_keys(app: str | None = None) -> list[str]:
    """Flat list of every feature key in the catalogue, or of one app."""
    apps = [FEATURE_CATALOG[app]] if app else list(FEATURE_CATALOG.values())
    return [item["key"] for a in apps for g in a["groups"] for item in g["items"]]


def is_known_feature(key: str) -> bool:
    return key in set(all_feature_keys())


def default_feature_map(apps: list[str] | None = None) -> dict[str, bool]:
    """Max-permissive default: every key in the listed apps enabled.

    Used when the admin first enables an app for a tenant — every menu item starts on,
    and the admin unchecks what the customer did not buy.
    """
    if apps is None:
        apps = list(FEATURE_CATALOG.keys())
    return {k: True for app in apps for k in all_feature_keys(app)}
