"""Prepare a NEW portable knowledge vault; never edit an existing source vault.

Stop editors/sync before copying. Existing valid IDs and attachment bytes survive.
The manifest records original hashes, generated IDs and destination hashes.
An interrupted destination is deliberately retained for inspection, never reused.
"""
import argparse, hashlib, json, os, re, shutil, uuid
from pathlib import Path

def prepare(source: Path, destination: Path):
    if source.is_symlink(): raise ValueError('symlink source root')
    source=source.resolve(strict=True)
    destination=destination.absolute()
    if source==destination or source in destination.resolve().parents or destination.resolve() in source.parents:
        raise ValueError('source and destination must be separate sibling trees')
    destination.mkdir(exist_ok=False)
    rows=[];ids=set();total=0
    for current, dirs, files in os.walk(source, followlinks=False):
        base=Path(current)
        for name in dirs+files:
            if (base/name).is_symlink(): raise ValueError('symlink in source')
        dirs[:]=sorted(d for d in dirs if not d.startswith('.'))
        for name in sorted(files):
            if name.startswith('.'): continue
            original=base/name;rel=original.relative_to(source)
            if len(rel.parts)>31 or any(':' in p or '\\' in p for p in rel.parts):raise ValueError('unsupported path')
            stat=original.stat();total+=stat.st_size
            if not original.is_file() or len(rows)>=100000 or total>16*1024**3:raise ValueError('source bounds exceeded')
            target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True)
            source_hash=hashlib.sha256();dest_hash=hashlib.sha256();source_id=None
            if name.lower().endswith('.md'):
                if stat.st_size>4*1024**2-128:raise ValueError('Markdown exceeds daemon limit')
                raw=original.read_bytes();source_hash.update(raw)
                text=raw.decode('utf-8-sig')
                if '\0' in text:raise ValueError('NUL in Markdown')
                newline='\r\n' if text.startswith('---\r\n') else '\n'
                normalized=text.replace('\r\n','\n')
                if normalized.startswith('---\n'):
                    end=normalized.find('\n---',4)
                    if end<0 or end>16388:raise ValueError('invalid frontmatter')
                    values=re.findall(r'^loklm_id:(.*)$',normalized[4:end],re.MULTILINE)
                else:values=[]
                if values:
                    if len(values)!=1:raise ValueError('duplicate ID field')
                    source_id=str(uuid.UUID(values[0].strip().strip('\"\'')))
                    output=raw
                else:
                    source_id=str(uuid.uuid4())
                    if normalized.startswith('---\n'):
                        text='---'+newline+'loklm_id: '+source_id+newline+text[len('---'+newline):]
                    else:text='---\nloklm_id: '+source_id+'\n---\n'+text
                    output=text.encode('utf-8')
                if source_id in ids:raise ValueError('duplicate source identity')
                ids.add(source_id)
                with target.open('xb') as f:f.write(output);f.flush();os.fsync(f.fileno())
                dest_hash.update(output)
            else:
                with original.open('rb') as src,target.open('xb') as dst:
                    while block:=src.read(1024*1024):
                        source_hash.update(block);dest_hash.update(block);dst.write(block)
                    dst.flush();os.fsync(dst.fileno())
            after=original.stat()
            if (stat.st_size,stat.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('source changed during copy')
            rows.append(dict(path=rel.as_posix(),source_id=source_id,original_sha256=source_hash.hexdigest(),prepared_sha256=dest_hash.hexdigest()))
    with (destination/'.loklm-import-manifest.json').open('x',encoding='utf-8') as f:json.dump(rows,f,ensure_ascii=False,indent=2)
    return rows

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path)
    args=p.parse_args();rows=prepare(args.source,args.destination)
    print(f'Prepared {len(rows)} files in a new vault; originals unchanged. Hidden app configuration excluded.')
