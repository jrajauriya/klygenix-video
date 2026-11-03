"""Any S3-compatible bucket.

One adapter covers AWS S3, Cloudflare R2 and MinIO, because all three speak the same
API. Which one a deployment uses is S3_ENDPOINT and S3_REGION, not a code change — and
that is deliberate: §22 wants Indian financial data on Indian infrastructure, and that
constraint should be settled in configuration rather than re-implemented.
"""

from __future__ import annotations

import hashlib

from app.config import settings
from app.video.storage.base import Stored, StorageError


class S3Storage:
    name = "s3"

    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        if not settings.S3_BUCKET:
            raise StorageError("No S3 bucket is configured.")

        self.bucket = settings.S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT or None,
            region_name=settings.S3_REGION or None,
            aws_access_key_id=settings.S3_ACCESS_KEY or None,
            aws_secret_access_key=settings.S3_SECRET_KEY or None,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    def put(self, key: str, data: bytes, content_type: str) -> Stored:
        try:
            self.client.put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
            )
        except Exception as exc:
            raise StorageError(str(exc)[:200]) from exc
        return Stored(
            key=key,
            size_bytes=len(data),
            checksum=hashlib.sha256(data).hexdigest(),
            backend=self.name,
        )

    def get(self, key: str) -> bytes:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as exc:
            raise StorageError(str(exc)[:200]) from exc

    def delete(self, key: str) -> None:
        """Versioned buckets keep the old object, which §23 requires: a signed
        e-invoice payload must not be overwritable."""
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            raise StorageError(str(exc)[:200]) from exc

    def signed_url(self, key: str, *, ttl_seconds: int = 300) -> str | None:
        try:
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=ttl_seconds,
            )
        except Exception:
            return None
