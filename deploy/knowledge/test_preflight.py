"""Synthetic directories only; no Docker, env files or credential contents read."""
from copy import deepcopy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from preflight import checks


class HostPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.config = {'services': {}, 'secrets': {}}
        for name, target, folder in (
            ('knowledge', '/knowledge', 'vault'), ('knowledge', '/index', 'index'),
            ('livesync', '/state', 'sync'), ('couchdb', '/opt/couchdb/data', 'couch'),
        ):
            path = root / folder
            path.mkdir()
            service = self.config['services'].setdefault(name, {'user': '1000:1000', 'volumes': []})
            service['volumes'].append({'type': 'bind', 'source': str(path), 'target': target})
        for name in ('api_token', 'vault_passphrase'):
            path = root / name
            path.write_text('synthetic fixture, never a credential', encoding='utf-8')
            path.chmod(0o600)
            self.config['secrets'][name] = {'file': str(path)}

    def test_valid_layout_reads_no_secret_content_and_mutates_nothing(self):
        before = deepcopy(self.config)
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('no content reads')), \
             patch.object(Path, 'read_text', side_effect=AssertionError('no content reads')):
            self.assertEqual(checks(self.config), [])
        self.assertEqual(self.config, before)

    def test_missing_host_directory(self):
        self.config['services']['knowledge']['volumes'][0]['source'] += '-missing'
        self.assertIn('knowledge: absolute existing directory required', checks(self.config))

    def test_index_inside_vault_rejected(self):
        volumes = self.config['services']['knowledge']['volumes']
        path = Path(volumes[0]['source']) / 'derived'
        path.mkdir()
        volumes[1]['source'] = str(path)
        self.assertIn('index: must be separate from the knowledge tree', checks(self.config))

    def test_vault_inside_database_rejected(self):
        couch = Path(self.config['services']['couchdb']['volumes'][0]['source'])
        vault = couch / 'notes'
        vault.mkdir()
        self.config['services']['knowledge']['volumes'][0]['source'] = str(vault)
        self.assertIn('couchdb_data: must be separate from the knowledge tree', checks(self.config))

    def test_shared_database_and_index_rejected(self):
        self.config['services']['couchdb']['volumes'][0]['source'] = self.config['services']['knowledge']['volumes'][1]['source']
        self.assertTrue(any('state directories must not overlap' in e for e in checks(self.config)))

    def test_missing_empty_secret_and_root_identity(self):
        Path(self.config['secrets']['api_token']['file']).write_bytes(b'')
        self.config['secrets'].pop('vault_passphrase')
        self.config['services']['livesync']['user'] = '0:0'
        issues = checks(self.config)
        self.assertIn('api_token: secret file is empty', issues)
        self.assertIn('vault_passphrase: private regular secret file required', issues)
        self.assertIn('livesync: explicit non-root numeric UID:GID required', issues)

    def test_duplicate_mount_is_not_guessed(self):
        mounts = self.config['services']['knowledge']['volumes']
        mounts.append(deepcopy(mounts[0]))
        self.assertIn('knowledge: missing unique bind mount', checks(self.config))

    def test_yaml_split_tmpfs_options_are_rejected(self):
        self.config['services']['knowledge']['tmpfs'] = ['/tmp:size=64m', 'mode=1777']
        self.assertTrue(any('tmpfs entries must start' in issue for issue in checks(self.config)))
        self.config['services']['knowledge']['tmpfs'] = ['/tmp:size=64m,mode=1777']
        self.assertEqual(checks(self.config), [])

    @unittest.skipUnless(os.name == 'posix', 'Unix file modes')
    def test_public_secret_permissions(self):
        Path(self.config['secrets']['api_token']['file']).chmod(0o644)
        self.assertIn('api_token: secret file must not be accessible to other users', checks(self.config))


if __name__ == '__main__':
    unittest.main()
