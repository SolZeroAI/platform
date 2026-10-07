#!/usr/bin/env bash
# Pack the alchemy.new ready deploy archive from the package root.
#
# Recipe:
#   nub install --frozen-lockfile
#   tar -czf alchemy.new.tar.gz --exclude=.git --exclude=alchemy.new.tar.gz .
#
# .npmrc sets enableGlobalVirtualStore=false, so Nub keeps its store in
# node_modules/.store and package links stay inside the project. The archive
# root is this directory. Alchemy builds Workers and the Vite site during
# deploy, so this script does not run a production build.

set -euo pipefail

asset="alchemy.new.tar.gz"
cli="node_modules/alchemy/bin/cli.js"
entry="packages/infra/alchemy.run.ts"

python3 - "$cli" "$entry" <<'PY'
import os
import sys

cli, entry = sys.argv[1:]
root = os.path.realpath(os.getcwd())

def inside(path: str) -> bool:
    resolved = os.path.realpath(path)
    try:
        return os.path.commonpath([root, resolved]) == root
    except ValueError:
        return False

if not os.path.isfile(cli):
    sys.exit(f"Missing {cli}. Install dependencies before packing.")
if not os.path.isfile(entry):
    sys.exit(f"Missing {entry}.")
if not inside(cli):
    sys.exit(f"Alchemy CLI resolves outside the project: {os.path.realpath(cli)}")

escaped: list[str] = []
for dirpath, dirnames, filenames in os.walk("node_modules", followlinks=False):
    for name in [*dirnames, *filenames]:
        path = os.path.join(dirpath, name)
        if os.path.islink(path) and not inside(path):
            escaped.append(f"{path} -> {os.path.realpath(path)}")
            if len(escaped) >= 20:
                break
    if len(escaped) >= 20:
        break
if escaped:
    sys.exit(
        "Dependency symlinks resolve outside the project:\n" + "\n".join(escaped)
    )
PY

# Write the archive outside the tree. GNU tar exits with "file changed as we read
# it" when the archive file is created inside the directory being packed.
stage="$(mktemp)"
cleanup_stage() { rm -f "$stage"; }
trap cleanup_stage EXIT
tar -czf "$stage" --exclude=.git --exclude="$asset" .
trap - EXIT
mv "$stage" "$asset"

python3 - "$asset" "$cli" "$entry" <<'PY'
import os
import sys
import tarfile

asset, cli, entry = sys.argv[1:]
limit = 2 * 1024 * 1024 * 1024
size = os.path.getsize(asset)
if size >= limit:
    sys.exit(f"{asset} is {size} bytes, at or above GitHub's 2 GiB release asset limit.")

def norm(name: str) -> str:
    if name.startswith("./"):
        name = name[2:]
    return name.rstrip("/")

with tarfile.open(asset, "r:gz") as archive:
    members = {norm(member.name): member for member in archive.getmembers()}
members.pop("", None)

if any(name == ".git" or name.startswith(".git/") for name in members):
    sys.exit("Archive contains .git.")
if asset in members:
    sys.exit(f"Archive contains {asset}.")

def resolve(path: str, seen: set[str]) -> tarfile.TarInfo | None:
    path = norm(os.path.normpath(path))
    if path in seen or path == ".." or path.startswith("../"):
        return None
    seen.add(path)
    parts = path.split("/")
    current = ""
    for index, part in enumerate(parts):
        current = part if current == "" else f"{current}/{part}"
        member = members.get(current)
        if member is None:
            prefix = current + "/"
            if index < len(parts) - 1 and any(name.startswith(prefix) for name in members):
                continue
            return None
        if member.issym() or member.islnk():
            link = member.linkname
            if link.startswith("/"):
                return None
            if member.islnk():
                target = norm(link)
            else:
                parent = current.rsplit("/", 1)[0] if "/" in current else ""
                target = os.path.normpath(os.path.join(parent, link))
            if target == ".." or target.startswith("../"):
                return None
            rest = "/".join(parts[index + 1 :])
            target_path = target if rest == "" else f"{target}/{rest}"
            return resolve(target_path, seen)
        if index == len(parts) - 1:
            return member if member.isfile() else None
        if not member.isdir():
            return None
    return None

def require_file(path: str) -> None:
    if resolve(path, set()) is None:
        sys.exit(f"Archive does not contain a file at {path}.")

require_file(cli)
require_file(entry)
print(f"Verified {cli} and {entry} in {asset} ({size} bytes).")
PY
