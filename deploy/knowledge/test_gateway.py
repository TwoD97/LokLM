"""Actual isolated Compose HTTPS + upstream LiveSync acceptance; no models.

Requires an explicitly admitted Docker slot, prebuilt existing stack images and
the pinned gateway image already pulled. Synthetic CA/keys are temporary only.
No real user config, production ports, trust-store changes or TLS bypass flags.
"""
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import uuid

from gateway_preflight import checks as gateway_checks

HERE = Path(__file__).resolve().parent
HOST = 'vault.gateway.test'
NGINX = 'nginx:1.30.7-alpine@sha256:bef154735288bc38d99fac41ae63730684bcc661503673a04a0f9bc526ba8598'
KNOWLEDGE = os.environ.get('LOKLM_KNOWLEDGE_TEST_IMAGE', 'loklm-knowledge:u01-release')
LIVESYNC = 'loklm-test-livesync:1.0.51'
COUCH = 'loklm-test-couchdb:3.5.0'


def run(command, *, check=True, timeout=120, data=None):
    environment = os.environ.copy()
    if command[0] == 'docker':
        # Fixtures must never inherit deployment paths or a remote Docker context.
        for name in list(environment):
            if name.startswith(('LOKLM_', 'COUCHDB_', 'COMPOSE_', 'DOCKER_')) or name in (
                    'KNOWLEDGE_PATH', 'INDEX_PATH', 'APPDATA_PATH', 'MODEL_PATH'):
                environment.pop(name)
        command = ['docker', '--host', 'unix:///var/run/docker.sock', *command[1:]]
    result = subprocess.run(command, input=data, capture_output=True, timeout=timeout, env=environment)
    if check and result.returncode:
        raise RuntimeError('Gateway fixture command failed: ' + command[0] + ' (raw output withheld)')
    return result


