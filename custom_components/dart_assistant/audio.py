"""Dart audio library: filesystem discovery and non-destructive ZIP import."""
import asyncio
import io
import stat
import zipfile
import hashlib
import shutil
import time
from pathlib import Path
from urllib.parse import quote
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
from homeassistant.components import websocket_api

DOMAIN = 'dart_assistant'

def import_audio_pack(hass, raw):
    """Validate the entire archive before importing MP3s without overwrites."""
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('ZIP maximal 32 MB.')
    planned = []
    destinations = set()
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if len(archive.infolist()) > 1024:
                raise ValueError('Das Paket enthält zu viele Einträge.')
            for entry in archive.infolist():
                name = entry.filename
                parts = name.rstrip('/').split('/')
                if (name.startswith('/') or '\\' in name or ':' in name
                        or any(p in ('', '.', '..') for p in parts)
                        or stat.S_ISLNK(entry.external_attr >> 16)):
                    raise ValueError('Unsicherer Pfad im Soundpaket.')
                if entry.is_dir():
                    continue
                if not name.lower().endswith('.mp3'):
                    continue
                lower = [p.casefold() for p in parts]
                # Also accept the private portable package's www/darts/audio tree.
                for index in range(len(lower) - 2):
                    if lower[index:index + 3] == ['www', 'darts', 'audio']:
                        parts, lower = parts[index + 3:], lower[index + 3:]
                        break
                if len(parts) == 2 and lower[0] == 'sounds':
                    folder = 'sounds'
                elif len(parts) == 3 and lower[0] == 'caller':
                    voice = parts[1]
                    if len(voice) > 120 or any(ord(c) < 32 for c in voice):
                        raise ValueError('Ungültiger Sprecherordner.')
                    folder = 'caller/' + voice
                else:
                    raise ValueError('ZIP-Struktur: sounds/*.mp3 oder caller/Stimme/*.mp3.')
                filename = parts[-1]
                if len(filename) > 160 or any(ord(c) < 32 for c in filename):
                    raise ValueError('Ungültiger MP3-Dateiname.')
                key = (folder.casefold(), filename.casefold())
                if key in destinations:
                    raise ValueError('Doppelte MP3-Datei im Soundpaket.')
                destinations.add(key)
                total += entry.file_size
                if entry.file_size > 32 * 1024 * 1024 or total > 64 * 1024 * 1024:
                    raise ValueError('Soundpaket entpackt maximal 64 MB, je MP3 maximal 32 MB.')
                audio = archive.read(entry)
                if not (audio.startswith(b'ID3') or (len(audio) > 1
                        and audio[0] == 255 and audio[1] & 224 == 224)):
                    raise ValueError('Das Paket enthält eine ungültige MP3-Datei.')
                planned.append((folder, filename, audio))
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError) as err:
        raise ValueError('ZIP ist beschädigt, verschlüsselt oder nicht unterstützt.') from err
    if not planned:
        raise ValueError('Keine MP3-Dateien im Soundpaket gefunden.')
    root = audio_root(hass)
    for folder, _, _ in planned:
        target = root / folder
        if (not target.resolve().is_relative_to(root.resolve())
                or any(p.is_symlink() for p in (root, root / 'caller', root / 'sounds', target))):
            raise ValueError('Ungültiger Zielordner.')
    created = []
    imported = skipped = 0
    try:
        for folder, filename, audio in planned:
            (root / folder).mkdir(parents=True, exist_ok=True)
            result = store_audio(hass, audio, folder, filename, include_library=False)
            if result['existing']:
                skipped += 1
            else:
                created.append(root / folder / result['name'])
                imported += 1
        return {'imported': imported, 'skipped': skipped, 'library': scan_audio(hass)}
    except (OSError, ValueError):
        # Roll back only newly created files; never touch pre-existing user files.
        for path in created:
            path.unlink(missing_ok=True)
        raise

def audio_root(hass):
    return Path(hass.config.path('www', 'darts', 'audio'))

