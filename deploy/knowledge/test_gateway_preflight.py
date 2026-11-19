import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from gateway_preflight import checks


class GatewayPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.gateway = {'environment': {'LOKLM_TLS_HOST': 'peer.example.test'},
                        'ports': [{'target': 8443, 'host_ip': '127.0.0.1'}], 'volumes': []}
        self.config = {'services': {'gateway': self.gateway}}
        for name in ['fullchain.pem', 'privkey.pem']:
            file = Path(self.tmp.name) / name
            file.write_text('synthetic presence only')
            file.chmod(0o600)
            self.gateway['volumes'].append({'type': 'bind', 'target': '/run/tls/' + name,
                                            'source': str(file), 'read_only': True})

    def test_presence_only_no_secret_reads(self):
        with patch.object(Path, 'read_text', side_effect=AssertionError('no key reads')), \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('no key reads')):
            self.assertEqual(checks(self.config), [])

    def test_hostname_injection_and_ip_rejected(self):
        for host in ['host; return 200;', 'https://peer.example.test', '*.example.test',
                     'peer.example.test:8443', '127.0.0.1', 'a..test', '-host.test']:
            self.gateway['environment']['LOKLM_TLS_HOST'] = host
            self.assertTrue(checks(self.config))

    def test_wildcard_public_and_missing_bind_rejected(self):
        for host in ['0.0.0.0', '::', '8.8.8.8', '', '224.0.0.1', '192.0.2.1']:
            self.gateway['ports'][0]['host_ip'] = host
            self.assertTrue(checks(self.config))
        self.gateway['ports'][0]['host_ip'] = '192.168.50.10'
        self.assertEqual(checks(self.config), [])
        self.gateway['ports'][0]['host_ip'] = '100.64.0.10'
        self.assertEqual(checks(self.config), [])

    def test_missing_or_writable_key_rejected(self):
        self.gateway['volumes'][1]['read_only'] = False
        self.assertTrue(checks(self.config))
        self.gateway['volumes'][1]['read_only'] = True
        Path(self.gateway['volumes'][1]['source']).unlink()
        self.assertTrue(checks(self.config))

    def test_direct_port_bypass_rejected(self):
        self.config['services']['couchdb'] = {'ports': [{'target': 5984}]}
        self.assertTrue(checks(self.config))

    def test_key_inside_canonical_tree_rejected(self):
        self.config['services']['knowledge'] = {'volumes': [
            {'type': 'bind', 'source': self.tmp.name, 'target': '/knowledge'}]}
        self.assertTrue(any('canonical vault' in issue for issue in checks(self.config)))

    @unittest.skipUnless(os.name == 'posix', 'Unix file modes')
    def test_public_key_permissions_rejected(self):
        Path(self.gateway['volumes'][1]['source']).chmod(0o644)
        self.assertTrue(checks(self.config))


if __name__ == '__main__':
    unittest.main()