def main():
    commit = os.environ.get('LOKLM_TEST_SOURCE_COMMIT')
    if not commit:
        commit = run(['git', '-C', str(HERE), 'rev-parse', 'HEAD'], check=False).stdout.decode().strip()
    if not commit:
        raise RuntimeError('Supply the exact checkout commit in LOKLM_TEST_SOURCE_COMMIT for cross-OS worktrees')
    project = 'loklm-tls-' + uuid.uuid4().hex[:12]
    root = Path(tempfile.mkdtemp(prefix=project + '-')).resolve()
    root.chmod(0o755)
    compose = None
    helpers = []
    passed = []
    started = time.monotonic()
    report = None

    def expect(condition, label):
        if not condition:
            raise AssertionError(label)
        passed.append(label)
        print('PASS ' + label, flush=True)

    def wait(predicate, label, seconds=60):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                if predicate():
                    expect(True, label)
                    return
            except (OSError, ValueError, http.client.HTTPException):
                pass
            time.sleep(1)
        raise AssertionError(label)

    try:
        for name in ['appdata', 'appdata/livesync', 'appdata/couchdb', 'vault', 'index', 'certs', 'b', 'a-files', 'b-files']:
            path = root / name
            path.mkdir()
            os.chown(path, 1000, 1000)
        # Root key stays on the host, never mounted into any service or client.
        ca_key = root / 'ca.key'
        ca = root / 'ca.pem'
        key = root / 'certs/server.key'
        cert = root / 'certs/server.pem'
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-sha256',
             '-subj', '/CN=Disposable LokLM Gateway Test CA',
             '-addext', 'basicConstraints=critical,CA:TRUE',
             '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
             '-addext', 'subjectKeyIdentifier=hash', '-keyout', str(ca_key), '-out', str(ca)])
        ca_key.chmod(0o600)
        run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
             '-subj', '/CN=' + HOST, '-keyout', str(key), '-out', str(root / 'server.csr')])
        extensions = root / 'server.ext'
        extensions.write_text('subjectAltName=DNS:' + HOST + '\nbasicConstraints=critical,CA:FALSE\n'
                              'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n'
                              'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
        run(['openssl', 'x509', '-req', '-in', str(root / 'server.csr'), '-CA', str(ca), '-CAkey', str(ca_key),
             '-CAcreateserial', '-days', '1', '-sha256', '-extfile', str(extensions), '-out', str(cert)])
        key.chmod(0o400)
        os.chown(key, 1000, 1000)
        token = secrets.token_urlsafe(40)
        for name, value in [('api_token', token), ('phrase', secrets.token_urlsafe(40))]:
            path = root / name
            path.write_text(value)
            path.chmod(0o400)
            os.chown(path, 1000, 1000)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        envfile = root / '.env'
        envfile.write_text('\n'.join([
            'KNOWLEDGE_PATH=' + str(root / 'vault'), 'INDEX_PATH=' + str(root / 'index'),
            'APPDATA_PATH=' + str(root / 'appdata'), 'LOKLM_UID=1000', 'LOKLM_GID=1000',
            'COUCHDB_USER=fixture-admin', 'COUCHDB_PASSWORD=' + secrets.token_urlsafe(40),
            'LOKLM_TLS_HOST=' + HOST, 'LOKLM_TLS_CERT_FILE=' + str(cert),
            'LOKLM_TLS_KEY_FILE=' + str(key), 'LOKLM_TLS_PORT=' + str(port),
        ]) + '\n')
        envfile.chmod(0o600)
        overlay = root / 'fixture.json'
        overlay.write_text(json.dumps({'services': {
            'knowledge': {'image': KNOWLEDGE}, 'livesync': {'image': LIVESYNC},
            'setup': {'image': LIVESYNC}, 'couchdb': {'image': COUCH},
            'gateway': {'networks': {'gateway': {'aliases': [HOST]}, 'private': {}}},
        }, 'secrets': {'api_token': {'file': str(root / 'api_token')},
                       'vault_passphrase': {'file': str(root / 'phrase')}}}))
        compose = ['docker', 'compose', '--project-name', project, '--env-file', str(envfile),
                   '-f', str(HERE / 'compose.yaml'), '-f', str(HERE / 'compose.gateway.yaml'), '-f', str(overlay)]
        config = json.loads(run(compose + ['--profile', 'setup', 'config', '--format', 'json']).stdout)
        expect(not gateway_checks(config), 'actual gateway overlay passes read-only preflight')
        expect(config['services']['gateway']['ports'][0]['host_ip'] == '127.0.0.1' and
               not config['services']['knowledge'].get('ports') and not config['services']['couchdb'].get('ports'),
               'only ephemeral loopback HTTPS port; no direct backend publications')
        run(compose + ['up', '--no-build', '--pull', 'never', '-d', '--wait', 'couchdb'])
        run(compose + ['--profile', 'setup', 'run', '--rm', '--no-deps', '-T', 'setup'])
        run(compose + ['up', '--no-build', '--pull', 'never', '-d', 'gateway', 'knowledge'])
        trust = ssl.create_default_context(cafile=str(ca))

        def https(path, *, auth=None, method='GET', data=None, headers=None, context=trust, hostname=HOST):
            conn = http.client.HTTPSConnection(hostname, port, timeout=10, context=context)
            # Keep real SNI/hostname verification without modifying host DNS.
            conn._create_connection = lambda *args, **kwargs: socket.create_connection(('127.0.0.1', port), timeout=10)
            request_headers = dict(headers or {})
            if auth:
                request_headers['Authorization'] = 'Basic ' + auth
            if data is not None:
                request_headers['Content-Type'] = 'application/json'
            try:
                conn.request(method, path, body=json.dumps(data) if data is not None else None, headers=request_headers)
                response = conn.getresponse()
                return response.status, response.read(), {name.lower(): value for name, value in response.getheaders()}
            finally:
                conn.close()

        wait(lambda: https('/_up')[0] == 200, 'trusted certificate and hostname reach HTTPS CouchDB health')
        def served_certificate_hash():
            with socket.create_connection(('127.0.0.1', port), timeout=10) as plain:
                with trust.wrap_socket(plain, server_hostname=HOST) as secure:
                    return hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest()
        initial_certificate_hash = served_certificate_hash()
        def knowledge_status(authenticated):
            arguments = compose + ['exec', '-T', 'knowledge', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}']
            if authenticated:
                arguments += ['--header', '@-']
            arguments += ['http://127.0.0.1:8787/v1/status']
            return run(arguments, data=('Authorization: Bearer ' + token + '\n').encode() if authenticated else None).stdout
        expect(knowledge_status(False) == b'401' and knowledge_status(True) == b'200',
               'knowledge API still enforces its own bearer token on the private backend')
        try:
            https('/_up', context=ssl.create_default_context())
            untrusted_refused = False
        except ssl.SSLCertVerificationError:
            untrusted_refused = True
        expect(untrusted_refused, 'untrusted CA refused by normal TLS verification')
        try:
            https('/_up', hostname='wrong.gateway.test')
            wrong_host_refused = False
        except ssl.SSLError:
            wrong_host_refused = True
        expect(wrong_host_refused, 'unknown TLS server name refused')
        expect(https('/loklm-knowledge')[0] in [401, 403], 'anonymous database access denied through HTTPS')
        bad_auth = base64.b64encode(b'wrong:synthetic-wrong').decode()
        expect(https('/loklm-knowledge', auth=bad_auth)[0] in [401, 403], 'incorrect CouchDB credentials denied through HTTPS')
        expect(https('/loklm-knowledge', headers={'X-Auth-CouchDB-UserName': 'fixture-admin',
                                                'X-Auth-CouchDB-Roles': '_admin'})[0] in [401, 403],
               'client-supplied proxy-auth headers cannot bypass CouchDB authentication')
        settings = json.loads((root / 'appdata/livesync/settings.json').read_text())
        auth = base64.b64encode((settings['couchDB_USER'] + ':' + settings['couchDB_PASSWORD']).encode()).decode()
        expect(settings['couchDB_USER'] == 'loklm-sync' and https('/loklm-knowledge', auth=auth)[0] == 200,
               'dedicated non-admin sync credentials remain authoritative')
        expect(https('/loklm-knowledge/_security', auth=auth, method='PUT', data={})[0] in [401, 403],
               'non-admin peer cannot change database security policy')
        for path in ['/_utils/', '/_all_dbs', '/_users', '/_node/_local/_config', '/v1/status',
                     '/loklm-knowledge/../_users', '/%5futils/', '/loklm-knowledge/%2e%2e/_users']:
            expect(https(path, auth=auth)[0] == 404, 'gateway excludes administrative or unrelated route ' + path)
        code, _, headers = https('/_session', method='POST', data={'name': settings['couchDB_USER'],
                                                                'password': settings['couchDB_PASSWORD']})
        cookie = headers.get('set-cookie', '')
        expect(code == 200 and 'secure' in cookie.lower() and 'httponly' in cookie.lower() and
               https('/loklm-knowledge', headers={'Cookie': cookie.split(';')[0]})[0] == 200,
               'CouchDB session auth works with Secure HttpOnly cookie')
        _, _, headers = https('/loklm-knowledge', auth=auth, headers={'Origin': 'app://obsidian.md'})
        expect(headers.get('access-control-allow-origin') == 'app://obsidian.md', 'configured Obsidian CORS origin preserved')
        _, _, headers = https('/loklm-knowledge', auth=auth, headers={'Origin': 'https://untrusted.example.test'})
        expect(not headers.get('access-control-allow-origin'), 'unconfigured CORS origin is not granted')
        # Both real upstream peers join only the gateway-facing network.
        settings.update(couchDB_URI='https://' + HOST + ':8443', liveSync=False, syncOnStart=False, syncOnSave=False)
        for peer, state in [('a', root / 'appdata/livesync'), ('b', root / 'b')]:
            path = state / 'settings.json'
            path.write_text(json.dumps(settings))
            path.chmod(0o600)
            os.chown(path, 1000, 1000)

        def cli(peer, *args, trusted=True, check=True):
            name = project + '-peer-' + uuid.uuid4().hex[:8]
            helpers.append(name)
            state = root / 'appdata/livesync' if peer == 'a' else root / 'b'
            command = ['docker', 'run', '--rm', '--pull', 'never', '--name', name, '--network', project + '_gateway',
                       '--cpus', '1', '--memory', '512m', '--pids-limit', '128',
                       '-v', str(state) + ':/state', '-v', str(root / (peer + '-files')) + ':/files',
                       '-v', str(ca) + ':/run/test-ca.pem:ro']
            if trusted:
                command += ['-e', 'NODE_EXTRA_CA_CERTS=/run/test-ca.pem']
            try:
                return run(command + ['--entrypoint', 'node', LIVESYNC, '/app/dist/index.cjs', '/state',
                                      '--settings', '/state/settings.json', *args], check=check)
            finally:
                run(['docker', 'rm', '-f', name], check=False)

        expect(cli('b', 'sync', trusted=False, check=False).returncode != 0,
               'actual upstream LiveSync rejects untrusted gateway certificate')
        note_id = str(uuid.uuid4())
        note = '---\nloklm_id: ' + note_id + '\n---\n# Grüße\nSynthetic TLS knowledge.\n'
        binary = bytes(range(256)) * 1024
        (root / 'a-files/input.md').write_text(note)
        (root / 'a-files/input.bin').write_bytes(binary)
        cli('a', 'push', '/files/input.md', 'Notes/Überblick.md')
        cli('a', 'push', '/files/input.bin', 'Attachments/Bild.bin')
        cli('a', 'sync')
        cli('b', 'sync')
        cli('b', 'pull', 'Notes/Überblick.md', '/files/received.md')
        cli('b', 'pull', 'Attachments/Bild.bin', '/files/received.bin')
        expect((root / 'b-files/received.md').read_text() == note, 'actual encrypted LiveSync Unicode note roundtrip through HTTPS')
        expect((root / 'b-files/received.bin').read_bytes() == binary, 'actual encrypted LiveSync 256 KiB attachment roundtrip through HTTPS')
        wire = https('/loklm-knowledge/_all_docs?include_docs=true', auth=auth)[1]
        expect(b'Synthetic TLS knowledge' not in wire, 'CouchDB wire payload retains upstream content encryption')
        feed = http.client.HTTPSConnection(HOST, port, timeout=8, context=trust)
        feed._create_connection = lambda *args, **kwargs: socket.create_connection(('127.0.0.1', port), timeout=8)
        feed_started = time.monotonic()
        try:
            feed.request('GET', '/loklm-knowledge/_changes?since=now&feed=continuous&heartbeat=1000',
                         headers={'Authorization': 'Basic ' + auth})
            response = feed.getresponse()
            heartbeat = response.readline()
            expect(response.status == 200 and heartbeat == b'\n' and time.monotonic() - feed_started < 7,
                   'continuous changes heartbeat arrives without proxy buffering')
        finally:
            feed.close()
        run(compose + ['restart', 'gateway'])
        wait(lambda: https('/_up')[0] == 200, 'gateway restart preserves trusted HTTPS readiness')
        replacement = root / 'certs/replacement.pem'
        run(['openssl', 'x509', '-req', '-in', str(root / 'server.csr'), '-CA', str(ca), '-CAkey', str(ca_key),
             '-CAcreateserial', '-days', '1', '-sha256', '-extfile', str(extensions), '-out', str(replacement)])
        replacement.replace(cert)
        run(compose + ['up', '--no-build', '--pull', 'never', '-d', '--no-deps', '--force-recreate', 'gateway'])
        wait(lambda: https('/_up')[0] == 200, 'operator-style certificate replacement and gateway recreation preserve trust')
        renewed_certificate_hash = served_certificate_hash()
        expect(renewed_certificate_hash != initial_certificate_hash, 'recreated gateway serves renewed certificate instead of stale bind inode')
        edited = note + '\nEdited on peer B after gateway restart.\n'
        (root / 'b-files/received.md').write_text(edited)
        cli('b', 'push', '/files/received.md', 'Notes/Überblick.md')
        cli('b', 'sync')
        cli('a', 'sync')
        cli('a', 'pull', 'Notes/Überblick.md', '/files/returned.md')
        cli('a', 'pull', 'Attachments/Bild.bin', '/files/returned.bin')
        expect((root / 'a-files/returned.md').read_text() == edited and
               (root / 'a-files/returned.bin').read_bytes() == binary,
               'bidirectional note and attachment retrieval survive restart and certificate renewal')
        logs = run(compose + ['logs', '--no-color', 'gateway']).stdout.decode()
        expect(all(value not in logs for value in [note, edited, settings['couchDB_PASSWORD'], auth, cookie,
                                                   '/loklm-knowledge', 'Notes/Überblick.md']),
               'gateway logs contain no credentials, note content or request paths')
        report = {'source_commit': commit, 'checks': passed, 'elapsed_seconds': round(time.monotonic() - started, 2),
                  'images': {}, 'tls': {'hostname': HOST, 'issuer': 'disposable synthetic CA',
                  'ca_sha256': hashlib.sha256(ca.read_bytes()).hexdigest(),
                  'certificate_sha256': hashlib.sha256(cert.read_bytes()).hexdigest(),
                  'initial_served_der_sha256': initial_certificate_hash,
                  'renewed_served_der_sha256': renewed_certificate_hash,
                  'trust_scope': 'Python per-request SSL context and Node per-process NODE_EXTRA_CA_CERTS only',
                  'global_trust_changed': False}, 'attachment_sha256': hashlib.sha256(binary).hexdigest(),
                  'source_sha256': {}, 'host_bind': '127.0.0.1', 'unraid_tested': False, 'obsidian_ui_tested': False,
                  'models_loaded': False, 'livesync_commit': '5b57324bc72a6c7a330c280b876ae9c6f8e83221'}
        for image in [NGINX, COUCH, LIVESYNC, KNOWLEDGE]:
            metadata = json.loads(run(['docker', 'image', 'inspect', image]).stdout)[0]
            report['images'][image] = {'id': metadata['Id'], 'repo_digests': metadata['RepoDigests'], 'bytes': metadata['Size']}
        for relative in ['compose.gateway.yaml', 'gateway/start.sh', 'gateway/nginx.conf.template', 'gateway_preflight.py', 'test_gateway.py']:
            report['source_sha256'][relative] = hashlib.sha256((HERE / relative).read_bytes()).hexdigest()
    finally:
        for name in helpers:
            run(['docker', 'rm', '-f', name], check=False)
        if compose:
            run(compose + ['--profile', 'setup', 'down', '--volumes', '--remove-orphans', '--timeout', '15'])
            remaining = run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]).stdout.strip()
            if remaining:
                raise RuntimeError('Fixture cleanup incomplete; preserve private temporary state for inspection')
        if root.parent == Path(tempfile.gettempdir()).resolve() and root.name.startswith(project + '-'):
            shutil.rmtree(root)
    if report:
        report['cleanup'] = 'unique project containers/networks and private synthetic keys/data removed'
        output = HERE / 'reports'
        output.mkdir(exist_ok=True)
        (output / 'gateway-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
