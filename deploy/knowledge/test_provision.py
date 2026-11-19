"""Test fresh setup against disposable CouchDB; never uses user configuration."""
import json,os,secrets,subprocess,tempfile,uuid,time,shutil
from pathlib import Path

def run(*args,check=True):
    p=subprocess.run(['docker',*args],capture_output=True,timeout=120)
    if check and p.returncode:raise RuntimeError('disposable Docker operation failed: '+args[0])
    return p

def main():
    prefix='loklm-setup-'+uuid.uuid4().hex[:12];root=Path(tempfile.mkdtemp(prefix=prefix+'-'));network=prefix+'-net';couch=prefix+'-couch'
    try:
        root.chmod(0o755);state=root/'state';state.mkdir();os.chown(state,1000,1000)
        env=root/'couch.env';env.write_text('COUCHDB_USER=synthetic-admin\nCOUCHDB_PASSWORD='+secrets.token_urlsafe(32)+'\n');env.chmod(0o600)
        phrase=root/'phrase';phrase.write_text(secrets.token_urlsafe(32));os.chown(phrase,1000,1000);phrase.chmod(0o400)
        run('network','create','--internal',network)
        run('build','-f',str(Path(__file__).parent.resolve()/'CouchDB.Dockerfile'),'-t','loklm-test-couchdb:3.5.0',str(Path(__file__).parent.resolve()))
        run('run','-d','--name',couch,'--network',network,'--network-alias','couchdb','--cpus','1','--memory','512m','--env-file',str(env),'loklm-test-couchdb:3.5.0')
        for _ in range(60):
            if run('exec',couch,'curl','-sf','http://localhost:5984/_up',check=False).returncode==0:break
            time.sleep(1)
        else:raise AssertionError('CouchDB health under production config')
        def setup():
            return run('run','--rm','--network',network,'--env-file',str(env),
                '-v',str(Path(__file__).parent.resolve()/'init.mjs')+':/setup/init.mjs:ro',
                '-v',str(state)+':/state','-v',str(phrase)+':/run/secrets/vault_passphrase:ro',
                '--entrypoint','node','loklm-test-livesync:1.0.51','/setup/init.mjs',check=False)
        first=setup()
        if first.returncode:raise AssertionError('fresh setup failed (logs withheld to protect generated credentials)')
        settings=state/'settings.json';before=settings.read_bytes();data=json.loads(before)
        assert data['encrypt'] and data['couchDB_USER']=='loklm-sync'
        assert settings.stat().st_mode&0o777==0o600
        second=setup();assert second.returncode!=0 and settings.read_bytes()==before
        print('PASS fresh official LiveSync setup, encryption, private settings, repeat refuses without overwrite')
    finally:
        run('rm','-f',couch,check=False);run('network','rm',network,check=False)
        if root.parent==Path(tempfile.gettempdir()) and root.name.startswith(prefix+'-'):shutil.rmtree(root)
if __name__=='__main__':main()