def scan_audio(hass):
    root = audio_root(hass)
    for kind in ('sounds', 'caller'):
        (root / kind).mkdir(parents=True, exist_ok=True)
    sounds = []
    callers = []
    def item(path):
        rel = path.relative_to(root).as_posix()
        return {'name': path.name, 'url': '/local/darts/audio/' + quote(rel, safe='/'), 'revision': str(path.stat().st_mtime_ns)}
    for path in sorted((root / 'sounds').iterdir(), key=lambda p: p.name.casefold()):
        if path.is_file() and not path.is_symlink() and path.suffix.lower() == '.mp3':
            sounds.append(item(path))
    for folder in sorted((root / 'caller').iterdir(), key=lambda p: p.name.casefold()):
        if folder.is_dir() and not folder.is_symlink():
            files = {}
            for path in sorted(folder.iterdir(), key=lambda p: p.name.casefold()):
                if path.is_file() and not path.is_symlink() and path.suffix.lower() == '.mp3':
                    files[path.stem.casefold()] = item(path)
            callers.append({'name': folder.name, 'files': files})
    return {'sounds': sounds, 'callers': callers, 'version': 1}

def migrate_audio(hass, settings):
    root = audio_root(hass)
    (root / 'sounds').mkdir(parents=True, exist_ok=True)
    (root / 'caller').mkdir(parents=True, exist_ok=True)
    sources = {'legSound': settings.get('legSound') or '/local/darts-leg-win.mp3', 'matchSound': settings.get('matchSound') or '/local/darts-match-win.mp3'}
    patch = {}
    www = Path(hass.config.path('www')).resolve()
    for key, url in sources.items():
        if key in settings and not settings[key]:
            continue
        if url.startswith('/local/darts/audio/sounds/'):
            continue
        if not url.startswith('/local/'):
            continue
        source = www / url[len('/local/'):]
        if not source.resolve().is_relative_to(www) or not source.is_file() or source.is_symlink():
            continue
        target = root / 'sounds' / source.name
        if target.exists() and target.read_bytes() != source.read_bytes():
            target = target.with_name(target.stem + '-' + hashlib.sha256(source.read_bytes()).hexdigest()[:10] + '.mp3')
        if not target.exists():
            shutil.copy2(source, target)
        patch[key] = '/local/darts/audio/sounds/' + quote(target.name, safe='')
    return patch

def store_audio(hass, raw, folder, filename, include_library=True):
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError('MP3 maximal 32 MB.')
    if not (raw.startswith(b'ID3') or (len(raw) > 1 and raw[0] == 255 and raw[1] & 224 == 224)):
        raise ValueError('Bitte eine gültige MP3-Datei auswählen.')
    if not isinstance(filename, str) or not filename.lower().endswith('.mp3') or len(filename) > 160 or any(ord(c) < 32 or c in '/\\:' for c in filename):
        raise ValueError('Ungültiger MP3-Dateiname.')
    root = audio_root(hass)
    if folder == 'sounds':
        target_dir = root / 'sounds'
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        parts = folder.split('/')
        if len(parts) != 2 or parts[0] != 'caller' or parts[1] in ('', '.', '..') or any(c in parts[1] for c in ('\\', '\x00')):
            raise ValueError('Bitte einen vorhandenen Zielordner auswählen.')
        target_dir = root / 'caller' / parts[1]
        if not target_dir.is_dir():
            raise ValueError('Sprecherordner fehlt. Bitte Dateiliste aktualisieren.')
    if not target_dir.resolve().is_relative_to(root.resolve()) or any(p.is_symlink() for p in (root, target_dir, target_dir.parent)):
        raise ValueError('Ungültiger Zielordner.')
    names = {p.name.casefold(): p for p in target_dir.iterdir()}
    target = target_dir / filename
    existing = names.get(filename.casefold())
    if existing:
        if existing.is_symlink() or not existing.is_file():
            raise ValueError('Dieser Name kann nicht verwendet werden.')
        if existing.read_bytes() == raw:
            return {'name': existing.name, 'existing': True, 'renamed': False, **({'library': scan_audio(hass)} if include_library else {})}
        stem = Path(filename).stem
        suffix = 2
        while (stem + '-' + str(suffix) + '.mp3').casefold() in names:
            candidate = names[(stem + '-' + str(suffix) + '.mp3').casefold()]
            if candidate.is_file() and not candidate.is_symlink() and candidate.read_bytes() == raw:
                return {'name': candidate.name, 'existing': True, 'renamed': False, **({'library': scan_audio(hass)} if include_library else {})}
            suffix += 1
        target = target_dir / (stem + '-' + str(suffix) + '.mp3')
    with target.open('xb') as output:
        output.write(raw)
    return {'name': target.name, 'existing': False, 'renamed': target.name != filename, **({'library': scan_audio(hass)} if include_library else {})}

