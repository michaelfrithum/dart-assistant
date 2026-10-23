"""Minimal HA interfaces for isolated tests; not a Home Assistant emulator."""
import asyncio
from copy import deepcopy
import sys
from types import ModuleType, SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def install():
    for name in ('homeassistant', 'homeassistant.components', 'homeassistant.components.frontend',
                 'homeassistant.components.websocket_api', 'homeassistant.components.http',
                 'homeassistant.helpers', 'homeassistant.helpers.storage', 'homeassistant.config_entries',
                 'voluptuous'):
        sys.modules[name] = ModuleType(name)
    vol = sys.modules['voluptuous']
    vol.Schema = lambda *a, **k: object()
    vol.Required = lambda key: key
    vol.In = lambda values: values
    vol.ALLOW_EXTRA = object()
    ws = sys.modules['homeassistant.components.websocket_api']
    ws.websocket_command = lambda schema: lambda handler: handler
    ws.async_response = lambda handler: handler
    ws.async_register_command = lambda hass, handler: hass.commands.append(handler)
    fe = sys.modules['homeassistant.components.frontend']
    fe.add_extra_js_url = lambda hass, url: hass.urls.add(url)
    fe.remove_extra_js_url = lambda hass, url: hass.urls.discard(url)
    class StaticPathConfig:
        def __init__(self, url_path, path, cache_headers):
            self.url_path, self.path, self.cache_headers = url_path, path, cache_headers
    sys.modules['homeassistant.components.http'].StaticPathConfig = StaticPathConfig
    class Store:
        def __init__(self, hass, version, key): self.hass = hass
        async def async_load(self): return deepcopy(self.hass.saved)
        async def async_save(self, value): self.hass.saved = deepcopy(value)
    sys.modules['homeassistant.helpers.storage'].Store = Store
    entries = sys.modules['homeassistant.config_entries']
    entries.SOURCE_IMPORT = 'import'
    class ConfigFlow:
        def __init_subclass__(cls, **kwargs): pass
        async def async_set_unique_id(self, uid): self.uid = uid
        def _abort_if_unique_id_configured(self):
            if getattr(self, 'configured', False): raise ValueError('already_configured')
        def async_create_entry(self, **kwargs): return {'type': 'create_entry', **kwargs}
        def async_show_form(self, **kwargs): return {'type': 'form', **kwargs}
    entries.ConfigFlow = ConfigFlow

class Hass:
    def __init__(self, directory, saved=None):
        self.data, self.urls, self.commands, self.paths = {}, set(), [], []
        self.saved = deepcopy(saved)
        self.config = SimpleNamespace(path=lambda *parts: str(Path(directory).joinpath(*parts)))
        self.http = SimpleNamespace(async_register_static_paths=self.register_paths)
        self.imports = []
        self.config_entries = SimpleNamespace(flow=SimpleNamespace(async_init=self.import_flow))
    async def register_paths(self, paths): self.paths.extend(paths)
    async def import_flow(self, *a, **k): self.imports.append((a, k))
    def async_create_task(self, coro): return asyncio.create_task(coro)
    async def async_add_executor_job(self, func, *args): return func(*args)

class Connection:
    def __init__(self, admin=True):
        self.user = SimpleNamespace(id='test-user', is_admin=admin)
        self.results, self.errors = [], []
    def send_result(self, mid, result): self.results.append(result)
    def send_error(self, mid, code, message): self.errors.append((code, message))

install()
