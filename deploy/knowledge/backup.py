"""Portable source backup/restore, independent of every search index.
Pause sync and external editors before backup; never pass the index directory.
No links, traversal, duplicates, devices, or overwrites are accepted on restore.
"""
import argparse, hashlib, io, json, os, tarfile
from pathlib import Path, PurePosixPath

MAX_FILES=100_000
MAX_BYTES=16*1024**3
MANIFEST='LOKLM-BACKUP-MANIFEST.json'

def backup(vault:Path,archive:Path):
    vault=vault.resolve(strict=True)
    if archive.resolve().is_relative_to(vault): raise ValueError('archive must be outside vault')
    manifest={}
    total=0
    # exclusive create avoids replacing an existing backup
    with archive.open('xb') as output, tarfile.open(fileobj=output,mode='w:gz') as tar:
        for root,dirs,files in os.walk(vault,followlinks=False):
            for name in dirs+files:
                if (Path(root)/name).is_symlink():raise ValueError('symlink excluded')
            for name in sorted(files):
                p=Path(root)/name;rel=p.relative_to(vault).as_posix()
                if rel==MANIFEST:raise ValueError('reserved manifest name')
                if not p.is_file():raise ValueError('non-regular source')
                total+=p.stat().st_size
                if len(manifest)>=MAX_FILES or total>MAX_BYTES:raise ValueError('backup exceeds bounds')
                with p.open('rb') as f:
                    before=os.fstat(f.fileno());h=hashlib.file_digest(f,'sha256').hexdigest();f.seek(0)
                    info=tarfile.TarInfo(rel);info.size=before.st_size;info.mode=0o600;info.mtime=int(before.st_mtime)
                    tar.addfile(info,f)
                    after=os.fstat(f.fileno())
                    if before.st_size!=after.st_size or before.st_mtime_ns!=after.st_mtime_ns:raise ValueError('source changed during backup')
                    manifest[rel]={'sha256':h,'size':before.st_size}
        raw=json.dumps({'format':'loklm-source-backup-v1','files':manifest},ensure_ascii=False,sort_keys=True).encode()
        info=tarfile.TarInfo(MANIFEST);info.size=len(raw);info.mode=0o600;tar.addfile(info,io.BytesIO(raw))
    # Manifest only appears on successful complete traversal. Verify after backup.
    verify(archive)

def verify(archive:Path,target:Path|None=None):
    if target is not None:target.mkdir(parents=False,exist_ok=False)
    with tarfile.open(archive,'r:gz') as tar:
        manifest={};actual={};seen=set();total=0
        for member in tar:
            path=PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or ':' in member.name or '\\' in member.name:raise ValueError('unsafe archive path/type')
            if not path.parts or path.as_posix()!=member.name:raise ValueError('noncanonical archive path')
            key=member.name.casefold() if os.name=='nt' else member.name
            if key in seen or len(seen)>MAX_FILES:raise ValueError('duplicate or excessive entries')
            seen.add(key);total+=member.size
            if total>MAX_BYTES:raise ValueError('archive too large')
            stream=tar.extractfile(member)
            if member.name==MANIFEST:
                if member.size>32*1024*1024:raise ValueError('manifest too large')
                manifest=json.load(stream);continue
            h=hashlib.sha256();count=0;out=None
            if target is not None:
                dest=target.joinpath(*path.parts);dest.parent.mkdir(parents=True,exist_ok=True);out=dest.open('xb')
            try:
                while block:=stream.read(1024*1024):
                    h.update(block);count+=len(block)
                    if out:out.write(block)
            finally:
                if out:out.close()
            actual[member.name]={'sha256':h.hexdigest(),'size':count}
        if manifest.get('format')!='loklm-source-backup-v1' or manifest.get('files')!=actual:raise ValueError('incomplete or corrupt source backup')
    return len(actual)

if __name__=='__main__':
    p=argparse.ArgumentParser();s=p.add_subparsers(dest='command',required=True)
    b=s.add_parser('backup');b.add_argument('vault',type=Path);b.add_argument('archive',type=Path)
    v=s.add_parser('verify');v.add_argument('archive',type=Path)
    r=s.add_parser('restore');r.add_argument('archive',type=Path);r.add_argument('destination',type=Path)
    a=p.parse_args()
    if a.command=='backup':backup(a.vault,a.archive)
    elif a.command=='verify':print(verify(a.archive))
    else:
        verify(a.archive) # validate every entry before writing any content
        print(verify(a.archive,a.destination))
