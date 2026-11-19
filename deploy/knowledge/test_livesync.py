"""Disposable Linux Docker integration. Synthetic data only; no host ports.
Run: python3 deploy/knowledge/test_livesync.py
Requires locally built loklm-test-livesync:1.0.51. Cleans only its UUID names.
Never prints generated credentials, settings, or raw CLI logs.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import urllib.request
import uuid

PREFIX = 'loklm-test-' + uuid.uuid4().hex[:12]
ROOT = Path(tempfile.mkdtemp(prefix=PREFIX + '-')).resolve()
NETWORK = PREFIX + '-net'
COUCH = PREFIX + '-couch'
IMAGE = os.environ.get('LOKLM_LIVESYNC_TEST_IMAGE', 'loklm-test-livesync:1.0.51')
containers = []
checks = []
redactions = []

def docker(*args, timeout=120, check=True, data=None):
    p = subprocess.run(['docker', *args], input=data, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=timeout)
    if check and p.returncode:
        detail = '\n'.join(line for line in (p.stdout + p.stderr).decode(errors='replace').splitlines() if '[REQ]' not in line)[-9000:]
        for secret in redactions:
            detail = detail.replace(secret, '[redacted]')
        raise RuntimeError('Docker operation failed: ' + args[0] + ', exit ' + str(p.returncode) + '\n' + detail)
    return p

def cli(peer, *args, check=True, timeout=60, data=None):
    name = PREFIX + '-' + uuid.uuid4().hex[:8]
    containers.append(name)
    try:
        command = ['/app/dist/index.cjs', 'init-settings', '/state/settings.json'] if args == ('init-settings',) else ['/app/dist/index.cjs', '/state', '--settings', '/state/settings.json', '--verbose', *args]
        return docker('run', '--rm', '--name', name, '--network', NETWORK, '--entrypoint', 'node',
                      '-v', str(ROOT / peer / 'state') + ':/state',
                      '-v', str(ROOT / peer / 'vault') + ':/vault', IMAGE, *command,
                      timeout=timeout, check=check, data=data)
    finally:
        docker('rm', '-f', name, check=False)

def expect(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label, flush=True)

def main():
    admin = secrets.token_urlsafe(32)
    password = secrets.token_urlsafe(32)
    phrase = secrets.token_urlsafe(32)
    redactions.extend([admin,password,phrase])
    envfile = ROOT / 'couch.env'
    envfile.write_text('COUCHDB_USER=test-admin\nCOUCHDB_PASSWORD=' + admin + '\n')
    envfile.chmod(0o600)
    ROOT.chmod(0o755)
    docker('network', 'create', '--internal', NETWORK)
    containers.append(COUCH)
    docker('run', '-d', '--name', COUCH, '--network', NETWORK,
           '--env-file', str(envfile), '--memory', '512m', '--cpus', '1', 'couchdb:3.5.0')
    ip = json.loads(docker('inspect', COUCH).stdout)[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    auth = base64.b64encode(('test-admin:' + admin).encode()).decode()
    def http(path, method='GET', body=None, user_auth=auth):
        req = urllib.request.Request('http://' + ip + ':5984/' + path,
              data=json.dumps(body).encode() if body is not None else None,
              method=method, headers={'Authorization':'Basic '+user_auth,'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.load(r)
    for _ in range(60):
        try:
            http('_up'); break
        except Exception:
            time.sleep(1)
    else:
        raise RuntimeError('disposable CouchDB did not become ready')
    for name in ['_users', '_replicator', '_global_changes', 'knowledge']:
        http(name, 'PUT')
    http('_users/org.couchdb.user:peer', 'PUT', {'name':'peer','password':password,'roles':[],'type':'user'})
    http('knowledge/_security', 'PUT', {'admins':{'names':['test-admin'],'roles':[]},'members':{'names':['peer'],'roles':[]}})
    for peer in ['a','b']:
        for part in ['state','vault']:
            p = ROOT / peer / part
            p.mkdir(parents=True)
            os.chown(p,1000,1000)
        cli(peer,'init-settings')
        settings_path = ROOT / peer / 'state' / 'settings.json'
        settings = json.loads(settings_path.read_text())
        settings.update(remoteType='', couchDB_URI='http://' + COUCH + ':5984', couchDB_USER='peer',
                        couchDB_PASSWORD=password, couchDB_DBNAME='knowledge',liveSync=False,
                        syncOnStart=False,syncOnSave=False,usePluginSync=False,encrypt=True,
                        passphrase=phrase,isConfigured=True)
        settings_path.write_text(json.dumps(settings))
        os.chown(settings_path,1000,1000)
    source_id = str(uuid.uuid4())
    content = '---\nloklm_id: '+source_id+'\n---\n# Grüße\nSynthetic DE/EN knowledge. Überprüfung.\n'
    (ROOT/'a/vault/input.md').write_text(content)
    binary = bytes(range(256))*1024
    (ROOT/'a/vault/input.bin').write_bytes(binary)
    path = 'Grüße/Überblick.md'
    attachment = 'Anhänge/Bild.bin'
    cli('a','push','/vault/input.md',path)
    cli('a','push','/vault/input.bin',attachment)
    cli('a','sync');cli('b','sync')
    cli('b','pull',path,'/vault/received.md')
    cli('b','pull',attachment,'/vault/received.bin')
    expect((ROOT/'b/vault/received.md').read_text()==content,'encrypted Markdown A to B, Unicode paths')
    expect((ROOT/'b/vault/received.bin').read_bytes()==binary,'chunked binary attachment A to B')
    edited = content + '\nBearbeitet on peer B.\n'
    (ROOT/'b/vault/received.md').write_text(edited)
    cli('b','push','/vault/received.md',path);cli('b','sync');cli('a','sync')
    cli('a','pull',path,'/vault/back.md')
    expect((ROOT/'a/vault/back.md').read_text()==edited,'edit B to A')
    # Every CLI invocation restarts the actual local PouchDB process.
    cli('b','sync');cli('b','pull',path,'/vault/restarted.md')
    expect((ROOT/'b/vault/restarted.md').read_text()==edited,'restart and durable local replication checkpoint')
    all_docs = http('knowledge/_all_docs?include_docs=true')
    wire=json.dumps(all_docs)
    expect('Synthetic DE/EN' not in wire and 'Bearbeitet on peer B' not in wire,'CouchDB documents do not expose encrypted note plaintext')
    expect(len(all_docs['rows'])>2,'actual LiveSync metadata and chunk documents stored')
    # Portable ID survives the official file-level rename (new path + tombstone).
    renamed = 'Wissen/Umbenannt – renamed.md'
    cli('a','push','/vault/back.md',renamed);cli('a','rm',path)
    cli('a','sync');cli('b','sync');cli('b','pull',renamed,'/vault/renamed.md')
    expect(source_id in (ROOT/'b/vault/renamed.md').read_text(),'rename preserves portable source ID')
    path = renamed
    # Independent offline edits from the same base must keep revision branches.
    (ROOT/'a/vault/conflict.md').write_text(edited+'\nOffline branch A\n')
    (ROOT/'b/vault/conflict.md').write_text(edited+'\nOffline branch B\n')
    cli('a','push','/vault/conflict.md',path);cli('b','push','/vault/conflict.md',path)
    cli('a','sync');cli('b','sync');cli('a','sync')
    info = json.loads(cli('a','info',path).stdout)
    expect(info['conflicts'] != 'N/A','concurrent offline edits preserve CouchDB conflict revisions')
    # Review both branches using upstream pull-rev before explicitly resolving.
    cli('a','pull-rev',path,'/vault/winning.md',info['revision'])
    conflict_rev=info['conflicts'].split()[0]
    cli('a','pull-rev',path,'/vault/conflicting.md',conflict_rev)
    branches={(ROOT/'a/vault/winning.md').read_text(),(ROOT/'a/vault/conflicting.md').read_text()}
    expect(branches=={edited+'\nOffline branch A\n',edited+'\nOffline branch B\n'},'both conflicting file versions remain recoverable')
    cli('a','resolve',path,info['revision']);cli('a','sync');cli('b','sync')
    # Separate empty filesystem mirrors prevent import fixture paths becoming notes.
    for peer in ['a','b']:
        clean=ROOT/peer/'mirror';clean.mkdir();os.chown(clean,1000,1000)
    def start_daemon(peer):
        name=PREFIX+'-daemon-'+peer;containers.append(name)
        docker('run','-d','--name',name,'--network',NETWORK,'--entrypoint','node',
               '-v',str(ROOT/peer/'state')+':/state','-v',str(ROOT/peer/'mirror')+':/vault',
               IMAGE,'/app/dist/index.cjs','/state','--settings','/state/settings.json','--vault','/vault','--interval','2','daemon')
        return name
    da=start_daemon('a');db=start_daemon('b')
    def wait_for(predicate,label):
        for _ in range(90):
            if predicate(): expect(True,label);return
            time.sleep(1)
        raise AssertionError(label)
    wait_for(lambda:(ROOT/'b/mirror'/path).exists(),'daemon mirrors actual Markdown into peer vault')
    # The same replicated files now feed the actual Rust process, not a JSON mock.
    token=secrets.token_urlsafe(40);redactions.append(token)
    (ROOT/'api_token').write_text(token);os.chown(ROOT/'api_token',1000,1000);(ROOT/'api_token').chmod(0o400)
    index_dir=ROOT/'index';index_dir.mkdir();os.chown(index_dir,1000,1000)
    knowledge=PREFIX+'-knowledge';containers.append(knowledge)
    model_args=[]
    if os.environ.get('LOKLM_TEST_MODELS'):
        embed=PREFIX+'-embed';containers.append(embed)
        fingerprint='9899f70458e9a04e8ed6912e24f3e002e05d670cae06985c172f456b9c0a2164'
        docker('run','-d','--name',embed,'--network',NETWORK,'--cpus','2','--memory','2g',
               '-v',os.environ['LOKLM_TEST_MODELS']+':/models:ro','-e','LOKLM_MODEL_ALIAS='+fingerprint,
               'loklm-test-model:b12359')
        for _ in range(90):
            ready=docker('exec',embed,'curl','-sf','http://localhost:8080/health',check=False)
            if ready.returncode==0:break
            time.sleep(1)
        else:raise AssertionError('dedicated CPU embedder readiness')
        model_args=['-e','LOKLM_EMBED_ENDPOINT=http://'+embed+':8080/','-e','LOKLM_MODEL_RUNTIME=llama.cpp-b12359']
    docker('run','-d','--name',knowledge,'--network',NETWORK,'--cpus','2','--memory','4g',
           '-v',str(ROOT/'b/mirror')+':/knowledge:ro','-v',str(index_dir)+':/index',
           '-v',str(ROOT/'api_token')+':/run/token:ro','-e','LOKLM_TOKEN_FILE=/run/token',
           *model_args,os.environ.get('LOKLM_KNOWLEDGE_TEST_IMAGE','loklm-test-knowledge:dev'),'serve')
    kip=json.loads(docker('inspect',knowledge).stdout)[0]['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    def api(route,body=None,method=None):
        req=urllib.request.Request('http://'+kip+':8787'+route,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=70) as response:
            raw=response.read()
            return json.loads(raw) if raw else None
    def indexed():
        try:return api('/v1/status')['index']['sources']==1
        except Exception:return False
    wait_for(indexed,'Rust indexes actual encrypted LiveSync peer output')
    result=api('/v1/search',{'query':'Synthetic DE/EN','source_ids':[source_id]})['hits']
    expect(result and result[0]['source_id']==source_id and result[0]['path']==path and result[0]['open_uri'].startswith('obsidian://open?'),
           'retrieval preserves original source ID and opening location')
    unchanged=api('/v1/reconcile',{},'POST')
    expect(unchanged['embedded']==0,'unchanged replicated content is never re-embedded')
    expect(not api('/v1/search',{'query':'Synthetic','source_ids':[str(uuid.uuid4())]})['hits'],'source scope excludes other documents')
    docker('restart',knowledge)
    wait_for(indexed,'Rust restart recovers persisted index against LiveSync vault')
    live_text=content+'\nDaemon file edit\n'
    (ROOT/'a/mirror'/path).write_text(live_text)
    wait_for(lambda:(ROOT/'b/mirror'/path).read_text()==live_text,'filesystem edit watched and synced between daemon peers')
    live_renamed='Wissen/Grüße neu.md'
    (ROOT/'a/mirror'/path).rename(ROOT/'a/mirror'/live_renamed)
    wait_for(lambda:(ROOT/'b/mirror'/live_renamed).exists() and not (ROOT/'b/mirror'/path).exists(),'watched filesystem rename propagates')
    def indexed_rename():
        try:return api('/v1/sources')[0]['path']==live_renamed
        except Exception:return False
    wait_for(indexed_rename,'Rust watcher updates renamed opening path without losing stable source ID')
    (ROOT/'a/mirror'/live_renamed).unlink()
    wait_for(lambda:not (ROOT/'b/mirror'/live_renamed).exists(),'watched filesystem deletion propagates')
    def indexed_delete():
        try:return api('/v1/status')['index']['sources']==0
        except Exception:return False
    wait_for(indexed_delete,'Rust removes remotely deleted source from retrieval')
    docker('stop',knowledge)
    docker('stop',da,db)
    # Official rm emits the LiveSync deletion, not a homemade CouchDB document.
    cli('a','rm',path);cli('a','sync');cli('b','sync')
    missing=cli('b','pull',path,'/vault/deleted.md',check=False)
    expect(missing.returncode!=0 or not (ROOT/'b/vault/deleted.md').exists(),'LiveSync delete propagates')
    bad=cli('a','push','/vault/input.md','../escape.md',check=False)
    expect(bad.returncode!=0 and not (ROOT/'a/escape.md').exists(),'hostile path rejected by maintained CLI')
    # Fail closed with wrong credentials, without ever echoing them.
    settings_path=ROOT/'b/state/settings.json'; settings=json.loads(settings_path.read_text())
    settings['couchDB_PASSWORD']=secrets.token_urlsafe(32);settings_path.write_text(json.dumps(settings))
    rejected=cli('b','sync',check=False)
    expect(rejected.returncode!=0,'wrong CouchDB credentials fail')
    docker('stop',COUCH)
    unavailable=cli('a','sync',check=False,timeout=30)
    expect(unavailable.returncode!=0,'unavailable CouchDB fails without modifying original source fixture')
    expect((ROOT/'a/vault/input.md').read_text()==content,'original source survives CouchDB outage')
    report={'livesync_commit':'5b57324bc72a6c7a330c280b876ae9c6f8e83221',
            'commonlib_version':'0.6.0 (upstream npm lock integrity)','checks':checks,
            'obsidian_ui_tested':False,'rust_dense_model_tested':bool(model_args),'attachment_sha256':hashlib.sha256(binary).hexdigest()}
    out=Path(__file__).parent/'reports';out.mkdir(exist_ok=True)
    (out/'livesync.json').write_text(json.dumps(report,indent=2))

if __name__ == '__main__':
    try:
        main()
    finally:
        for name in containers:
            docker('rm','-f',name,check=False)
        docker('network','rm',NETWORK,check=False)
        # Delete only this script's verified unique tempfile root.
        import shutil
        if ROOT.parent == Path(tempfile.gettempdir()).resolve() and ROOT.name.startswith(PREFIX+'-'):
            shutil.rmtree(ROOT)
