"""Config and options flow for MeshMap."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_ENTRIES,
    CONF_REFRESH_SECONDS,
    CONF_STALE_AFTER_HOURS,
    CONF_TILE_ATTRIBUTION,
    CONF_TILE_URL,
    DEFAULT_REFRESH_SECONDS,
    DEFAULT_STALE_AFTER_HOURS,
    DEFAULT_TILE_ATTRIBUTION,
    DEFAULT_TILE_URL,
    DOMAIN,
    MESHCORE_DOMAIN,
)


def _int_box(minimum: int, maximum: int, unit: str):
    """Return a validator for a whole number in a range."""
    return vol.All(
        selector.NumberSelector(
            selector.NumberSelectorConfig(
                min=minimum,
                max=maximum,
                step=1,
                mode=selector.NumberSelectorMode.BOX,
                unit_of_measurement=unit,
            )
        ),
        vol.Coerce(int),
    )


def _valid_tile_url(url: str) -> bool:
    """Check that the tile URL is http(s) and has the z, x and y placeholders."""
    return url.startswith(("https://", "http://")) and all(
        part in url for part in ("{z}", "{x}", "{y}")
    )


class MeshMapConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create the single MeshMap entry."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> ConfigFlowResult:
        """Confirm setup, or abort when MeshCore has no entries."""
        if not self.hass.config_entries.async_entries(MESHCORE_DOMAIN):
            return self.async_abort(reason="meshcore_not_configured")
        if user_input is not None:
            return self.async_create_entry(title="MeshMap", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return MeshMapOptionsFlow()


class MeshMapOptionsFlow(OptionsFlow):
    """Edit the MeshMap options."""

    async def async_step_init(self, user_input=None) -> ConfigFlowResult:
        """Show and store the options."""
        errors = {}
        if user_input is not None:
            user_input[CONF_TILE_URL] = user_input[CONF_TILE_URL].strip()
            if _valid_tile_url(user_input[CONF_TILE_URL]):
                return self.async_create_entry(data=user_input)
            errors[CONF_TILE_URL] = "invalid_tile_url"

        options = user_input or self.config_entry.options
        meshcore = {
            entry.entry_id: entry.title
            for entry in self.hass.config_entries.async_entries(MESHCORE_DOMAIN)
        }
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_ENTRIES,
                    default=[
                        entry_id
                        for entry_id in options.get(CONF_ENTRIES) or []
                        if entry_id in meshcore
                    ],
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(value=entry_id, label=title)
                            for entry_id, title in meshcore.items()
                        ],
                        multiple=True,
                    )
                ),
                vol.Required(
                    CONF_STALE_AFTER_HOURS,
                    default=options.get(
                        CONF_STALE_AFTER_HOURS, DEFAULT_STALE_AFTER_HOURS
                    ),
                ): _int_box(1, 720, "h"),
                vol.Required(
                    CONF_REFRESH_SECONDS,
                    default=options.get(CONF_REFRESH_SECONDS, DEFAULT_REFRESH_SECONDS),
                ): _int_box(15, 3600, "s"),
                vol.Required(
                    CONF_TILE_URL,
                    default=options.get(CONF_TILE_URL, DEFAULT_TILE_URL),
                ): selector.TextSelector(),
                vol.Required(
                    CONF_TILE_ATTRIBUTION,
                    default=options.get(
                        CONF_TILE_ATTRIBUTION, DEFAULT_TILE_ATTRIBUTION
                    ),
                ): selector.TextSelector(),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
