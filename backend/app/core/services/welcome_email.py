from app.config import settings

PRODUCT_URLS = {
    "video": settings.STUDIO_APP_URL,
}

PRODUCT_NAMES = {
    "video": "Klygenix Play Studio",
}


def _build_product_links(products: list[str]) -> str:
    """Build HTML for product login links."""
    if not products:
        return ""

    links = []
    for p in products:
        url = PRODUCT_URLS.get(p)
        name = PRODUCT_NAMES.get(p, p.upper())
        if url:
            links.append(
                f'<a href="{url}/login" style="display:inline-block;padding:10px 20px;'
                f'background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;'
                f'font-weight:bold;margin-right:8px;margin-bottom:8px;">'
                f'Login to {name}</a>'
            )

    if not links:
        return ""

    return (
        '<p style="margin-top:16px;"><strong>Your product access:</strong></p>'
        f'<div style="margin:12px 0;">{"".join(links)}</div>'
    )


def build_welcome_html(
    user_name: str,
    email: str,
    password: str,
    login_url: str,
    tenant_name: str,
    products: list[str] | None = None,
    message: str | None = None,
) -> str:
    product_links = _build_product_links(products) if products else ""

    return f"""
    <div style="font-family:Arial,sans-serif;max-width:500px;">
        <h2 style="color:#1a1a1a;">Welcome to {tenant_name}!</h2>
        <p>Hi {user_name},</p>
        <p>{message or "Your account has been created. Here are your login credentials:"}</p>
        <table style="margin:16px 0;border-collapse:collapse;">
            <tr>
                <td style="padding:6px 12px;font-weight:bold;color:#555;">Email</td>
                <td style="padding:6px 12px;">{email}</td>
            </tr>
            <tr>
                <td style="padding:6px 12px;font-weight:bold;color:#555;">Password</td>
                <td style="padding:6px 12px;font-family:monospace;background:#f5f5f5;border-radius:4px;">{password}</td>
            </tr>
        </table>
        {product_links}
        <p style="color:#888;font-size:13px;">You can change your password after logging in.</p>
    </div>
    """
