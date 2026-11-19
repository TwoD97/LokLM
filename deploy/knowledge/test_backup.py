import io,tarfile,tempfile,unittest
from pathlib import Path
from backup import backup,verify

class BackupTest(unittest.TestCase):
    def test_roundtrip_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);vault=root/'vault';vault.mkdir()
            (vault/'Überblick.md').write_text('---\nloklm_id: synthetic\n---\n# Wissen')
            (vault/'attachment.bin').write_bytes(bytes(range(256)))
            archive=root/'source.tar.gz';backup(vault,archive)
            self.assertEqual(verify(archive),2)
            restore=root/'restore';self.assertEqual(verify(archive,restore),2)
            self.assertEqual((restore/'attachment.bin').read_bytes(),bytes(range(256)))
            with self.assertRaises(FileExistsError):verify(archive,restore)
    def test_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'hostile.tar.gz'
            with tarfile.open(path,'w:gz') as tar:
                info=tarfile.TarInfo('../escape');info.size=1;tar.addfile(info,io.BytesIO(b'x'))
            with self.assertRaises(ValueError):verify(path)
if __name__=='__main__':unittest.main()
