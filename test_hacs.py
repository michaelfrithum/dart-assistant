import asyncio
import base64
from copy import deepcopy
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile
from ha_stubs import Hass, Connection
from custom_components import dart_assistant as integration
from custom_components.dart_assistant import audio, model
from custom_components.dart_assistant.config_flow import DartAssistantConfigFlow

MP3 = b'ID3' + b'audio-test-data'

def pack(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files: archive.writestr(name, data)
    return output.getvalue()

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.hass = Hass(self.temp.name)
    def test_original_packs_and_repeat(self):
        data = pack([('Caller/Test/180.mp3', MP3), ('Caller/Test/gameon.mp3', MP3), ('Sounds/win.mp3', MP3)])
        result = audio.import_audio_pack(self.hass, data)
        self.assertEqual(result['imported'], 3)
        self.assertEqual(result['library']['callers'][0]['name'], 'Test')
        again = audio.import_audio_pack(self.hass, data)
        self.assertEqual((again['imported'], again['skipped']), (0, 3))
    def test_private_package_audio_only(self):
        data = pack([('Dart_Assistant_1.8.6/www/darts/audio/caller/Test/0.mp3', MP3),
                     ('Dart_Assistant_1.8.6/custom_components/evil.py', b'not installed')])
        result = audio.import_audio_pack(self.hass, data)
        self.assertIn('0', result['library']['callers'][0]['files'])
        self.assertFalse(list(Path(self.temp.name).rglob('*.py')))
    def test_conflict_preserves_original(self):
        audio.import_audio_pack(self.hass, pack([('sounds/win.mp3', MP3)]))
        audio.import_audio_pack(self.hass, pack([('sounds/win.mp3', MP3 + b'new')]))
        root = audio.audio_root(self.hass) / 'sounds'
        self.assertEqual((root / 'win.mp3').read_bytes(), MP3)
        self.assertEqual((root / 'win-2.mp3').read_bytes(), MP3 + b'new')
    def test_invalid_archive_and_paths(self):
        for name in ('../bad.mp3', '/sounds/bad.mp3', 'sounds/../bad.mp3', 'sounds\\bad.mp3', 'C:/bad.mp3'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                audio.import_audio_pack(self.hass, pack([(name, MP3)]))
        with self.assertRaises(ValueError): audio.import_audio_pack(self.hass, b'not zip')
    def test_all_files_checked_before_writing(self):
        data = pack([('sounds/good.mp3', MP3), ('sounds/bad.mp3', b'not audio')])
        with self.assertRaises(ValueError): audio.import_audio_pack(self.hass, data)
        self.assertFalse(list(Path(self.temp.name).rglob('*.mp3')))
    def test_duplicate_case_insensitive(self):
        with self.assertRaises(ValueError):
            audio.import_audio_pack(self.hass, pack([('sounds/X.mp3', MP3), ('Sounds/x.mp3', MP3)]))
    def test_symlink_archive(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            entry = zipfile.ZipInfo('sounds/win.mp3')
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(entry, MP3)
        with self.assertRaises(ValueError): audio.import_audio_pack(self.hass, output.getvalue())
    def test_symlink_destination(self):
        root = audio.audio_root(self.hass)
        root.mkdir(parents=True)
        (root / 'sounds').symlink_to(Path(self.temp.name), target_is_directory=True)
        with self.assertRaises(ValueError): audio.import_audio_pack(self.hass, pack([('sounds/win.mp3', MP3)]))
    def test_limits(self):
        with self.assertRaises(ValueError): audio.import_audio_pack(self.hass, b'x' * (32 * 1024 * 1024 + 1))
        with self.assertRaises(ValueError):
            audio.import_audio_pack(self.hass, pack([(f'sounds/{i}.mp3', MP3) for i in range(1025)]))
    def test_existing_settings_and_legacy_migration(self):
        root = Path(self.temp.name) / 'www'
        root.mkdir()
        (root / 'darts-leg-win.mp3').write_bytes(MP3)
        old = {'callerVoice': 'Test', 'legSound': '/local/darts-leg-win.mp3', 'matchSound': ''}
        before = deepcopy(old)
        patch = audio.migrate_audio(self.hass, old)
        self.assertEqual(old, before)
        self.assertEqual(patch['legSound'], '/local/darts/audio/sounds/darts-leg-win.mp3')
        self.assertNotIn('matchSound', patch)
        self.assertTrue((root / 'darts-leg-win.mp3').exists())

class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        old = model.empty_data()
        old['settings']['callerVoice'] = 'Existing Voice'
        old['profiles'] = [{'id': 'old-id', 'name': 'Existing Player'}]
        self.hass = Hass(self.temp.name, old)
    async def test_unconfigured_setup_does_not_activate(self):
        await integration.async_setup(self.hass, {})
        self.assertNotIn('dart_assistant', self.hass.data)
    async def test_ui_setup_once_and_unload_readd(self):
        await integration.async_setup_entry(self.hass, object())
        state = self.hass.data['dart_assistant']
        self.assertEqual(state['data']['profiles'][0]['id'], 'old-id')
        self.assertEqual(state['data']['settings']['callerVoice'], 'Existing Voice')
        self.assertEqual(len(self.hass.paths), 1)
        commands = len(self.hass.commands)
        await integration.async_setup_entry(self.hass, object())
        self.assertEqual(len(self.hass.commands), commands)
        self.assertEqual(len(self.hass.paths), 1)
        await integration.async_unload_entry(self.hass, object())
        self.assertFalse(self.hass.urls)
        conn = Connection()
        await integration.ws_data(self.hass, conn, {'id': 1})
        self.assertEqual(conn.errors[0][0], 'not_loaded')
        await integration.async_setup_entry(self.hass, object())
        self.assertTrue(self.hass.urls)
        self.assertEqual(state['data']['profiles'][0]['id'], 'old-id')
    async def test_yaml_import(self):
        await integration.async_setup(self.hass, {'dart_assistant': {}})
        await asyncio.sleep(0)
        self.assertEqual(self.hass.imports[0][1]['context']['source'], 'import')
    async def test_config_flow_singleton(self):
        flow = DartAssistantConfigFlow()
        self.assertEqual((await flow.async_step_user())['type'], 'form')
        self.assertEqual((await flow.async_step_user({}))['type'], 'create_entry')
        flow.configured = True
        with self.assertRaises(ValueError): await flow.async_step_user({})
    async def test_pack_admin_upload_and_disabled_api(self):
        await integration.async_setup_entry(self.hass, object())
        msg = {'id': 1, 'folder': 'import', 'filename': 'sounds.zip', 'uploadId': 'test-upload-id',
               'part': 0, 'final': True, 'data': base64.b64encode(pack([('sounds/win.mp3', MP3)])).decode()}
        conn = Connection(False)
        await audio.ws_audio_upload(self.hass, conn, msg)
        self.assertTrue(conn.errors)
        conn = Connection()
        await audio.ws_audio_upload(self.hass, conn, msg)
        self.assertEqual(conn.results[0]['imported'], 1)
        await integration.async_unload_entry(self.hass, object())
        conn = Connection()
        await audio.ws_audio_upload(self.hass, conn, msg)
        self.assertTrue(conn.errors)

if __name__ == '__main__': unittest.main()
