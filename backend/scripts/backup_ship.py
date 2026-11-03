from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import tempfile

SKIP_DIRS = {"restore"}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class DirTarget:
    def __init__(self, root: str) -> None:
        self.root = root
        os.makedirs(root, exist_ok=True)

    def _path(self, key: str) -> str:
        full = os.path.normpath(os.path.join(self.root, key))
        if not full.startswith(os.path.normpath(self.root) + os.sep):
            raise ValueError(key)
        return full

    def head(self, key: str) -> dict | None:
        p = self._path(key)
        if not os.path.isfile(p) or not os.path.isfile(p + ".sha256"):
            return None
        with open(p + ".sha256") as fh:
            return {"size": os.path.getsize(p), "sha256": fh.read().strip(),
                    "modified": dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc)}

    def put(self, key: str, path: str, digest: str) -> None:
        p = self._path(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        shutil.copyfile(path, p + ".part")
        os.replace(p + ".part", p)
        with open(p + ".sha256", "w") as fh:
            fh.write(digest)

    def get(self, key: str, dest: str) -> None:
        shutil.copyfile(self._path(key), dest)

    def keys(self, prefix: str = ""):
        base = self._path(prefix) if prefix else self.root
        for d, _, files in os.walk(base):
            for f in files:
                if not f.endswith((".sha256", ".part")):
                    yield os.path.relpath(os.path.join(d, f), self.root)

    def delete(self, key: str) -> None:
        for p in (self._path(key), self._path(key) + ".sha256"):
            if os.path.exists(p):
                os.remove(p)


class S3Target:
    def __init__(self, bucket: str, prefix: str) -> None:
        import boto3

        self.bucket, self.prefix = bucket, prefix.strip("/")
        self.s3 = boto3.client("s3", endpoint_url=os.environ.get("BACKUP_S3_ENDPOINT") or None,
                               aws_access_key_id=os.environ.get("BACKUP_S3_ACCESS_KEY") or None,
                               aws_secret_access_key=os.environ.get("BACKUP_S3_SECRET_KEY") or None,
                               region_name=os.environ.get("BACKUP_S3_REGION") or "ap-south-1")

    def _k(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def head(self, key: str) -> dict | None:
        try:
            r = self.s3.head_object(Bucket=self.bucket, Key=self._k(key))
        except Exception:
            return None
        return {"size": r["ContentLength"], "sha256": r.get("Metadata", {}).get("sha256", ""), "modified": r["LastModified"]}

    def put(self, key: str, path: str, digest: str) -> None:
        self.s3.upload_file(path, self.bucket, self._k(key), ExtraArgs={"Metadata": {"sha256": digest},
                                                                         "ServerSideEncryption": "AES256"})

    def get(self, key: str, dest: str) -> None:
        self.s3.download_file(self.bucket, self._k(key), dest)

    def keys(self, prefix: str = ""):
        pages = self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self._k(prefix))
        cut = len(self.prefix) + 1 if self.prefix else 0
        for page in pages:
            for obj in page.get("Contents", []):
                yield obj["Key"][cut:]

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self._k(key))


def target():
    spec = os.environ.get("BACKUP_TARGET", "")
    if spec.startswith("dir:"):
        return DirTarget(spec[4:])
    if spec.startswith("s3://"):
        bucket, _, prefix = spec[5:].partition("/")
        return S3Target(bucket, prefix)
    sys.exit("BACKUP_TARGET must be s3://bucket/prefix or dir:/path")


def local_files(root: str):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
        for f in sorted(files):
            if f.startswith(".") or f.endswith((".part", ".tmp")):
                continue
            full = os.path.join(d, f)
            yield os.path.relpath(full, root), full


def push(root: str) -> int:
    t = target()
    sent = same = 0
    entries = []
    for key, full in local_files(root):
        digest = sha256(full)
        size = os.path.getsize(full)
        entries.append({"key": key, "size": size, "sha256": digest})
        have = t.head(key)
        if have and have["size"] == size and have["sha256"] == digest:
            same += 1
            continue
        t.put(key, full, digest)
        sent += 1
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest = os.path.join(root, f".manifest-{stamp}.json")
    with open(manifest, "w") as fh:
        json.dump({"at": stamp, "files": entries}, fh)
    t.put(f"manifests/{stamp}.json", manifest, sha256(manifest))
    os.remove(manifest)
    print(f"shipped {sent}, already there {same}, manifest manifests/{stamp}.json")
    return 0


