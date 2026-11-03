from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

from app.config import settings

config = context.config

# The URL comes from app settings, so .env / .env.prod is the single source and
# alembic.ini's value is only a fallback for a bare `alembic` invocation.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Every model package, so autogenerate sees the whole schema. The master estate's
# env.py imports four of its five and has drifted from main.py as a result;
# tests/test_migration_parity.py asserts these two lists agree.
from app.database import Base  # noqa: E402
import app.core.models  # noqa: F401,E402
import app.video.models  # noqa: F401,E402

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
