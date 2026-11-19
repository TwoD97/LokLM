"""Actual fresh Compose/setup, readiness, failure/recovery and isolated restore.

Linux Docker only, synthetic data, unique project names, no host ports/models.
Requires prebuilt images; never builds, pulls, or touches an existing project.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from backup import backup, verify
from manage import doctor, conflicts
from preflight import checks as preflight

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
IMAGES = {
    'knowledge': os.environ.get('LOKLM_KNOWLEDGE_TEST_IMAGE', 'loklm-knowledge:u01-release'),
    'livesync': os.environ.get('LOKLM_LIVESYNC_TEST_IMAGE', 'loklm-test-livesync:1.0.51'),
    'couchdb': os.environ.get('LOKLM_COUCHDB_TEST_IMAGE', 'loklm-test-couchdb:3.5.0'),
}


def run(command, *, check=True, timeout=180):
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Compose startup diagnostics contain resource paths, not credential values.
        # Keep setup/exec logs suppressed; upstream may log private settings.
        detail = result.stderr.decode(errors='replace')[-3000:] if 'up' in command else '(raw logs withheld)'
        raise RuntimeError('Fixture operation failed: ' + command[0] + ': ' + detail)
    return result


def main():
    prefix = 'loklm-accept-' + uuid.uuid4().hex[:12]
    root = Path(tempfile.mkdtemp(prefix=prefix + '-')).resolve()
    root.chmod(0o755)
    projects = []
    passed = []
    started = time.monotonic()

    def expect(condition, label):
        if not condition:
            raise AssertionError(label)
        passed.append(label)
        print('PASS ' + label, flush=True)

    def wait(predicate, label, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if predicate():
                    expect(True, label)
                    return
            except (OSError, ValueError, KeyError, RuntimeError):
                pass
            time.sleep(1)
        raise AssertionError(label)

    def instance(suffix, archive=None):
        folder = root / suffix
        folder.mkdir(mode=0o755)
        for part in ['vault', 'index', 'sync', 'couch']:
            path = folder / part
            if archive and part == 'vault':
                verify(archive)
                verify(archive, path)
            else:
                path.mkdir()
            for current, dirs, files in os.walk(path):
                os.chown(current, 1000, 1000)
                for file in files:
                    os.chown(Path(current) / file, 1000, 1000)
        token = secrets.token_urlsafe(40)
        for name, value in [('api_token', token), ('vault_passphrase', secrets.token_urlsafe(40))]:
            path = folder / name
            path.write_text(value)
            path.chmod(0o400)
            os.chown(path, 1000, 1000)
        env = folder / '.env'
        env.write_text('KNOWLEDGE_PATH=' + str(folder / 'vault') + '\nINDEX_PATH=' + str(folder / 'index')
                       + '\nAPPDATA_PATH=' + str(folder) + '\nLOKLM_UID=1000\nLOKLM_GID=1000\n'
                       + 'COUCHDB_USER=fixture-admin\nCOUCHDB_PASSWORD=' + secrets.token_urlsafe(40) + '\n')
        env.chmod(0o600)
        overlay = folder / 'fixture.json'
        overlay.write_text(json.dumps({'services': {
            'knowledge': {'image': IMAGES['knowledge']},
            'livesync': {'image': IMAGES['livesync'], 'volumes': [str(folder / 'sync') + ':/state']},
            'setup': {'image': IMAGES['livesync'], 'volumes': [str(folder / 'sync') + ':/state']},
            'couchdb': {'image': IMAGES['couchdb'], 'volumes': [str(folder / 'couch') + ':/opt/couchdb/data']},
        }, 'secrets': {name: {'file': str(folder / name)} for name in ['api_token', 'vault_passphrase']}}))
        compose = ['docker', 'compose', '--project-name', prefix + '-' + suffix, '--env-file', str(env),
                   '-f', str(HERE / 'compose.yaml'), '-f', str(overlay)]
        projects.append(compose)
        config = json.loads(run(compose + ['--profile', 'setup', 'config', '--format', 'json']).stdout)
        expect(not preflight(config), suffix + ': host preflight on actual resolved Compose')
        expect(all(not s.get('ports') for s in config['services'].values()), suffix + ': no host ports')
        return {'folder': folder, 'compose': compose, 'token': token}

    def start(item):
        compose = item['compose']
        run(compose + ['up', '--no-build', '--pull', 'never', '-d', '--wait', 'couchdb'])
        run(compose + ['--profile', 'setup', 'run', '--rm', '--no-deps', '-T', 'setup'])
        original = (item['folder'] / 'sync/settings.json').read_bytes()
        again = run(compose + ['--profile', 'setup', 'run', '--rm', '--no-deps', '-T', 'setup'], check=False)
        expect(again.returncode != 0 and (item['folder'] / 'sync/settings.json').read_bytes() == original,
               item['folder'].name + ': setup refuses repeated initialization without changing settings')
        run(compose + ['up', '--no-build', '--pull', 'never', '-d', 'knowledge', 'livesync'])
        wait(lambda: doctor(compose)['operational'], item['folder'].name + ': authenticated local readiness and encrypted remote access')

    def api(item, path, body=None, authorized=True):
        container = run(item['compose'] + ['ps', '-q', 'knowledge']).stdout.decode().strip()
        info = json.loads(run(['docker', 'inspect', container]).stdout)[0]
        ip = next(iter(info['NetworkSettings']['Networks'].values()))['IPAddress']
        headers = {'Content-Type': 'application/json'}
        if authorized:
            headers['Authorization'] = 'Bearer ' + item['token']
        request = urllib.request.Request('http://' + ip + ':8787' + path,
                    data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                data = response.read()
                return response.status, json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            return error.code, None

    try:
        first = instance('first')
        folder = first['folder']
        note_id = str(uuid.uuid4())
        content = '---\nloklm_id: ' + note_id + '\n---\n# Grüße\nSolarstrom fixture with 42 panels.\n'
        note = folder / 'vault/Überblick.md'
        note.write_text(content)
        os.chown(note, 1000, 1000)
        binary = bytes(range(256)) * 1024
        attachment = folder / 'vault/Attachment.bin'
        attachment.write_bytes(binary)
        os.chown(attachment, 1000, 1000)
        start(first)
        expect(api(first, '/healthz', authorized=False)[0] == 200 and
               api(first, '/v1/ready', authorized=False)[0] == 401, 'anonymous liveness and authenticated readiness boundary')
        wait(lambda: api(first, '/v1/status')[1]['index']['sources'] == 1, 'fresh Compose indexes canonical UUID note')
        expect(api(first, '/v1/search', {'query': 'Solarstrom'})[1]['hits'][0]['source_id'] == note_id,
               'actual packaged retrieval returns canonical source')
        run(first['compose'] + ['exec', '-T', 'knowledge', 'test', '-f', '/usr/share/licenses/loklm/dependencies/cargo-inventory.json'])
        expect(True, 'production image includes dependency license inventory')
        bad = folder / 'vault/Invalid.md'
        bad.write_text('Invalid managed note without UUID')
        expect(api(first, '/v1/reconcile', {})[0] == 409, 'invalid source fails explicit reconciliation')
        expect(api(first, '/v1/ready')[0] == 503 and api(first, '/healthz', authorized=False)[0] == 200,
               'process alive does not claim readiness after invalid scan')
        expect(api(first, '/v1/status')[1]['index']['sources'] == 1, 'failed scan preserves checkpoint sources')
        bad.unlink()
        wait(lambda: api(first, '/v1/reconcile', {})[0] == 200, 'corrected source reconciles again')
        expect(doctor(first['compose'])['operational'], 'operational check recovers after invalid source removal')
        run(first['compose'] + ['stop', 'couchdb'])
        expect(not doctor(first['compose'])['operational'] and api(first, '/v1/ready')[0] == 200,
               'CouchDB outage is separate from local index readiness')
        run(first['compose'] + ['up', '--no-build', '--pull', 'never', '-d', '--wait', 'couchdb'])
        wait(lambda: doctor(first['compose'])['operational'], 'remote authentication recovers after CouchDB restart')
        run(first['compose'] + ['restart', 'knowledge'])
        wait(lambda: doctor(first['compose'])['operational'], 'Rust restart requires and completes a new local scan')
        expect(api(first, '/v1/reconcile', {})[1]['embedded'] == 0, 'restart and unchanged reconcile avoid embedding')
        # Stop the actual sync daemon before opening upstream local DB with CLI.
        run(first['compose'] + ['stop', 'livesync', 'knowledge'])
        inventory = conflicts(first['compose'])
        expect(inventory['files'] >= 2 and not inventory['conflicts'], 'upstream CLI inventories real Compose notes and attachment without competing DB owner')
        archive = root / 'source.tar.gz'
        backup(folder / 'vault', archive)
        expect(verify(archive) == 2, 'stopped canonical source backup verifies both files')
        restored = instance('restored', archive)
        expect((restored['folder'] / 'vault/Überblick.md').read_text() == content and
               (restored['folder'] / 'vault/Attachment.bin').read_bytes() == binary,
               'isolated restore preserves Markdown UUID and attachment bytes')
        start(restored)
        wait(lambda: api(restored, '/v1/status')[1]['index']['sources'] == 1,
             'fresh isolated CouchDB and empty derived index accept restored sources')
        expect(api(restored, '/v1/search', {'query': 'Solarstrom'})[1]['hits'][0]['source_id'] == note_id,
               'restored retrieval rebuilds from portable sources')
        expect(first['compose'] != restored['compose'] and
               json.loads((folder / 'sync/settings.json').read_text())['couchDB_PASSWORD'] !=
               json.loads((restored['folder'] / 'sync/settings.json').read_text())['couchDB_PASSWORD'],
               'restore uses separate project, database storage and sync credentials')
        expect(api(restored, '/v1/lock', {})[0] == 204 and api(restored, '/v1/ready')[0] == 423,
               'locked service refuses readiness')
        report = {'checks': passed, 'elapsed_seconds': round(time.monotonic() - started, 2),
                  'source_commit': run(['git', '-C', str(REPO), 'rev-parse', 'HEAD']).stdout.decode().strip(),
                  'images': {}, 'models_loaded': False, 'unraid_tested': False, 'host_ports': [],
                  'attachment_sha256': hashlib.sha256(binary).hexdigest(), 'source_files_sha256': {}}
        for service, image in IMAGES.items():
            info = json.loads(run(['docker', 'image', 'inspect', image]).stdout)[0]
            report['images'][service] = {'tag': image, 'id': info['Id'], 'repo_digests': info['RepoDigests']}
        for path in ['deploy/knowledge/compose.yaml', 'deploy/knowledge/init.mjs', 'deploy/knowledge/manage.py',
                     'deploy/knowledge/test_compose.py', 'native/crates/knowledge/src/service.rs']:
            report['source_files_sha256'][path] = hashlib.sha256((REPO / path).read_bytes()).hexdigest()
        destination = HERE / 'reports'
        destination.mkdir(exist_ok=True)
        (destination / 'compose-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
    finally:
        for compose in reversed(projects):
            run(compose + ['--profile', 'setup', 'down', '--volumes', '--remove-orphans', '--timeout', '15'], check=False)
        if root.parent == Path(tempfile.gettempdir()).resolve() and root.name.startswith(prefix + '-'):
            shutil.rmtree(root)


if __name__ == '__main__':
    main()