def latest_manifest(t) -> tuple[str, dict]:
    keys = sorted(k for k in t.keys("manifests/") if k.endswith(".json"))
    if not keys:
        sys.exit("no manifest at the target")
    fd, tmp = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        t.get(keys[-1], tmp)
        with open(tmp) as fh:
            return keys[-1], json.load(fh)
    finally:
        os.remove(tmp)


def newest(keys: list[str], kind: str) -> str | None:
    picked = sorted(k for k in keys if (kind == "dump" and k.endswith(".sql.gz") and "/" not in k)
                    or (kind == "base" and k.startswith("base/") and k.endswith("base.tar.gz")))
    return picked[-1] if picked else None


def verify(deep: bool = False, repair: str | None = None) -> int:
    t = target()
    name, m = latest_manifest(t)
    bad = []
    for e in m["files"]:
        h = t.head(e["key"])
        if not h or h["size"] != e["size"] or h["sha256"] != e["sha256"]:
            bad.append(e["key"])
    if deep:
        listed = {e["key"]: e for e in m["files"]}
        fd, tmp = tempfile.mkstemp()
        os.close(fd)
        for key in filter(None, (newest(list(listed), "dump"), newest(list(listed), "base"))):
            if key in bad:
                continue
            t.get(key, tmp)
            if sha256(tmp) != listed[key]["sha256"]:
                bad.append(key)
        os.remove(tmp)
    print(f"{name}: {len(m['files']) - len(bad)} of {len(m['files'])} objects match")
    for k in bad:
        print(f"  missing or different: {k}")
    if bad and repair:
        fixed = 0
        for k in bad:
            local = os.path.join(repair, k)
            if os.path.isfile(local):
                t.put(k, local, sha256(local))
                fixed += 1
        print(f"re-shipped {fixed} of {len(bad)} from {repair}")
        return 0 if fixed == len(bad) else 1
    return 1 if bad else 0


def pull(key: str, dest: str) -> int:
    t = target()
    h = t.head(key)
    if not h:
        sys.exit(f"not at the target: {key}")
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    t.get(key, dest)
    if sha256(dest) != h["sha256"]:
        os.remove(dest)
        sys.exit(f"checksum mismatch for {key}")
    print(f"pulled {key} -> {dest} (sha256 ok)")
    return 0


def latest(kind: str) -> int:
    key = newest(list(target().keys()), kind)
    if not key:
        return 1
    print(key)
    return 0


def prune(root: str, days: int, base_days: int, tax_years: int) -> int:
    t = target()
    now = dt.datetime.now(dt.timezone.utc)
    local = {k for k, _ in local_files(root)}
    months: dict[str, str] = {}
    dumps = sorted(k for k in t.keys() if k.endswith(".sql.gz") and "/" not in k)
    for k in dumps:
        stamp = k.rsplit("_", 2)[-2] if k.count("_") >= 2 else ""
        if len(stamp) == 8 and stamp[:6] not in months:
            months[stamp[:6]] = k
    keep_monthly = set(months.values())
    removed = 0
    for k in list(t.keys()):
        if k.startswith("manifests/"):
            continue
        h = t.head(k)
        if not h:
            continue
        age = (now - h["modified"]).days
        if k in dumps:
            if age > days and not (k in keep_monthly and age <= tax_years * 366):
                t.delete(k)
                removed += 1
        elif (k.startswith("base/") or k.startswith("wal/")) and k not in local and age > base_days:
            t.delete(k)
            removed += 1
    manifests = sorted(k for k in t.keys("manifests/"))
    for k in manifests[:-60]:
        t.delete(k)
        removed += 1
    print(f"pruned {removed}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="backup_ship")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("push")
    p.add_argument("root")
    p = sub.add_parser("verify")
    p.add_argument("--deep", action="store_true")
    p.add_argument("--repair", metavar="ROOT")
    p = sub.add_parser("pull")
    p.add_argument("key")
    p.add_argument("dest")
    p = sub.add_parser("latest")
    p.add_argument("kind", choices=["dump", "base"])
    p = sub.add_parser("prune")
    p.add_argument("root")
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--base-days", type=int, default=14)
    p.add_argument("--tax-years", type=int, default=7)
    a = ap.parse_args()
    if a.cmd == "push":
        return push(a.root)
    if a.cmd == "verify":
        return verify(a.deep, a.repair)
    if a.cmd == "pull":
        return pull(a.key, a.dest)
    if a.cmd == "latest":
        return latest(a.kind)
    return prune(a.root, a.days, a.base_days, a.tax_years)


if __name__ == "__main__":
    sys.exit(main())
