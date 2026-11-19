"""Read-only Linux host checks before starting the fresh Compose stack.

Uses Docker Compose's own env/interpolation mechanism. Resolved credentials are
kept in subprocess memory and never printed. No files/containers are created.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import subprocess


def checks(config):
    issues = []
    services = config.get('services', {})
    for name, service in services.items():
        mounts = service.get('tmpfs', [])
        if isinstance(mounts, str):
            mounts = [mounts]
        for mount in mounts:
            if not isinstance(mount, str) or not mount.split(':', 1)[0].startswith('/'):
                issues.append(name + ': tmpfs entries must start with an absolute mount path; quote comma-containing YAML values')
    directories = {}
    for service, target, label in (
        ('knowledge', '/knowledge', 'knowledge'), ('knowledge', '/index', 'index'),
        ('livesync', '/state', 'sync_state'), ('couchdb', '/opt/couchdb/data', 'couchdb_data'),
    ):
        mounts = [v for v in services.get(service, {}).get('volumes', [])
                  if v.get('type') == 'bind' and v.get('target') == target]
        if len(mounts) != 1:
            issues.append(label + ': missing unique bind mount')
            continue
        path = Path(mounts[0]['source'])
        if not path.is_absolute() or not path.is_dir():
            issues.append(label + ': absolute existing directory required')
            continue
        if any(p.is_symlink() for p in (path, *path.parents)):
            issues.append(label + ': linked directory is not accepted')
            continue
        directories[label] = path.resolve()
    vault = directories.get('knowledge')
    if vault:
        for label, path in directories.items():
            if label != 'knowledge' and (path == vault or path.is_relative_to(vault) or vault.is_relative_to(path)):
                issues.append(label + ': must be separate from the knowledge tree')
    paths = list(directories.items())
    for i, (left, a) in enumerate(paths):
        for right, b in paths[i + 1:]:
            if left != 'knowledge' and right != 'knowledge' and (a == b or a.is_relative_to(b) or b.is_relative_to(a)):
                issues.append(left + '/' + right + ': state directories must not overlap')
    for name in ('api_token', 'vault_passphrase'):
        value = config.get('secrets', {}).get(name, {})
        path = Path(value['file']) if isinstance(value.get('file'), str) else None
        if path is None or not path.is_absolute() or path.is_symlink() or not path.is_file():
            issues.append(name + ': private regular secret file required')
            continue
        info = path.stat()
        # Presence/permissions only. Do not read or return credential content.
        if info.st_size == 0:
            issues.append(name + ': secret file is empty')
        if os.name == 'posix' and stat.S_IMODE(info.st_mode) & 0o007:
            issues.append(name + ': secret file must not be accessible to other users')
    for name in ('knowledge', 'livesync'):
        identity = str(services.get(name, {}).get('user', ''))
        parts = identity.split(':')
        if len(parts) != 2 or not all(p.isdecimal() for p in parts) or int(parts[0]) == 0:
            issues.append(name + ': explicit non-root numeric UID:GID required')
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('-f', '--file', action='append', help='Compose file; repeat for overlays')
    parser.add_argument('--env-file', default='.env', help='Existing private Compose env file')
    args = parser.parse_args()
    if os.name != 'posix':
        parser.exit(2, 'Run this host check on Unraid or Linux/WSL where the bind paths exist.\n')
    # Include setup in configuration resolution so Compose retains its otherwise
    # unused passphrase secret. This does not execute the setup service.
    command = ['docker', 'compose', '--profile', 'setup', '--env-file', args.env_file]
    for file in args.file or ['compose.yaml']:
        command += ['-f', file]
    try:
        result = subprocess.run(command + ['config', '--format', 'json'], capture_output=True, text=True, timeout=30)
        if result.returncode:
            parser.exit(2, 'Compose configuration is incomplete. Check the chosen env file and required keys; resolved values are not logged.\n')
        problems = checks(json.loads(result.stdout))
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        parser.exit(2, 'Could not validate the local Compose configuration; no service was started.\n')
    print(json.dumps({'ok': not problems, 'issues': problems, 'scope': 'host paths, identities and secret-file presence only'}, indent=2))
    if not problems:
        print('Host preflight passed. Container startup, mount permissions, indexing and LiveSync readiness still require verification.')
    raise SystemExit(1 if problems else 0)


if __name__ == '__main__':
    main()
