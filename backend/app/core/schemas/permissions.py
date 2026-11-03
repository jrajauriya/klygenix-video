from pydantic import BaseModel


class PermissionItem(BaseModel):
    permission_key: str
    access_level: str


class RolePermissionsUpdate(BaseModel):
    """The matrix editor posts a map of role -> list of {key, level}."""

    permissions: dict[str, list[PermissionItem]]
