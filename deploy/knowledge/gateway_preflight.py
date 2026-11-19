"""Read-only gateway configuration checks; never read/print private key contents.

Run from deploy/knowledge with the same env file/project and overlays as startup.
This does not validate certificate chains or prove an HTTPS handshake.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess


def checks(config):
    issues = []
    service = config.get('services', {}).get('gateway', {})
    host = service.get('environment', {}).get('LOKLM_TLS_HOST', '')
    if not isinstance(host, str) or len(host) > 253 or not re.fullmatch(
            r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', host):
        issues.append('gateway: configure an ASCII DNS hostname without scheme, port or wildcard')
    else:
        try:
            ipaddress.ip_address(host)
            issues.append('gateway: DNS hostname required, not an IP literal')
        except ValueError:
            pass
    ports = service.get('ports', [])
    if len(ports) != 1 or ports[0].get('target') != 8443:
        issues.append('gateway: exactly one HTTPS port mapping required')
    for port in ports:
        try:
            address = ipaddress.ip_address(port.get('host_ip', ''))
            allowed = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
                       '100.64.0.0/10', '::1/128', 'fc00::/7']
            if not any(address in ipaddress.ip_network(network) for network in allowed):
                raise ValueError()
        except ValueError:
            issues.append('gateway: bind explicitly to loopback or a specific private LAN/VPN address')
    for target, private in [('/run/tls/fullchain.pem', False), ('/run/tls/privkey.pem', True)]:
        mounts = [v for v in service.get('volumes', []) if v.get('target') == target]
        if len(mounts) != 1 or mounts[0].get('type') != 'bind' or not mounts[0].get('read_only'):
            issues.append('gateway: certificate and key require separate read-only bind files')
            continue
        path = Path(mounts[0]['source'])
        if not path.is_absolute() or any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file() or not path.stat().st_size:
            issues.append('gateway: certificate and key must be existing nonempty regular files')
        elif private and os.name == 'posix' and stat.S_IMODE(path.stat().st_mode) & 0o007:
            issues.append('gateway: TLS key must not be accessible to other users')
        if path.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
            issues.append('gateway: certificate and key files must remain outside the checkout')
        for mount in config.get('services', {}).get('knowledge', {}).get('volumes', []):
            if mount.get('target') == '/knowledge' and mount.get('type') == 'bind' and path.resolve().is_relative_to(Path(mount['source']).resolve()):
                issues.append('gateway: never store TLS files in the synchronized canonical vault')
    for name in ('couchdb', 'knowledge'):
        if config.get('services', {}).get(name, {}).get('ports'):
            issues.append(name + ': do not combine direct-port overlays with the TLS peer gateway')
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env')
    parser.add_argument('--project-name')
    parser.add_argument('-f', '--file', action='append')
    args = parser.parse_args()
    command = ['docker', 'compose', '--env-file', args.env_file]
    if args.project_name:
        command += ['--project-name', args.project_name]
    for file in args.file or ['compose.yaml', 'compose.gateway.yaml']:
        command += ['-f', file]
    try:
        result = subprocess.run(command + ['config', '--format', 'json'], capture_output=True, timeout=30)
        if result.returncode:
            raise ValueError()
        issues = checks(json.loads(result.stdout))
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        print(json.dumps({'ok': False, 'error': 'Gateway configuration unavailable; resolved values withheld'}))
        return 2
    print(json.dumps({'ok': not issues, 'issues': issues, 'scope': 'configuration and file presence only'}, indent=2))
    return 1 if issues else 0


if __name__ == '__main__':
    raise SystemExit(main())
