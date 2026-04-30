#!/usr/bin/env python3
"""
Upload .next/ build artifacts to vestnik.zhezu.kz via FTP.

Usage:
  FTP_PASS=... python3 scripts/ftp_upload_next.py [--also-standalone] [--dry-run]

Excludes: cache/, dev/, trace/, diagnostics/

Lives in the repo (not /tmp) so it survives across sessions.
"""
from __future__ import annotations
import argparse
import ftplib
import os
import posixpath
import sys
import time
from pathlib import Path

LOCAL_NEXT = Path(__file__).resolve().parent.parent / ".next"
LOCAL_STANDALONE = LOCAL_NEXT / "standalone"
# Параметризуется через env: REMOTE_ROOT, FTP_HOST, FTP_USER.
# Значения по умолчанию подходят для Hoster.kz Plesk-домена; для другого хостинга — переопределить.
REMOTE_ROOT = os.environ.get("REMOTE_ROOT", "/example.com")
REMOTE_NEXT = f"{REMOTE_ROOT}/.next"
REMOTE_NEXT_NEW = f"{REMOTE_ROOT}/.next.new"
REMOTE_NEXT_BAK = f"{REMOTE_ROOT}/.next.bak"

EXCLUDE_TOP = set(
    os.environ.get(
        "NEXT_DEPLOY_EXCLUDE_TOP",
        "cache,dev,trace,diagnostics",
    ).split(",")
)

HOST = os.environ.get("FTP_HOST", "89.35.125.17")
USER = os.environ.get("FTP_USER", "ftpuser")


def connect(pw: str) -> ftplib.FTP:
    ftp = ftplib.FTP(HOST, timeout=60)
    ftp.login(USER, pw)
    return ftp


def ensure_dir(ftp: ftplib.FTP, path: str) -> None:
    parts = [p for p in path.split("/") if p]
    cur = ""
    for p in parts:
        cur = cur + "/" + p
        try:
            ftp.cwd(cur)
        except ftplib.error_perm:
            ftp.mkd(cur)
            ftp.cwd(cur)


def iter_files(root: Path, skip_top: set[str]):
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        if rel == ".":
            dirnames[:] = [d for d in dirnames if d not in skip_top]
        for f in filenames:
            yield Path(dirpath) / f


def upload(ftp: ftplib.FTP, local: Path, remote: str, dry: bool) -> None:
    ensure_dir(ftp, posixpath.dirname(remote))
    if dry:
        print(f"DRY  {local} → {remote}")
        return
    with open(local, "rb") as fp:
        ftp.storbinary(f"STOR {remote}", fp)


