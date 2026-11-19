import unittest
from unittest.mock import patch
from manage import conflict_rows, conflicts, doctor


class ManageTests(unittest.TestCase):
    def test_upstream_conflict_listing(self):
        result = conflict_rows('Grüße/Note.md\t42\t2026-11-19\t2-abcdef*\nOther.md\t1\t123\t1-deadbeef\n')
        self.assertEqual(result['files'], 2)
        self.assertEqual(result['conflicts'], [{'path': 'Grüße/Note.md', 'winning_revision': '2-abcdef'}])
        self.assertEqual(conflict_rows('')['files'], 0)

    def test_malformed_listing_fails_closed(self):
        for raw in ['warning: connection failed', 'note.md\t1\t123\tunknown', 'note.md\tx\t123\t1-ab']:
            with self.assertRaises(ValueError):
                conflict_rows(raw)

    def test_running_daemon_never_opens_second_database(self):
        with patch('manage.service_states', return_value={'livesync': 'running'}), patch('manage.run') as runner:
            with self.assertRaises(RuntimeError):
                conflicts(['docker', 'compose'])
            runner.assert_not_called()

    def test_stopped_stack_is_not_ready(self):
        with patch('manage.service_states', return_value={}), patch('manage.run') as runner:
            self.assertFalse(doctor(['docker', 'compose'])['operational'])
            runner.assert_not_called()


if __name__ == '__main__':
    unittest.main()
