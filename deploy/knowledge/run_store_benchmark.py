"""Disposable store benchmark; only the unique prefixed resources are removed."""
import argparse,json,os,subprocess,tempfile,time,uuid,urllib.request
from pathlib import Path
def run(*args):
    return subprocess.run(['docker',*args],check=True,capture_output=True,text=True).stdout
def main():
    parser=argparse.ArgumentParser();parser.add_argument('corpus',type=Path);parser.add_argument('--image',default='loklm-test-knowledge:dev');a=parser.parse_args()
    prefix='loklm-bench-'+uuid.uuid4().hex[:12];network=prefix+'-net';qdrant=prefix+'-qdrant'
    root=Path(tempfile.mkdtemp(prefix=prefix+'-'));root.chmod(0o777)
    try:
        run('network','create','--internal',network)
        run('run','-d','--name',qdrant,'--network',network,'--cpus','2','--memory','2g','-v',str(root/'qdrant')+':/qdrant/storage','qdrant/qdrant:v1.20.0@sha256:9bfc89f9914fc14876a88c05270685921a55b8877b254a98bcc1cc2f0a424cd2')
        time.sleep(3)
        for backend in ['lance','qdrant']:
            target='/bench/lance' if backend=='lance' else 'http://'+qdrant+':6334'
            print(run('run','--rm','--network',network,'--cpus','2','--memory','4g','-e','LOKLM_BENCH_KEEP_DISPOSABLE=1','-v',str(a.corpus.resolve())+':/corpus.json:ro','-v',str(root)+':/bench','--entrypoint','stores_bench',a.image,backend,'/corpus.json',target,'/bench/'+backend+'.json'),flush=True)
        stats=run('stats','--no-stream','--format','{{json .}}',qdrant)
        out=Path(__file__).parent/'reports';out.mkdir(exist_ok=True)
        for backend in ['lance','qdrant']:
            data=json.loads((root/(backend+'.json')).read_text());data['build_image']=a.image
            if backend=='qdrant':
                data['server_docker_stats']=json.loads(stats)
                data['server_storage_bytes']=sum(p.stat().st_size for p in (root/'qdrant').rglob('*') if p.is_file())
                if data.get('collection'):
                    run('restart',qdrant)
                    ip=json.loads(run('inspect',qdrant))[0]['NetworkSettings']['Networks'][network]['IPAddress']
                    query=json.loads(a.corpus.read_text())['queries'][0]['vector']
                    start=time.perf_counter()
                    for _ in range(60):
                        try:
                            request=urllib.request.Request('http://'+ip+':6333/collections/'+data['collection']+'/points/query',data=json.dumps({'query':query,'limit':5}).encode(),headers={'Content-Type':'application/json'})
                            with urllib.request.urlopen(request,timeout=5) as response:result=json.load(response)
                            assert result['result']['points'];break
                        except Exception:time.sleep(0.5)
                    else:raise AssertionError('Qdrant restart recovery failed')
                    data['restart_to_first_success_ms']=(time.perf_counter()-start)*1000
                    data['restart_recovery']='nonempty persisted query after server restart; OS cache not flushed'
            (out/(backend+'.json')).write_text(json.dumps(data,indent=2))
    finally:
        subprocess.run(['docker','rm','-f',qdrant],capture_output=True)
        subprocess.run(['docker','network','rm',network],capture_output=True)
        import shutil
        if root.parent==Path(tempfile.gettempdir()) and root.name.startswith(prefix+'-'):shutil.rmtree(root)
if __name__=='__main__':main()
