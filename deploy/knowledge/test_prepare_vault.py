import tempfile,unittest,uuid
from pathlib import Path
from prepare_vault import prepare

class PrepareTest(unittest.TestCase):
    def test_portable_copy_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/'source';src.mkdir();dst=root/'prepared'
            raw=b'---\r\ntitle: Unicode\r\n---\r\n# Hallo\r\n'
            (src/'Grüße.md').write_bytes(raw);(src/'image.bin').write_bytes(bytes(range(256)))
            rows=prepare(src,dst)
            self.assertEqual((src/'Grüße.md').read_bytes(),raw)
            self.assertIn(b'title: Unicode\r\n',(dst/'Grüße.md').read_bytes())
            self.assertEqual((src/'image.bin').read_bytes(),(dst/'image.bin').read_bytes())
            uuid.UUID(rows[0]['source_id'])
            with self.assertRaises(FileExistsError):prepare(src,dst)
            copy=root/'second';again=prepare(dst,copy)
            self.assertEqual(rows[0]['source_id'],again[0]['source_id'])
    def test_duplicate_identity_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/'source';src.mkdir()
            text=f'---\nloklm_id: {uuid.uuid4()}\n---\nHello'
            for n in ['a.md','b.md']:(src/n).write_text(text)
            with self.assertRaises(ValueError):prepare(src,root/'prepared')
if __name__=='__main__':unittest.main()
