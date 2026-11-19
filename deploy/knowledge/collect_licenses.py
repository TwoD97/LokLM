"""Copy notices from the exact Cargo-resolved packages into a build artifact."""
import json,shutil,subprocess,sys
from pathlib import Path

manifest,features,destination=sys.argv[1:]
metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--manifest-path',manifest,'--features',features,'--filter-platform','x86_64-unknown-linux-gnu']))
target=Path(destination);target.mkdir(parents=True,exist_ok=True);inventory=[]
for package in sorted(metadata['packages'],key=lambda p:(p['name'],p['version'])):
    root=Path(package['manifest_path']).parent.resolve();files=[]
    candidates=[p for p in root.iterdir() if p.is_file() and p.name.upper().startswith(('LICENSE','COPYING','NOTICE','COPYRIGHT'))]
    if package.get('license_file'):candidates.append(root/package['license_file'])
    for original in sorted(set(candidates)):
        original=original.resolve()
        if root not in original.parents or not original.is_file() or original.stat().st_size>4*1024*1024:continue
        folder=target/(package['name']+'-'+package['version']);folder.mkdir(exist_ok=True)
        shutil.copyfile(original,folder/original.name);files.append(original.name)
    inventory.append({'name':package['name'],'version':package['version'],'license':package['license'],'repository':package['repository'],'notices':files})
(target/'cargo-inventory.json').write_text(json.dumps(inventory,indent=2))
