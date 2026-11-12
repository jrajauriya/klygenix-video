# Backups and point-in-time recovery

§23: *"Continuous archiving with point-in-time recovery. A nightly pg_dump alone cannot undo a
bad migration at 14:20."* This is how that is done here, and how to get a database back.

## What runs

| What | Where | How often | Kept |
|---|---|---|---|
| WAL archive | `/opt/klygenix-video/backups/wal` | every segment, and at least every 5 minutes (`archive_timeout=300`) | back to the oldest base backup |
| Base backup | `/opt/klygenix-video/backups/base/<stamp>` | nightly, `infra/basebackup.sh` at 02:30 | 14 days (`BASE_KEEP_DAYS`) |
| Logical dump | `/opt/klygenix-video/backups/*.sql.gz` | nightly, `infra/backup.sh` at 03:00 | 30 days |

The archive settings live in `docker-compose.prod.yml` on the `postgres` service. The logical
dump stays as a second, independent copy you can read with nothing but `psql`.

The service's entrypoint chowns `/wal-archive` and `/backups` to the `postgres` user before
PostgreSQL starts. Docker creates missing bind-mount directories as `root:root 755`, and
`archive_command` and `pg_basebackup` run as `postgres`: without the chown every segment fails
with `cp: … Permission denied`, WAL piles up in `pg_wal` until the disk fills, and there is no
base backup either. The local stack caught this (27 Sep 2026). To check a running server:

```bash
docker exec klygenix-video-postgres psql -U klygenix_video -tAc "select archived_count, failed_count, last_failed_wal from pg_stat_archiver"
```

`failed_count` should stay put while `archived_count` climbs.

**Off the host:** `backup.sh` ships the backup folder to R2 (`BACKUP_TARGET`, `BACKUP_S3_*` in `/opt/klygenix-video/infra/backup.env`, cron in `/etc/cron.d/klygenix-video`). Off-host pruning keeps
daily dumps for 30 days and the first dump of every month for 7 years (§23's seven-year rule); base
backups and WAL leave R2 once they are gone from the host and older than 14 days. The bucket is R2 APAC, not versioned.

## Restore to a moment

Pick the moment **just before** the mistake, in UTC, e.g. `2026-10-14 08:49:00+00`.

```bash
# 1. Stop everything that writes. Nothing may write while you restore.
docker compose -f infra/docker-compose.prod.yml stop backend worker scheduler

# 2. Choose the newest base backup taken BEFORE the target moment.
ls /opt/klygenix-video/backups/base

# 3. Restore it beside the live data, never over it.
docker run --rm -v /opt/klygenix-video/backups:/x pgvector/pgvector:pg17 bash -c "
  mkdir -p /x/restore && tar -xzf /x/base/<stamp>/base.tar.gz -C /x/restore \
  && touch /x/restore/recovery.signal \
  && printf \"restore_command = 'cp /wal-archive/%%f %%p'\nrecovery_target_time = '<target>'\nrecovery_target_action = 'promote'\n\" >> /x/restore/postgresql.auto.conf \
  && chown -R postgres:postgres /x/restore && chmod 700 /x/restore"

# 4. Start a database on it and let it replay to the target.
docker run -d --name klygenix-video-restore -e PGDATA=/restore \
  -v /opt/klygenix-video/backups/restore:/restore \
  -v /opt/klygenix-video/backups/wal:/wal-archive:ro pgvector/pgvector:pg17
docker exec klygenix-video-restore psql -U klygenix_video -c "select pg_is_in_recovery()"   # until 'f'

# 5. Check it is the database you wanted, before switching anything.
#    The two identities infra/restore.sh checks, AR control ≡ open receivables and
#    gateway clearing ≡ paid-not-received, apply here too.

# 6. Only then point production at it: swap it in as the pgdata volume (or pg_dump it and
#    load it), start backend, worker and scheduler, and write down how long it took.
```

The WAL archive is mounted **read-only** into the restore, so a restore can never damage the
archive it is replaying from.

## Rehearsal

```bash
bash infra/pitr-rehearse.sh                                            # toy database, CI
PITR_SEED_FROM=klygenix-video-postgres bash infra/pitr-rehearse.sh     # with a copy of the real schema and data
```

Needs Docker and the `pgvector/pgvector:pg17` image (the one production runs), nothing else — no ports are published and nothing
is written outside a `mktemp` directory, which is removed on exit with both containers
(`klygenix-video-pitr-src-<pid>`, `klygenix-video-pitr-dst-<pid>`).

It does the whole thing with the production settings (`wal_level=replica`, `archive_mode=on`,
the same `archive_command`): starts a scratch source that archives its WAL, takes a
compressed base backup with `pg_basebackup -Ft -z -X fetch`, runs the `pg_archivecleanup`
that `basebackup.sh` runs, writes rows, notes the time, then drops a table and deletes rows,
restores the base backup into a second container with `recovery_target_time` set to the
noted moment, and checks every row written before the mistake came back and the dropped
table is there again.

`PITR_SEED_FROM=<container>` first loads the scratch source from `pg_dump` of that
container (`PITR_SEED_DB`, `PITR_SEED_USER`, both default `klygenix_video`) and also checks
every `kv_*` table and every order survived the restore. The dump only reads the named
container; the dev database is never written. On the dev stack (26 Sep 2026: 88 `kv_*`
tables) it passes 9/9 and replays to the target in about 4 s, 16 s end to end.

On production, run it on the VPS the same way, pointing at the live container — the dump is
read-only and the load goes into the scratch container:

```bash
PITR_SEED_FROM=klygenix-video-postgres bash /opt/klygenix-video/infra/pitr-rehearse.sh
```

**The quarterly rehearsal §23 asks for is the "Restore to a moment" procedure above on
staging, against a real-sized database and the real `/opt/klygenix-video/backups`, timed.**
That timing is the number that matters in an incident, and on a toy database it means nothing.
