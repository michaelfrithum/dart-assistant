"""Dart Assistant: authenticated, atomic Home Assistant persistence."""
import asyncio
import base64
import hashlib
from pathlib import Path
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import SOURCE_IMPORT
from .const import VERSION, STATIC_URL
from homeassistant.helpers.storage import Store
from .model import empty_data, mutate
from .audio import migrate_audio, register_audio

DOMAIN = 'dart_assistant'
CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)

async def async_setup(hass, config):
    """Set up YAML compatibility, without enabling an unconfigured installation."""
    if DOMAIN in config:
        await _async_initialize(hass)
        hass.async_create_task(hass.config_entries.flow.async_init(
            DOMAIN, context={'source': SOURCE_IMPORT}, data={}
        ))
    return True


async def async_setup_entry(hass, entry):
    """Enable one UI-configured Dart Assistant instance."""
    await _async_initialize(hass)
    return True


async def async_unload_entry(hass, entry):
    """Disable API access; persistent user files remain available for re-adding."""
    state = hass.data.get(DOMAIN)
    if state:
        state['active'] = False
        state.pop('audio_uploads', None)
    frontend.remove_extra_js_url(hass, STATIC_URL + '/dart-score-card.js?v=' + VERSION)
    return True


async def _async_initialize(hass):
    lock = hass.data.setdefault(DOMAIN + '_setup_lock', asyncio.Lock())
    async with lock:
        if DOMAIN not in hass.data:
            store = Store(hass, 1, DOMAIN)
            data = await store.async_load() or empty_data()
            data = {**empty_data(), **data}
            patch = await hass.async_add_executor_job(migrate_audio, hass, data['settings'])
            if patch:
                data['settings'].update(patch)
                await store.async_save(data)
            await hass.http.async_register_static_paths([
                StaticPathConfig(STATIC_URL, str(Path(__file__).parent / 'frontend'), False)
            ])
            hass.data[DOMAIN] = {'store': store, 'data': data, 'lock': asyncio.Lock(), 'active': True}
            register_audio(hass)
            for handler in (ws_data, ws_mutate, ws_upload):
                websocket_api.async_register_command(hass, handler)
        hass.data[DOMAIN]['active'] = True
        frontend.add_extra_js_url(hass, STATIC_URL + '/dart-score-card.js?v=' + VERSION)


def require_active(hass, connection, msg):
    if not hass.data.get(DOMAIN, {}).get('active'):
        connection.send_error(msg['id'], 'not_loaded', 'Dart Assistant ist nicht eingerichtet oder deaktiviert.')
        return False
    return True

@websocket_api.websocket_command({vol.Required('type'): DOMAIN + '/get'})
@websocket_api.async_response
async def ws_data(hass, connection, msg):
    if not require_active(hass, connection, msg):
        return
    connection.send_result(msg['id'], hass.data[DOMAIN]['data'])

@websocket_api.websocket_command({vol.Required('type'): DOMAIN + '/mutate', vol.Required('action'): str, vol.Required('payload'): dict})
@websocket_api.async_response
async def ws_mutate(hass, connection, msg):
    if not require_active(hass, connection, msg):
        return
    state = hass.data[DOMAIN]
    try:
        async with state['lock']:
            new = mutate(state['data'], msg['action'], msg['payload'])
            await state['store'].async_save(new)
            state['data'] = new
        connection.send_result(msg['id'], new)
    except (ValueError, KeyError, TypeError) as err:
        connection.send_error(msg['id'], 'invalid_data', str(err))
    except OSError:
        connection.send_error(msg['id'], 'save_failed', 'Daten konnten nicht dauerhaft gespeichert werden.')

@websocket_api.websocket_command({vol.Required('type'): DOMAIN + '/upload', vol.Required('kind'): vol.In(['logo', 'legSound', 'matchSound']), vol.Required('data'): str})
@websocket_api.async_response
async def ws_upload(hass, connection, msg):
    if not require_active(hass, connection, msg):
        return
    try:
        if not connection.user.is_admin:
            raise ValueError('Datei-Upload erfordert Administratorrechte.')
        if len(msg['data']) > 2800000:
            raise ValueError('Maximal 2 MB je Datei.')
        raw = base64.b64decode(msg['data'], validate=True)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('Maximal 2 MB je Datei.')
        if msg['kind'] == 'logo':
            if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('Bitte eine PNG-Datei wählen.')
            ext = 'png'
        else:
            if not (raw.startswith(b'ID3') or (len(raw) > 1 and raw[0] == 255 and raw[1] & 224 == 224)):
                raise ValueError('Bitte eine MP3-Datei wählen.')
            ext = 'mp3'
        name = msg['kind'].lower() + '-' + hashlib.sha256(raw).hexdigest()[:20] + '.' + ext
        path = Path(hass.config.path('www', 'dart-assistant', name))
        def write():
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix('.tmp')
            temp.write_bytes(raw)
            temp.replace(path)
        # Serialize equal-file uploads and the associated settings mutation.
        state = hass.data[DOMAIN]
        async with state['lock']:
            await hass.async_add_executor_job(write)
            new = mutate(state['data'], 'settings', {'patch': {msg['kind']: '/local/dart-assistant/' + name}})
            await state['store'].async_save(new)
            state['data'] = new
        connection.send_result(msg['id'], new)
    except (ValueError, TypeError) as err:
        connection.send_error(msg['id'], 'invalid_file', str(err))
    except OSError:
        connection.send_error(msg['id'], 'save_failed', 'Datei konnte nicht gespeichert werden.')

