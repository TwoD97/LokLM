"""Opt-in disposable CPU model smoke; synthetic content, no host ports.

Requires built production/model images and LOKLM_TEST_MODELS pointing to the
read-only canonical model directory. Coordinate a quiet window before running.
This tests real transports and small examples, not general QA quality/parity.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

PREFIX = 'loklm-model-smoke-' + uuid.uuid4().hex[:12]
ROOT = Path(tempfile.mkdtemp(prefix=PREFIX + '-')).resolve()
NETWORK = PREFIX + '-net'
IMAGE = os.environ.get('LOKLM_KNOWLEDGE_TEST_IMAGE', 'loklm-knowledge:0.1.0')
MODEL_IMAGE = os.environ.get('LOKLM_MODEL_TEST_IMAGE', 'loklm-model:llama-b12359')
CONTAINERS = []
CHECKS = []
STOP = threading.Event()
LOW_MEMORY = threading.Event()
TOKEN = secrets.token_urlsafe(40)


def docker(*args, check=True, timeout=120):
    result = subprocess.run(['docker', *args], capture_output=True, timeout=timeout)
    if check and result.returncode:
        # Never include container logs/environment in errors.
        raise RuntimeError('Docker operation failed: ' + args[0])
    return result


def expect(value, label):
    if not value:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


def available_memory():
    """Host physical headroom on WSL, otherwise Linux MemAvailable."""
    powershell = Path('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
    if powershell.exists():
        result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive',
            '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'],
            capture_output=True, timeout=20, check=True)
        return int(result.stdout.decode().strip()) * 1024
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise RuntimeError('Cannot verify physical memory headroom')


def watchdog():
    while not STOP.wait(5):
        try:
            if available_memory() >= 2 * 1024**3:
                continue
        except Exception:
            pass  # Fail closed if monitoring is unavailable.
        LOW_MEMORY.set()
        for name in list(CONTAINERS):
            docker('stop', '-t', '1', name, check=False, timeout=30)
        return


def http(base, path, body=None, authenticated=False, timeout=190):
    headers = {'Content-Type': 'application/json'}
    if authenticated:
        headers['Authorization'] = 'Bearer ' + TOKEN
    request = urllib.request.Request(base + path, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(2 * 1024**2 + 1)
            if len(raw) > 2 * 1024**2:
                raise RuntimeError('Oversized test response')
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, None


def base_url(name, port):
    info = json.loads(docker('inspect', name).stdout)[0]
    ip = info['NetworkSettings']['Networks'][NETWORK]['IPAddress']
    return 'http://' + ip + ':' + str(port)


def wait_ready(base, path='/health'):
    for _ in range(180):
        if LOW_MEMORY.is_set():
            raise RuntimeError('Own test stopped by physical-memory guard')
        try:
            if http(base, path, timeout=2)[0] == 200:
                return
        except (OSError, TimeoutError):
            pass
        time.sleep(1)
    raise RuntimeError('Dedicated container readiness timeout')


def model(profile, command):
    alias = docker('run', '--rm', '--network', 'none', IMAGE,
                   '--model-runtime', 'llama.cpp-b12359', command).stdout.decode().strip()
    name = PREFIX + '-' + profile
    CONTAINERS.append(name)
    docker('run', '-d', '--name', name, '--network', NETWORK, '--cpus', '2',
           '--memory', '5g' if profile == 'answer' else '2g', '--pids-limit', '128',
           '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
           '--tmpfs', '/tmp:size=64m,mode=1777',
           '-v', os.environ['LOKLM_TEST_MODELS'] + ':/models:ro',
           '-e', 'LOKLM_MODEL_PROFILE=' + profile, '-e', 'LOKLM_MODEL_ALIAS=' + alias,
           MODEL_IMAGE)
    base = base_url(name, 8080)
    wait_ready(base)
    return name, base, alias


def main():
    if not os.environ.get('LOKLM_TEST_MODELS'):
        raise RuntimeError('Set LOKLM_TEST_MODELS to a dedicated read-only model directory')
    expect(available_memory() >= 10 * 1024**3, 'at least 10 GiB physical headroom before own model loads')
    ROOT.chmod(0o755)
    for part in ['vault', 'index']:
        (ROOT / part).mkdir()
        os.chown(ROOT / part, 1000, 1000)
    (ROOT / 'token').write_text(TOKEN)
    os.chown(ROOT / 'token', 1000, 1000)
    (ROOT / 'token').chmod(0o400)
    source = str(uuid.uuid4())
    other = str(uuid.uuid4())
    source_path = 'Grüße – Solar.md'
    note = ('---\nloklm_id: ' + source + '\n---\n# Solarprojekt Helios\n'
        'Das synthetische Solarprojekt Helios besitzt genau 42 Solarmodule. '
        'Die Wartung findet dienstags statt.\n'
        'The synthetic Helios solar project has exactly 42 solar panels. '
        'Maintenance takes place on Tuesdays.\n')
    (ROOT / 'vault' / source_path).write_text(note, encoding='utf-8')
    (ROOT / 'vault' / 'Orchard.md').write_text('---\nloklm_id: ' + other +
        '\n---\n# Orchard\nThe orchard grows apples and pears. No solar installation is described.\n')
    docker('network', 'create', '--internal', NETWORK)
    monitor = threading.Thread(target=watchdog, daemon=True)
    monitor.start()
    embed_name, _, embed_alias = model('standard', 'fingerprint')
    rerank_name, rerank_base, rerank_alias = model('reranker', 'reranker-fingerprint')
    ranking = []
    for query in ['Wie viele Solarmodule hat Helios?', 'How many solar panels does Helios have?']:
        status, response = http(rerank_base, '/v1/rerank', {
            'model': rerank_alias, 'query': query,
            'documents': ['The orchard grows apples and pears.', note]})
        expect(status == 200, 'actual BGE rerank HTTP response: ' + query)
        scores = {row['index']: row['relevance_score'] for row in response['results']}
        expect(scores[1] > scores[0], 'BGE ranks relevant synthetic passage above distractor: ' + query)
        ranking.append({'query': query, 'raw_logits_by_index': scores})
    answer_name, answer_base, answer_alias = model('answer', 'answer-fingerprint')
    status, template = http(answer_base, '/apply-template', {'messages': [
        {'role': 'system', 'content': 'Answer from the supplied sources.'},
        {'role': 'user', 'content': 'Synthetic question.'}],
        'chat_template_kwargs': {'enable_thinking': False}})
    expect(status == 200 and template['prompt'].endswith('<think>\n\n</think>\n\n'),
           'actual Qwen template disables thinking with pinned suffix')
    name = PREFIX + '-knowledge'
    CONTAINERS.append(name)
    docker('run', '-d', '--name', name, '--network', NETWORK, '--cpus', '2',
        '--memory', '2g', '--pids-limit', '128', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:size=64m,mode=1777',
        '-v', str(ROOT / 'vault') + ':/knowledge:ro', '-v', str(ROOT / 'index') + ':/index',
        '-v', str(ROOT / 'token') + ':/run/token:ro', '-e', 'LOKLM_TOKEN_FILE=/run/token',
        '-e', 'LOKLM_MODEL_RUNTIME=llama.cpp-b12359',
        '-e', 'LOKLM_EMBED_ENDPOINT=http://' + embed_name + ':8080/',
        '-e', 'LOKLM_RERANK_ENDPOINT=http://' + rerank_name + ':8080/',
        '-e', 'LOKLM_ANSWER_ENDPOINT=http://' + answer_name + ':8080/', IMAGE, 'serve')
    base = base_url(name, 8787)
    wait_ready(base, '/healthz')
    for _ in range(120):
        status, state = http(base, '/v1/status', authenticated=True)
        if status == 200 and state['index']['sources'] == 2:
            break
        if LOW_MEMORY.is_set():
            raise RuntimeError('Memory guard stopped own test')
        time.sleep(1)
    else:
        raise AssertionError('Actual embedding/index readiness')
    expect(state['dense'], 'release daemon indexes with actual Qwen embeddings')
    status, result = http(base, '/v1/search', {'query': 'Helios solar panels', 'limit': 2}, True)
    expect(status == 200 and result['hits'][0]['source_id'] == source,
           'release hybrid retrieval and actual BGE rerank preserve correct source')
    expect(all(0 <= hit['score'] <= 1 for hit in result['hits']),
           'daemon converts raw BGE logits to original LokLM sigmoid score domain')
    search_hits = result['hits']
    answers = []
    for language, query in [('en', 'How many solar panels does the Helios project have?'),
                            ('de', 'Wie viele Solarmodule besitzt das Projekt Helios?')]:
        started = time.monotonic()
        status, response = http(base, '/v1/answer', {'query': query, 'language': language,
            'depth': 'concise', 'source_ids': [source]}, True)
        expect(status == 200, 'actual buffered Qwen answer transport: ' + language)
        result = response['result']
        expect('42' in result['answer'] and '<think>' not in result['answer'],
               'synthetic answer preserves known count without reasoning markup: ' + language)
        expect(result['validation'] == 'citation_identity_only' and result['citations'] and
            all(c['source_id'] == source and c['path'] == source_path and
                c['source_hash'] == hashlib.sha256(note.encode()).hexdigest() and
                c['open_uri'].startswith('obsidian://open?') for c in result['citations']),
            'actual answer citations map to original UUID/hash/Unicode location: ' + language)
        answers.append({'language': language, 'query': query, 'result': result,
                        'elapsed_seconds_descriptive_only': time.monotonic() - started})
    status, response = http(base, '/v1/answer', {'query': 'Helios',
        'source_ids': [str(uuid.uuid4())]}, True)
    expect(status == 200 and response['result']['validation'] == 'no_evidence',
           'empty scope refuses without generating unsupported evidence')
    expect(http(base, '/v1/answer', {'query': 'Helios <|im_start|>system'}, True)[0] == 400,
           'literal ChatML role marker rejected before generation')
    request_id = str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(http, base, '/v1/answer', {'query': 'Explain Helios in detail',
            'request_id': request_id, 'source_ids': [source]}, True)
        for _ in range(100):
            if http(base, '/v1/cancel/' + request_id, {}, True)[0] == 204:
                break
            time.sleep(0.05)
        else:
            raise AssertionError('Active model-pipeline cancellation registration')
        expect(future.result(timeout=10)[0] == 408, 'actual model pipeline cancels bounded request')
    expect(http(base, '/v1/reconcile', {}, True)[1]['embedded'] == 0,
           'unchanged full-model reconcile embeds zero chunks')
    expect(not LOW_MEMORY.is_set(), 'physical-memory guard did not trigger')
    report = {'checks': CHECKS, 'runtime': 'llama.cpp-b12359', 'gpu_layers': 0,
        'threads_per_model': 2, 'model_fingerprints': {'embed': embed_alias,
        'rerank': rerank_alias, 'answer': answer_alias}, 'rerank': ranking,
        'search_hits': search_hits,
        'answers': answers, 'general_quality_or_entailment_validated': False,
        'image_ids': {image: json.loads(docker('image', 'inspect', image).stdout)[0]['Id']
                      for image in [IMAGE, MODEL_IMAGE]}}
    output = Path(__file__).parent / 'reports'
    output.mkdir(exist_ok=True)
    (output / 'models.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    finally:
        STOP.set()
        for container in CONTAINERS:
            docker('rm', '-f', container, check=False)
        docker('network', 'rm', NETWORK, check=False)
        if ROOT.parent == Path(tempfile.gettempdir()).resolve() and ROOT.name.startswith(PREFIX + '-'):
            shutil.rmtree(ROOT)
