"""Single-instance setup through the Home Assistant UI."""
from homeassistant import config_entries
from .const import DOMAIN


class DartAssistantConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """No credentials or external account are required."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title='Dart Assistant', data={})
        return self.async_show_form(step_id='user')

    async def async_step_import(self, import_data):
        return await self.async_step_user({})