@websocket_api.websocket_command({vol.Required('type'): DOMAIN + '/audio_list'})
@websocket_api.async_response
async def ws_audio_list(hass, connection, msg):
    try:
        if not hass.data.get(DOMAIN, {}).get('active'):
            raise ValueError('Dart Assistant ist deaktiviert.')
        library = await hass.async_add_executor_job(scan_audio, hass)
        connection.send_result(msg['id'], library)
    except (OSError, ValueError):
        connection.send_error(msg['id'], 'audio_scan_failed', 'Audio-Dateiliste konnte nicht gelesen werden.')

@websocket_api.websocket_command({vol.Required('type'): DOMAIN + '/audio_upload', vol.Required('folder'): str, vol.Required('filename'): str, vol.Required('data'): str, vol.Required('uploadId'): str, vol.Required('part'): int, vol.Required('final'): bool})
@websocket_api.async_response
async def ws_audio_upload(hass, connection, msg):
    import base64
    try:
        if not hass.data.get(DOMAIN, {}).get('active'):
            raise ValueError('Dart Assistant ist deaktiviert.')
        if not connection.user.is_admin:
            raise ValueError('Audio-Upload erfordert Administratorrechte.')
        encoded = msg['data']
        if len(encoded) > 600000 or not 8 <= len(msg['uploadId']) <= 100:
            raise ValueError('Ungültiger Übertragungsblock.')
        state = hass.data[DOMAIN]
        uploads = state.setdefault('audio_uploads', {})
        now = time.monotonic()
        for key in list(uploads):
            if now - uploads[key]['time'] > 300:
                del uploads[key]
        key = connection.user.id + ':' + msg['uploadId']
        if msg['part'] == 0:
            for stale in list(uploads):
                if stale.startswith(connection.user.id + ':'):
                    del uploads[stale]
            if len(uploads) >= 2:
                raise ValueError('Ein anderer Upload läuft bereits.')
            uploads[key] = {'chunks': [], 'size': 0, 'folder': msg['folder'], 'filename': msg['filename'], 'time': now}
        upload = uploads.get(key)
        if not upload or msg['part'] != len(upload['chunks']) or upload['folder'] != msg['folder'] or upload['filename'] != msg['filename']:
            raise ValueError('Upload abgebrochen. Bitte MP3 erneut auswählen.')
        upload['size'] += len(encoded)
        if upload['size'] > 45 * 1024 * 1024:
            del uploads[key]
            raise ValueError('MP3 maximal 32 MB.')
        upload['chunks'].append(encoded)
        upload['time'] = now
        if not msg['final']:
            connection.send_result(msg['id'], {'received': upload['size']})
            return
        raw = base64.b64decode(''.join(uploads.pop(key)['chunks']), validate=True)
        async with state['lock']:
            if msg['folder'] == 'import':
                result = await hass.async_add_executor_job(import_audio_pack, hass, raw)
            else:
                result = await hass.async_add_executor_job(store_audio, hass, raw, msg['folder'], msg['filename'])
        connection.send_result(msg['id'], result)
    except (ValueError, TypeError) as err:
        connection.send_error(msg['id'], 'invalid_audio_file', str(err))
    except OSError:
        connection.send_error(msg['id'], 'audio_upload_failed', 'MP3 konnte nicht gespeichert werden. Bitte Dateiliste prüfen und erneut versuchen.')

def register_audio(hass):
    websocket_api.async_register_command(hass, ws_audio_list)
    websocket_api.async_register_command(hass, ws_audio_upload)

