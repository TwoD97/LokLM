"""Private operational checks for the selected Compose project. No raw logs/secrets.

Pass exactly the same --project-name, --env-file and -f overlays as deployment.
doctor never opens the PouchDB database; conflicts requires LiveSync stopped.
"""
import argparse
import json
import re
import subprocess
import uuid


REMOTE_CHECK = r'''
import {readFile} from 'node:fs/promises';
try {
  const s=JSON.parse(await readFile('/state/settings.json','utf8'));
  const url=new URL(encodeURIComponent(s.couchDB_DBNAME),s.couchDB_URI.replace(/\/$/,'')+'/');
  const r=await fetch(url,{headers:{Authorization:'Basic '+Buffer.from(s.couchDB_USER+':'+s.couchDB_PASSWORD).toString('base64')},signal:AbortSignal.timeout(5000)});
  console.log(JSON.stringify({authenticated:r.ok,status:r.status,encrypted:s.encrypt===true}));
} catch { console.log(JSON.stringify({authenticated:false,status:null,encrypted:null})); }
'''


def run(command, *, data=None, timeout=30):
    result = subprocess.run(command, input=data, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Operation failed; inspect selected service locally (raw logs withheld)')
    return result.stdout


def service_states(compose):
    raw = run(compose + ['ps', '--all', '--format', 'json']).strip()
    rows = json.loads(raw) if raw.startswith('[') else [json.loads(line) for line in raw.splitlines() if line]
    return {row['Service']: row['State'] for row in rows}


def conflict_rows(raw):
    """Upstream 1.0.51 ls: path TAB bytes TAB mtime TAB revision[*]."""
    result = []
    files = 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        fields = line.rsplit('\t', 3)
        if len(fields) != 4 or not fields[1].isdigit() or not re.fullmatch(r'\d+-[a-zA-Z0-9]+\*?', fields[3]):
            raise ValueError('Unexpected upstream listing; conflict inventory is unknown')
        files += 1
        if fields[3].endswith('*'):
            result.append({'path': fields[0], 'winning_revision': fields[3][:-1]})
    return {'files': files, 'conflicts': result, 'scope': 'local_upstream_database', 'remote_freshness': 'last_completed_sync'}


def doctor(compose):
    states = service_states(compose)
    local = {'ready': False}
    remote = {'authenticated': False}
    if states.get('knowledge') == 'running':
        # The token never enters argv, terminal output, or this Python process.
        script = 'IFS= read -r token < "$LOKLM_TOKEN_FILE" || test -n "$token"; printf "Authorization: Bearer %s\\n" "$token" | curl --silent --show-error --max-time 8 --header @- http://127.0.0.1:8787/v1/ready'
        try:
            local = json.loads(run(compose + ['exec', '-T', 'knowledge', 'sh', '-c', script]))
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            local = {'ready': False, 'error': 'local_readiness_unavailable'}
    if states.get('livesync') == 'running':
        try:
            remote = json.loads(run(compose + ['exec', '-T', 'livesync', 'node', '--input-type=module', '-'], data=REMOTE_CHECK))
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            remote = {'authenticated': False, 'error': 'remote_check_unavailable'}
    operational = (local.get('ready') is True and remote.get('authenticated') is True
                   and remote.get('encrypted') is True and states.get('couchdb') == 'running')
    return {'operational': operational, 'services': states, 'local_index': local, 'remote': remote,
            'replication_convergence': 'not_measured', 'conflicts': 'run conflicts with LiveSync stopped'}


def conflicts(compose):
    states = service_states(compose)
    if states.get('livesync') not in ('exited', 'created'):
        raise RuntimeError('Stop the selected LiveSync service first; concurrent PouchDB access is refused')
    name = 'loklm-inspect-' + uuid.uuid4().hex[:12]
    try:
        raw = run(compose + ['run', '--rm', '--no-deps', '--name', name, '-T', 'livesync', 'ls'], timeout=90)
        return conflict_rows(raw)
    finally:
        # Only this invocation's unique helper, including after a timeout.
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=20)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-name')
    parser.add_argument('--env-file', default='.env')
    parser.add_argument('-f', '--file', action='append')
    parser.add_argument('command', choices=['doctor', 'conflicts'])
    args = parser.parse_args()
    compose = ['docker', 'compose', '--env-file', args.env_file]
    if args.project_name:
        compose += ['--project-name', args.project_name]
    for file in args.file or ['compose.yaml']:
        compose += ['-f', file]
    try:
        report = doctor(compose) if args.command == 'doctor' else conflicts(compose)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if (report.get('operational') if args.command == 'doctor' else not report['conflicts']) else 1
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        # Never include CalledProcessError/TimeoutExpired strings: argv/logs may be sensitive.
        print(json.dumps({'ok': False, 'error': str(error) if isinstance(error, (RuntimeError, ValueError)) else 'Operational check failed'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
