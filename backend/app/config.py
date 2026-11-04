from pydantic_settings import BaseSettings
from pydantic import field_validator

from app.core.services import secrets


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://klygenix_video:klygenix_video@localhost:25436/klygenix_video"
    APP_DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    BUYER_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30

    GLOBAL_ADMIN_EMAIL: str = "admin@klygenix.com"
    GLOBAL_ADMIN_PASSWORD: str = "admin123"
    GLOBAL_ADMIN_NAME: str = "Global Admin"

    BRAND_NAME: str = "Klygenix Play"
    PUBLIC_DOMAIN: str = "play.klygenix.com"
    ADMIN_TENANT_SLUG: str = "klygenix-video-admin"
    ADMIN_TENANT_NAME: str = "Klygenix Technologies Private Limited"
    ADMIN_CHANNEL_HANDLE: str = "klygenix"
    APP_LOGIN_URL: str = "http://localhost:5302/login"
    STUDIO_APP_URL: str = "http://localhost:5301"
    WEB_BASE_URL: str = "http://localhost:5300"
    API_PUBLIC_BASE_URL: str = "http://localhost:9300"

    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""
    RAZORPAY_API_BASE: str = "https://api.razorpay.com/v1"
    LEMONSQUEEZY_API_KEY: str = ""
    LEMONSQUEEZY_WEBHOOK_SECRET: str = ""
    LEMONSQUEEZY_STORE_ID: str = ""
    LEMONSQUEEZY_VARIANT_ID: str = ""
    IMPERSONATION_MINUTES: int = 60
    PAYMENT_RAIL: str = "auto"
    ROUTE_PROFILE_CATEGORY: str = ""
    ROUTE_PROFILE_SUBCATEGORY: str = ""
    MARKETPLACE_RESERVE_BPS: int = 500
    MARKETPLACE_RESERVE_DAYS: int = 30
    REFUND_WINDOW_DAYS: int = 7
    TIP_MIN_MINOR: int = 1000
    TIP_MAX_MINOR: int = 1000000

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    CORS_ORIGINS: str = (
        "http://localhost:5300,http://localhost:5301,http://localhost:5302,"
        "http://localhost:5310,http://localhost:5311,http://localhost:5312,http://localhost:8082,"
        "http://localhost:5303,http://localhost:5313"
    )

    REDIS_URL: str = "redis://localhost:16383/0"

    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = "contact@klygenix.com"
    SMTP_FROM_NAME: str = "Klygenix Play"
    MS_GRAPH_TENANT_ID: str = ""
    MS_GRAPH_CLIENT_ID: str = ""
    MS_GRAPH_CLIENT_SECRET: str = ""
    MS_GRAPH_SENDER: str = ""
    MS_GRAPH_SECRET_EXPIRES: str = ""
    MS_GRAPH_LOGIN_BASE: str = "https://login.microsoftonline.com"
    MS_GRAPH_API_BASE: str = "https://graph.microsoft.com/v1.0"

    JOBS_MODE: str = "inline"
    SANDBOX_WEBHOOK_SECRET: str = "sandbox-webhook-secret"
    SANDBOX_ENABLED: bool = True
    SIGNUP_ENABLED: bool = True
    REGION: str = "in"
    REGION_ENFORCE: bool = False
    REGION_URLS: str = ""
    REGION_US_COUNTRIES: str = "US,CA"
    SIGNUP_MODE: str = ""
    CREATOR_SIGNUP: str = "open"
    EMAIL_PROVIDER: str = "sandbox"
    COUNTER_NOTICE_RESTORE_DAYS: int = 10
    ADS_ENABLED: bool = True
    ADS_CREATOR_SHARE_BPS: int = 5500
    ADS_FREQ_CAP: int = 3
    ADS_PER_VIEWER_HOUR: int = 6
    ADS_MIN_CPM_MINOR: int = 5000
    ADS_MIN_TOPUP_MINOR: int = 100000
    ADS_MAX_TOPUP_MINOR: int = 100000000
    ADS_IVT_MAX_PER_10M: int = 30
    ADS_IVT_CIDRS: str = ""
    SPONSORSHIP_COMMISSION_BPS: int = 1000
    SPONSORSHIP_AUTO_APPROVE_DAYS: int = 7
    ADS_VIEW_POOL_BPS: int = 1000
    VIEW_POOL_MIN_MINUTES: int = 60
    RECO_MODEL: str = "off"
    RECO_AB_PERCENT: int = 50
    RECO_LOG_SAMPLE: float = 1.0
    RECO_MIN_ROWS: int = 200
    RECO_MIN_TEST_ROWS: int = 100
    TAKEDOWN_SLA_HOURS: str = "intimate:24/24,court_order:24/36,copyright:24/360,it_rules:24/360,other:24/360"
    WEB_INDEX_PATH: str = "../apps/web/dist/index.html"

    ACTIVITY_LOG_RETENTION_DAYS: int = 90
    LOG_LEVEL: str = "INFO"

    RATE_LIMITS_ENABLED: bool = True
    RATE_LIMIT_EXEMPT_IPS: str = "127.0.0.1,::1"
    RL_CHECKOUT_CREATE_PER_MIN: int = 20
    RL_CHECKOUT_WRITE_PER_MIN: int = 60
    RL_CHECKOUT_EACH_PER_MIN: int = 30
    RL_SANDBOX_PAY_PER_MIN: int = 30
    RL_SIGNIN_EMAIL_PER_HOUR: int = 5
    RL_SIGNIN_IP_PER_HOUR: int = 30
    RL_REPORT_PER_HOUR: int = 10
    RL_LOGIN_IP_PER_HOUR: int = 60
    RL_LOGIN_EMAIL_PER_HOUR: int = 30
    RL_OBSERVE_TUNNEL_PER_MIN: int = 60
    RL_DANMAKU_PER_MIN: int = 20
    RL_COMMENT_PER_MIN: int = 10
    RL_ASK_PER_MIN: int = 10
    RL_SEARCH_PER_MIN: int = 60
    RL_UPLOAD_PER_HOUR: int = 30
    METRICS_TOKEN: str = ""
    SENTRY_DSN: str = ""
    SENTRY_BROWSER_DSN: str = ""
    SENTRY_ENVIRONMENT: str = ""
    SENTRY_RELEASE: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0
    ERROR_TRACKING_DEBUG_ROUTES: bool = False

    S3_ENDPOINT: str = ""
    S3_BUCKET: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = "auto"
    DOWNLOAD_URL_TTL_SECONDS: int = 300
    MEDIA_WORK_DIR: str = "private_uploads/work"

    VIDEO_PROVIDER: str = "sandbox"
    BUNNY_API_BASE: str = "https://video.bunnycdn.com"
    BUNNY_LIBRARY_ID: str = ""
    BUNNY_API_KEY: str = ""
    BUNNY_TOKEN_KEY: str = ""
    BUNNY_CDN_HOST: str = ""
    BUNNY_WEBHOOK_SECRET: str = ""
    PLAYBACK_TTL_SECONDS: int = 6 * 3600
    MAX_UPLOAD_MB: int = 4096
    REEL_MAX_SECONDS: int = 90

    STT_PROVIDER: str = "sandbox"
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_REGION: str = "centralindia"
    OPENAI_TRANSCRIBE_URL: str = ""
    OPENAI_TRANSCRIBE_KEY: str = ""
    STT_COST_PER_MIN_MINOR: int = 0

    LLM_PROVIDER: str = "sandbox"
    LLM_BASE_URL: str = ""
    LLM_API_KEY: str = ""
    LLM_MODEL: str = ""
    LLM_MODEL_FAST: str = ""
    LLM_TIMEOUT_SECONDS: int = 120
    LLM_RETRIES: int = 2
    LLM_MAX_OUTPUT_TOKENS: int = 4000
    LLM_MONTHLY_BUDGET_MINOR: int = 500000
    LLM_INPUT_COST_PER_MTOK_MINOR: int = 0
    LLM_OUTPUT_COST_PER_MTOK_MINOR: int = 0

    EMBED_PROVIDER: str = "sandbox"
    EMBED_URL: str = ""
    EMBED_MODEL: str = "text-embedding-3-small"
    EMBED_DIM: int = 1536

    SCAN_PROVIDER: str = "sandbox"
    SCAN_API_URL: str = ""
    SCAN_API_KEY: str = ""

    YOUTUBE_PROVIDER: str = "sandbox"
    FACE_PROVIDER: str = "sandbox"
    PUBLISH_PROVIDER: str = "sandbox"
    LIVE_PROVIDER: str = "sandbox"
    LIVE_RTMP_HOST: str = "localhost"
    LIVE_GATE_BIND: str = "127.0.0.1"
    LIVE_RTMP_PORTS: str = "19350-19359"
    LIVE_IDLE_END_SECONDS: int = 45
    LIVE_WORKER_INLINE: bool = True
    CF_ACCOUNT_ID: str = ""
    PUSH_PROVIDER: str = "sandbox"
    INSTAGRAM_PROVIDER: str = "sandbox"
    INSTAGRAM_APP_ID: str = ""
    INSTAGRAM_APP_SECRET: str = ""
    EXPO_ACCESS_TOKEN: str = ""
    CF_STREAM_TOKEN: str = ""
    CF_STREAM_CUSTOMER_HOST: str = ""
    CF_STREAM_SIGNING_KEY_ID: str = ""
    CF_STREAM_SIGNING_KEY: str = ""
    CF_STREAM_WEBHOOK_SECRET: str = ""
    CF_NOTIFY_SECRET: str = ""
    TTS_PROVIDER: str = "sandbox"
    IMAGE_PROVIDER: str = "sandbox"
    IMAGE_API_URL: str = ""
    IMAGE_API_KEY: str = ""
    AZURE_TTS_KEY: str = ""
    AZURE_TTS_REGION: str = "centralindia"
    YOUTUBE_API_BASE: str = "https://www.googleapis.com/youtube/v3"
    YOUTUBE_OAUTH_REDIRECT: str = "http://localhost:9300/api/video/channels/youtube/callback"

    ASK_FREE_PER_DAY: int = 5

    @field_validator(
        "SMTP_PASSWORD", "MS_GRAPH_CLIENT_SECRET", "S3_SECRET_KEY",
        "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "LEMONSQUEEZY_API_KEY",
        "LEMONSQUEEZY_WEBHOOK_SECRET", "BUNNY_API_KEY", "BUNNY_TOKEN_KEY", "BUNNY_WEBHOOK_SECRET",
        "AZURE_SPEECH_KEY", "OPENAI_TRANSCRIBE_KEY", "LLM_API_KEY", "LLM_BASE_URL",
        "SCAN_API_KEY", "GOOGLE_CLIENT_SECRET", "INSTAGRAM_APP_SECRET", "EXPO_ACCESS_TOKEN", "AZURE_TTS_KEY",
        "CF_STREAM_TOKEN", "CF_STREAM_SIGNING_KEY", "CF_STREAM_WEBHOOK_SECRET", "CF_NOTIFY_SECRET", "IMAGE_API_KEY",
        mode="after",
    )
    @classmethod
    def _decrypt(cls, value: str) -> str:
        return secrets.resolve(value)

    @property
    def app_database_url(self) -> str:
        return self.APP_DATABASE_URL or self.DATABASE_URL

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def llm_configured(self) -> bool:
        return self.LLM_PROVIDER == "sandbox" or bool(self.LLM_BASE_URL and self.LLM_API_KEY and self.LLM_MODEL)

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
