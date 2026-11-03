from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.schema import CreateSchema

from app.config import settings

# Runs as the restricted role; migrations use their own owner engine in alembic/env.py.
engine = create_engine(
    settings.app_database_url,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=10,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


SCHEMAS = (
    "kv_admin",
    "kv_media",
    "kv_social",
    "kv_ai",
    "kv_studio",
    "kv_commerce",
    "kv_ledger",
    "kv_tax",
    "kv_trust",
)


def create_schemas() -> None:
    """Create the schemas if missing. Tables are Alembic's job, and only Alembic's."""
    from sqlalchemy import create_engine as _ce

    owner = _ce(settings.DATABASE_URL, pool_pre_ping=True)
    with owner.connect() as conn:
        for schema in SCHEMAS:
            conn.execute(CreateSchema(schema, if_not_exists=True))
        conn.commit()
    owner.dispose()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