def wipe_remote_cache(ftp: ftplib.FTP, path: str) -> None:
    """Recursively delete `path` on the remote, then recreate it empty."""
    try:
        ftp.cwd(path)
    except ftplib.error_perm:
        # No cache dir — nothing to wipe; just (re)create
        ftp.mkd(path)
        return
    items: list[str] = []
    ftp.retrlines("LIST -a", items.append)
    for line in items:
        name = line.split(None, 8)[-1]
        if name in (".", ".."):
            continue
        full = f"{path}/{name}"
        if line.startswith("d"):
            wipe_remote_cache(ftp, full)
            try:
                ftp.rmd(full)
            except ftplib.error_perm:
                pass
        else:
            try:
                ftp.delete(full)
            except ftplib.error_perm:
                pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--also-standalone", action="store_true",
                    help="Also upload .next/standalone/server.js → /server.js (only after deps change)")
    ap.add_argument("--skip-cache-wipe", action="store_true",
                    help="Don't wipe /.next/cache/ after upload (leaves stale ISR snapshots).")
    ap.add_argument("--blue-green", action="store_true",
                    help="Upload to .next.new/, then atomically swap .next/ → .next.bak / .next.new → .next. "
                         "Reduces inconsistent-state window during deploy from ~13 min to ~1 sec.")
    args = ap.parse_args()

    pw = os.environ.get("FTP_PASS") or os.environ.get("HOSTER_FTP_PASS")
    if not pw:
        print("ERROR: set FTP_PASS env var", file=sys.stderr)
        return 2

    if not LOCAL_NEXT.is_dir():
        print(f"ERROR: {LOCAL_NEXT} not found — run `npm run build` first", file=sys.stderr)
        return 2

    print(f"Connecting to {USER}@{HOST}...", flush=True)
    ftp = connect(pw)
    ftp.cwd(REMOTE_ROOT)
    print(f"✓ Connected, cwd={ftp.pwd()}", flush=True)

    upload_target = REMOTE_NEXT_NEW if args.blue_green else REMOTE_NEXT
    if args.blue_green and not args.dry_run:
        # If a prior deploy crashed mid-upload, .next.new/ may have 1000+ partial files.
        # Recursive delete would take 5-10 min over FTP. Atomic rename is O(1).
        # Discarded dirs are cleaned up after the swap (or by next deploy).
        ts = int(time.time())
        discard = f"{REMOTE_ROOT}/.next.discard.{ts}"
        try:
            ftp.rename(REMOTE_NEXT_NEW, discard)
            print(f"✓ Renamed stale .next.new/ → .next.discard.{ts} (cleanup deferred)", flush=True)
        except ftplib.error_perm:
            # No prior .next.new — first deploy or last one cleaned up
            pass
        ftp.cwd(REMOTE_ROOT)

    files = list(iter_files(LOCAL_NEXT, EXCLUDE_TOP))
    print(f"Uploading {len(files)} files → {upload_target}/ ...")

    t0 = time.time()
    ok = fail = 0
    for i, local in enumerate(files, 1):
        rel = local.relative_to(LOCAL_NEXT).as_posix()
        remote = f"{upload_target}/{rel}"
        try:
            upload(ftp, local, remote, args.dry_run)
            ok += 1
        except Exception as e:
            print(f"  !! {rel}: {e}")
            fail += 1
            try:
                ftp.voidcmd("NOOP")
            except Exception:
                ftp = connect(pw)
                ftp.cwd(REMOTE_ROOT)
        if i % 100 == 0 or i == len(files):
            dt = time.time() - t0
            print(f"  [{i}/{len(files)}] ok={ok} fail={fail} ({dt:.1f}s)", flush=True)

    if args.also_standalone and LOCAL_STANDALONE.is_dir():
        srv = LOCAL_STANDALONE / "server.js"
        if srv.is_file():
            print("Uploading server.js (standalone)...")
            upload(ftp, srv, f"{REMOTE_ROOT}/server.js", args.dry_run)

    # Atomic swap: .next/ → .next.bak, .next.new/ → .next/. ~1 sec window vs 13-min upload.
    if args.blue_green and not args.dry_run:
        ftp.cwd(REMOTE_ROOT)
        # Clean any prior .next.bak first (so the rename doesn't collide)
        try:
            wipe_remote_cache(ftp, REMOTE_NEXT_BAK)
            ftp.rmd(REMOTE_NEXT_BAK)
        except Exception:
            pass
        ftp.cwd(REMOTE_ROOT)
        had_old = False
        try:
            ftp.rename(REMOTE_NEXT, REMOTE_NEXT_BAK)
            had_old = True
        except ftplib.error_perm:
            # First deploy — no .next/ yet
            pass
        try:
            ftp.rename(REMOTE_NEXT_NEW, REMOTE_NEXT)
            print(f"✓ Swapped {REMOTE_NEXT_NEW} → {REMOTE_NEXT}")
        except ftplib.error_perm as e:
            print(f"!! swap failed: {e} — rolling back")
            if had_old:
                try: ftp.rename(REMOTE_NEXT_BAK, REMOTE_NEXT)
                except Exception: pass
            ftp.quit()
            return 3

    # Wipe Next.js ISR cache so first request after restart fetches fresh data.
    # Without this, /api/v1 stats and submission lists can stay stale up to revalidate=300s.
    if not args.dry_run and not args.skip_cache_wipe:
        try:
            ftp.cwd(REMOTE_ROOT)
            wipe_remote_cache(ftp, f"{REMOTE_NEXT}/cache")
            print("✓ Wiped .next/cache/ (ISR reset)")
        except Exception as e:
            print(f"!! cache wipe: {e}")
            try: ftp.voidcmd("NOOP")
            except Exception:
                ftp = connect(pw)
                ftp.cwd(REMOTE_ROOT)

    # touch restart.txt
    if not args.dry_run:
        try:
            ftp.cwd(REMOTE_ROOT)
            ensure_dir(ftp, f"{REMOTE_ROOT}/tmp")
            from io import BytesIO
            ftp.storbinary(f"STOR {REMOTE_ROOT}/tmp/restart.txt", BytesIO(b""))
            print("✓ Touched tmp/restart.txt (Passenger restart)")
        except Exception as e:
            print(f"!! restart.txt: {e}")

    # Cleanup .next.bak and any .next.discard.* dirs after successful swap+restart.
    # Site is already live on the new build — if cleanup takes a while or even fails,
    # nothing breaks. Best-effort.
    if args.blue_green and not args.dry_run:
        cleanup_targets = [REMOTE_NEXT_BAK]
        # Find leftover discard dirs from prior crashes
        try:
            ftp.cwd(REMOTE_ROOT)
            entries: list[str] = []
            ftp.retrlines("LIST -a", entries.append)
            for line in entries:
                name = line.split(None, 8)[-1]
                if name.startswith(".next.discard."):
                    cleanup_targets.append(f"{REMOTE_ROOT}/{name}")
        except Exception:
            pass
        for target in cleanup_targets:
            try:
                wipe_remote_cache(ftp, target)
                ftp.rmd(target)
                print(f"✓ Removed {target.split('/')[-1]} (post-deploy cleanup)", flush=True)
            except Exception:
                pass

    ftp.quit()
    print(f"Done. ok={ok} fail={fail} elapsed={time.time()-t0:.1f}s")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
