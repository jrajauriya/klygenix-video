FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends gcc libpq-dev libmagic1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m pip uninstall -y pip

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home --shell /usr/sbin/nologin app

COPY . .

RUN python -m compileall -q /app/app /app/alembic \
    && mkdir -p /app/private_uploads/attachments /app/private_uploads/media /app/private_uploads/work \
    && chown -R app:app /app/private_uploads \
    && chmod 0750 /app/private_uploads

ARG SENTRY_RELEASE=""
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/app \
    WEB_CONCURRENCY=3

USER 10001:10001

EXPOSE 9300

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9300", "--no-server-header"]
