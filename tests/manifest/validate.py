#!/usr/bin/env python3
"""Static validator for the Home Assistant App manifests in this repository.

Checks `<app>/config.yaml`, `<app>/translations/en.yaml`, `<app>/Dockerfile`,
`<app>/CHANGELOG.md`, optional `<app>/build.yaml` and `repository.yaml` against

  * the Home Assistant App configuration reference
    (developers.home-assistant.io/docs/apps/configuration, verified 2026-11-20
    at developers.home-assistant commit 50b5188), and
  * this project's security posture (AGENTS.md section 3, docs/security/).

It is a static check. It does not prove that Supervisor accepts the manifest
or that the App works; see docs/testing/test-plan.md.

Output: one line per finding, `LEVEL id: message`.
  FAIL  violates a requirement; exit status 1.
  WARN  release-blocking or worth a decision; exit status 0 unless --strict.
  INFO  context only.
Dependencies: Python 3.9+ and PyYAML (run through tests/manifest/run.sh, which
falls back to a pinned container when the host has no PyYAML).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

UPSTREAM_IMAGE = "ghcr.io/sauveteur71/live-mesh-map-world"
SUPPORTED_ARCH = {"amd64", "aarch64"}
REQUIRED_ARCH = {"amd64", "aarch64"}
REQUIRED_KEYS = ("name", "version", "slug", "description", "arch")
INGRESS_PORT = 8099

# Keys that must be absent or false. Values are the reason shown on failure.
FORBIDDEN_TRUE = {
    "host_network": "host networking",
    "host_ipc": "host IPC namespace",
    "host_pid": "host PID namespace",
    "host_dbus": "host D-Bus",
    "host_uts": "host UTS namespace",
    "full_access": "full hardware access (privileged mode)",
    "docker_api": "Docker API access",
    "usb": "raw USB access",
    "uart": "automatic serial device mapping",
    "gpio": "GPIO access",
    "udev": "host udev database",
    "kernel_modules": "kernel modules and SYS_MODULE",
    "devicetree": "device tree",
    "video": "video devices",
    "audio": "audio system",
    "realtime": "host scheduler access",
    "journald": "host journal",
    "auth_api": "Home Assistant user backend (not needed with Ingress)",
    "homeassistant_api": "Home Assistant Core API proxy",
    "legacy": "legacy label-less image mode",
    "stdin": "STDIN control channel",
}
# `map` types that expose broad host or Home Assistant data.
FORBIDDEN_MAP = {
    "homeassistant_config", "config", "all_app_configs", "all_addon_configs",
    "local_apps", "addons", "backup", "ssl", "share", "media",
}
SECRET_NAME = re.compile(
    r"(password|passwd|passphrase|secret|token|api_?key|psk|private_?key|"
    r"mot_?de_?passe|jeton|credential|(?:setup|install|access)_?code)", re.I)
LORA_SEND_NAME = re.compile(r"lora", re.I)
TRUTHY = {"1", "true", "yes", "on", "oui", "y"}
SCALAR_TYPE = re.compile(
    r"^(?P<base>str|bool|int|float|email|url|password|port|match|list|device)"
    r"(?:\((?P<arg>.*)\))?(?P<opt>\?)?$", re.S)
VERSION = re.compile(r"^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.+-]+)?$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
DIGEST = re.compile(r"@sha256:[0-9a-f]{64}$")


class Report:
    def __init__(self) -> None:
        self.findings: list[tuple[str, str, str]] = []

    def add(self, level: str, ident: str, message: str) -> None:
        self.findings.append((level, ident, message))

    def fail(self, ident: str, message: str) -> None:
        self.add("FAIL", ident, message)

    def warn(self, ident: str, message: str) -> None:
        self.add("WARN", ident, message)

    def info(self, ident: str, message: str) -> None:
        self.add("INFO", ident, message)

    def ids(self, level: str) -> set[str]:
        return {i for lvl, i, _ in self.findings if lvl == level}

    def count(self, level: str) -> int:
        return sum(1 for lvl, _, _ in self.findings if lvl == level)


def load_yaml(path: Path, report: Report, ident: str):
    try:
        with path.open(encoding="utf-8") as handle:
            return yaml.safe_load(handle)
    except FileNotFoundError:
        report.fail(ident, f"{path} is missing")
    except yaml.YAMLError as err:
        report.fail(ident, f"{path} is not valid YAML: {err}")
    return None


# --------------------------------------------------------------------------
# options / schema
# --------------------------------------------------------------------------

def parse_type(spec):
    """Returns (base, arg, optional) for a scalar schema type, else None."""
    if not isinstance(spec, str):
        return None
    match = SCALAR_TYPE.match(spec.strip())
    if not match:
        return None
    return match.group("base"), match.group("arg"), bool(match.group("opt"))


def _in_range(value, arg) -> bool:
    if not arg:
        return True
    low, _, high = arg.partition(",")
    try:
        if low.strip() and value < float(low):
            return False
        if high.strip() and value > float(high):
            return False
    except ValueError:
        return True
    return True


def value_matches(value, base: str, arg) -> bool:
    """Whether a default value satisfies a scalar schema type."""
    if base == "bool":
        return isinstance(value, bool)
    if base in ("int", "port"):
        if isinstance(value, bool) or not isinstance(value, int):
            return False
        if base == "port":
            return 1 <= value <= 65535
        return _in_range(value, arg)
    if base == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        return _in_range(value, arg)
    if not isinstance(value, str):
        return False
    if base == "str":
        return _in_range(len(value), arg)
    if base == "list":
        return value in (arg or "").split("|")
    if base == "match":
        try:
            return re.search(arg or "", value) is not None
        except re.error:
            return True
    if base == "url":
        return re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://\S+$", value) is not None
    if base == "email":
        return "@" in value
    return True  # password, device


def check_schema_node(report: Report, path: str, schema, has_default: bool,
                      default, require_default: bool = True) -> None:
    """Recursively compares one schema node with its default value.

    require_default=False checks types and secret naming only; it is used for
    the item schema of a list whose default is empty.
    """
    if isinstance(schema, dict):
        if has_default and not isinstance(default, dict):
            report.fail("options-type", f"option '{path}' must be a mapping")
            default = {}
        default = default if isinstance(default, dict) else {}
        for key in default:
            if key not in schema:
                report.fail("options-without-schema",
                            f"option '{path}.{key}' has no schema entry")
        for key, sub in schema.items():
            check_schema_node(report, f"{path}.{key}", sub, key in default,
                              default.get(key), require_default)
        return
    if isinstance(schema, list):
        if len(schema) != 1:
            report.fail("schema-type",
                        f"schema list for '{path}' must have exactly one item")
            return
        if not has_default:
            if require_default:
                report.fail("schema-without-default",
                            f"list option '{path}' has no default; use [] in options")
            default = []
        if not isinstance(default, list):
            report.fail("options-type", f"option '{path}' must be a list")
            return
        if not default:
            check_schema_node(report, f"{path}[]", schema[0], False, None, False)
        for index, item in enumerate(default):
            check_schema_node(report, f"{path}[{index}]", schema[0], True, item)
        return

    parsed = parse_type(schema)
    if parsed is None:
        report.fail("schema-type",
                    f"schema for '{path}' has unsupported type {schema!r}")
        return
    base, arg, optional = parsed
    leaf = re.sub(r"\[\d*\]$", "", path.split(".")[-1])

    if SECRET_NAME.search(leaf) and base != "password":
        report.fail("secret-not-password-type",
                    f"option '{path}' looks like a secret but has type "
                    f"{schema!r}; use 'password' so the UI masks it")
    if base == "password" and has_default and default not in ("", None):
        report.fail("secret-default-value",
                    f"password option '{path}' ships a non-empty default")

    if not has_default or default is None:
        if not optional and require_default:
            report.fail("schema-without-default",
                        f"schema key '{path}' is mandatory but has no default "
                        f"in options: a fresh install cannot start. Give it a "
                        f"default or mark the type optional ('{schema}?')")
        return
    if not value_matches(default, base, arg):
        report.fail("options-type",
                    f"default for '{path}' ({default!r}) does not satisfy "
                    f"schema type {schema!r}")


def check_options(report: Report, config: dict) -> None:
    options = config.get("options")
    schema = config.get("schema")
    if schema is False:
        report.fail("schema-disabled", "schema: false disables option validation")
        return
    if options is None and schema is None:
        report.info("options", "no options/schema defined")
        return
    if not isinstance(options, dict) or not isinstance(schema, dict):
        report.fail("options-type", "options and schema must both be mappings")
        return
    for key in options:
        if key not in schema:
            report.fail("options-without-schema",
                        f"option '{key}' has no schema entry")
    for key, sub in schema.items():
        check_schema_node(report, key, sub, key in options, options.get(key))
    report.info("options", f"{len(schema)} schema keys, {len(options)} defaults")


def check_lora_default(report: Report, config: dict, dockerfile_text) -> None:
    options = config.get("options") if isinstance(config.get("options"), dict) else {}
    schema = config.get("schema") if isinstance(config.get("schema"), dict) else {}
    keys = [k for k in schema if LORA_SEND_NAME.search(k)]
    for key in keys:
        parsed = parse_type(schema[key])
        value = options.get(key)
        if parsed and parsed[0] == "bool":
            if value is True:
                report.fail("lora-send-default-on",
                            f"option '{key}' defaults to true; MQTT-to-LoRa "
                            f"transmission must be off by default")
        elif isinstance(value, str) and value.strip().lower() in TRUTHY:
            report.fail("lora-send-default-on",
                        f"option '{key}' defaults to {value!r}")
    environment = config.get("environment") or {}
    if isinstance(environment, dict):
        value = str(environment.get("DOMOTIQUE_ENVOI_LORA", "")).strip().lower()
        if value in TRUTHY:
            report.fail("lora-send-default-on",
                        "config.yaml environment enables DOMOTIQUE_ENVOI_LORA")
    if dockerfile_text and re.search(
            r"DOMOTIQUE_ENVOI_LORA[=\s]+[\"']?(1|true|yes|on|oui|y)\b",
            dockerfile_text, re.I):
        report.fail("lora-send-default-on",
                    "Dockerfile enables DOMOTIQUE_ENVOI_LORA")
    if keys:
        report.info("lora-send", f"LoRa option(s) checked: {', '.join(keys)}")
    else:
        report.info("lora-send",
                    "no LoRa option in schema; transmit cannot be enabled "
                    "from the options UI (runtime default is verified by "
                    "tests/integration)")


# --------------------------------------------------------------------------
# config.yaml
# --------------------------------------------------------------------------

def check_security(report: Report, config: dict) -> None:
    for key, reason in FORBIDDEN_TRUE.items():
        if config.get(key) not in (None, False):
            report.fail(f"forbidden-{key}", f"'{key}' must be absent or false: {reason}")
    if config.get("privileged"):
        report.fail("forbidden-privileged",
                    f"'privileged' requests capabilities {config['privileged']!r}")
    if config.get("devices"):
        report.fail("forbidden-devices",
                    f"'devices' maps host devices {config['devices']!r} by default")
    if config.get("apparmor") is False:
        report.fail("forbidden-apparmor-disabled", "'apparmor: false' disables AppArmor")
    if config.get("hassio_role") not in (None, "default"):
        report.fail("forbidden-hassio-role",
                    f"hassio_role {config['hassio_role']!r} exceeds 'default'")
    if config.get("hassio_api") not in (None, False):
        report.warn("hassio-api",
                    "'hassio_api: true' is set; GET /services/mqtt works with "
                    "'services: [mqtt:want]' alone. Confirm it is needed.")
    if config.get("panel_admin") is False:
        report.warn("panel-admin",
                    "'panel_admin: false' exposes the Ingress panel to "
                    "non-admin Home Assistant users")

    for entry in config.get("map") or []:
        if isinstance(entry, dict):
            kind = str(entry.get("type", ""))
        else:
            kind = str(entry).split(":")[0]
        if kind in FORBIDDEN_MAP:
            report.fail("forbidden-map", f"'map' mounts '{kind}' into the container")
        elif kind not in ("data", "app_config", "addon_config"):
            report.fail("forbidden-map", f"'map' has unexpected entry {entry!r}")

    ports = config.get("ports") or {}
    if not isinstance(ports, dict):
        report.fail("ports-type", "'ports' must be a mapping")
        ports = {}
    for container_port, host_port in ports.items():
        if host_port is not None:
            report.fail("port-published-by-default",
                        f"port {container_port} is published on host port "
                        f"{host_port} by default; use null so the user opts in")
    if any(str(p).startswith(str(INGRESS_PORT)) for p in ports):
        report.fail("ingress-port-published",
                    f"the Ingress port {INGRESS_PORT} must not appear in 'ports'")

    if config.get("ingress") is not True:
        report.fail("ingress-disabled", "'ingress: true' is required")
    if config.get("ingress_port", INGRESS_PORT) != INGRESS_PORT:
        report.fail("ingress-port",
                    f"ingress_port must be {INGRESS_PORT} (project interface), "
                    f"found {config.get('ingress_port')!r}")
    webui = config.get("webui")
    if webui:
        report.warn("webui-direct",
                    f"'webui: {webui}' points users at a direct port instead of Ingress")

    environment = config.get("environment") or {}
    if isinstance(environment, dict):
        for key, value in environment.items():
            if SECRET_NAME.search(str(key)) and str(value):
                report.fail("secret-in-environment",
                            f"config.yaml environment sets secret-like '{key}'")
            if str(key) in ("DOCKER_SOCKET", "MAJ_URL", "MAJ_JETON", "MAJ_SERVICE"):
                report.fail("updater-configured",
                            f"environment sets '{key}': the upstream "
                            f"Docker-socket updater must not be wired up")


def check_config(report: Report, config: dict, app_dir: Path) -> None:
    for key in REQUIRED_KEYS:
        if config.get(key) in (None, "", []):
            report.fail("required-key", f"config.yaml is missing required key '{key}'")

    version = config.get("version")
    if version is not None:
        if not isinstance(version, str):
            report.fail("version-format",
                        f"version must be a quoted string, found {version!r} "
                        f"({type(version).__name__})")
        elif not VERSION.match(version):
            report.fail("version-format", f"version {version!r} is not MAJOR.MINOR.PATCH")
        elif version == "latest":
            report.fail("version-format", "version must not be 'latest'")

    slug = config.get("slug")
    if slug is not None:
        if not isinstance(slug, str) or not SLUG.match(slug):
            report.fail("slug-format",
                        f"slug {slug!r} must match {SLUG.pattern} (lowercase, URI friendly)")
        elif slug.replace("-", "_") != app_dir.name.replace("-", "_"):
            report.warn("slug-directory",
                        f"slug '{slug}' differs from directory '{app_dir.name}'")

    arch = config.get("arch")
    if isinstance(arch, list):
        unsupported = sorted(set(map(str, arch)) - SUPPORTED_ARCH)
        if unsupported:
            report.fail("arch-unsupported",
                        f"arch lists {unsupported}; Home Assistant now "
                        f"supports only {sorted(SUPPORTED_ARCH)}")
        missing = sorted(REQUIRED_ARCH - set(map(str, arch)))
        if missing:
            report.fail("arch-missing", f"arch must include {missing}")
    elif arch is not None:
        report.fail("arch-type", "arch must be a list")

    services = config.get("services") or []
    if "mqtt:want" not in services:
        if any(str(s).startswith("mqtt:") for s in services):
            report.fail("mqtt-service",
                        f"services declares {services!r}; the project "
                        f"interface is 'mqtt:want' (the App must start "
                        f"without the Mosquitto App)")
        else:
            report.fail("mqtt-service", "services must include 'mqtt:want'")

    image = config.get("image")
    if image:
        if ":" in str(image).split("/")[-1] or "latest" in str(image):
            report.fail("image-tag", f"'image: {image}' must not carry a tag")
        report.info("image", f"pre-built image '{image}': Supervisor pulls "
                             f"'{image}:{version}', it must exist before release")
    else:
        report.info("image", "no 'image' key: Supervisor builds locally from the Dockerfile")

    if config.get("stage") in (None, "stable"):
        report.warn("stage",
                    "stage is 'stable' (default); 'experimental' is more "
                    "honest until the real-world acceptance checks pass")
    if not config.get("watchdog"):
        report.info("watchdog", "no 'watchdog' URL; Supervisor will not restart a hung App")
    if config.get("backup", "hot") != "cold" and not config.get("backup_pre"):
        report.warn("backup-hot",
                    "backup is 'hot' with no backup_pre: the SQLite database "
                    "under /data is copied while open (WAL). Decide between "
                    "'backup: cold' and a checkpoint hook, and test restore.")
    if not config.get("url"):
        report.warn("url", "no 'url' (project homepage) in config.yaml")

    check_security(report, config)
    check_options(report, config)


# --------------------------------------------------------------------------
# translations
# --------------------------------------------------------------------------

def check_translation_node(report: Report, path: str, schema, node) -> None:
    if not isinstance(node, dict):
        report.fail("translation-missing", f"no 'en' translation for option '{path}'")
        return
    for field in ("name", "description"):
        if not isinstance(node.get(field), str) or not node[field].strip():
            report.fail("translation-missing",
                        f"'en' translation for option '{path}' lacks '{field}'")
    nested = schema[0] if isinstance(schema, list) and schema else schema
    if isinstance(nested, dict):
        fields = node.get("fields") if isinstance(node.get("fields"), dict) else {}
        for key, sub in nested.items():
            check_translation_node(report, f"{path}.{key}", sub, fields.get(key))


def check_translations(report: Report, config: dict, app_dir: Path) -> None:
    schema = config.get("schema")
    ports = config.get("ports") if isinstance(config.get("ports"), dict) else {}
    if not isinstance(schema, dict) and not ports:
        return
    path = app_dir / "translations" / "en.yaml"
    if not path.is_file():
        report.fail("translation-file", f"{path} is missing")
        return
    data = load_yaml(path, report, "translation-file")
    if not isinstance(data, dict):
        report.fail("translation-file", f"{path} must be a mapping")
        return
    configuration = data.get("configuration")
    configuration = configuration if isinstance(configuration, dict) else {}
    if isinstance(schema, dict):
        for key, sub in schema.items():
            check_translation_node(report, key, sub, configuration.get(key))
        for key in configuration:
            if key not in schema:
                report.fail("translation-orphan",
                            f"translation for '{key}' has no schema key")
    network = data.get("network") if isinstance(data.get("network"), dict) else {}
    described = config.get("ports_description") or {}
    known = {str(k).lower() for k in list(network) + list(described)}
    for port in ports:
        if str(port).lower() not in known:
            report.fail("translation-missing",
                        f"port '{port}' has no description (translations "
                        f"'network' or ports_description)")


# --------------------------------------------------------------------------
# Dockerfile / build.yaml / CHANGELOG
# --------------------------------------------------------------------------

def dockerfile_instructions(text: str) -> list[str]:
    joined = re.sub(r"\\\r?\n", " ", text)
    return [line.strip() for line in joined.splitlines()
            if line.strip() and not line.strip().startswith("#")]


def expand_args(value: str, args: dict) -> str:
    """Expands $NAME, ${NAME} and ${NAME:-default} from ARG defaults."""
    def repl(match):
        name = match.group(1) or match.group(3)
        default = match.group(2)
        if args.get(name):
            return args[name]
        return default if default is not None else match.group(0)
    return re.sub(r"\$\{(\w+)(?::?-([^}]*))?\}|\$(\w+)", repl, value)


def check_dockerfile(report: Report, app_dir: Path):
    """Returns (text, upstream_version) or (None, None)."""
    path = app_dir / "Dockerfile"
    if not path.is_file():
        report.fail("dockerfile-missing", f"{path} is missing")
        return None, None
    text = path.read_text(encoding="utf-8")
    args: dict[str, str] = {}
    upstream_refs: list[str] = []
    stages: set[str] = set()
    from_count = 0
    for line in dockerfile_instructions(text):
        keyword, _, rest = line.partition(" ")
        keyword = keyword.upper()
        if keyword == "ARG":
            for assignment in rest.split():
                name, sep, value = assignment.partition("=")
                args[name] = value.strip("\"'") if sep else args.get(name, "")
        elif keyword == "FROM":
            from_count += 1
            tokens = [t for t in rest.split() if not t.startswith("--")]
            if not tokens:
                continue
            ref = expand_args(tokens[0], args)
            if len(tokens) >= 3 and tokens[1].upper() == "AS":
                stage_name = tokens[2].lower()
            else:
                stage_name = None
            if ref.lower() in stages or ref == "scratch":
                if stage_name:
                    stages.add(stage_name)
                continue
            if stage_name:
                stages.add(stage_name)
            if "$" in ref:
                report.fail("dockerfile-from-unresolved",
                            f"FROM {tokens[0]} depends on a build ARG without "
                            f"a default; Supervisor no longer supplies BUILD_FROM")
                continue
            name_part = ref.split("@")[0]
            last = name_part.split("/")[-1]
            tag = last.split(":", 1)[1] if ":" in last else None
            if tag is None and "@" not in ref:
                report.fail("dockerfile-from-untagged", f"FROM {ref} has no tag")
            elif tag in ("latest", "main", "master", "edge", "dev", "nightly"):
                report.fail("dockerfile-from-floating",
                            f"FROM {ref} tracks a floating tag")
            if name_part.startswith(UPSTREAM_IMAGE):
                upstream_refs.append(ref)
            if not DIGEST.search(ref):
                report.warn("dockerfile-digest-missing",
                            f"RELEASE-BLOCKING: FROM {ref} is not pinned by "
                            f"digest (@sha256:...). Tags are mutable.")
        elif keyword in ("COPY", "ADD", "RUN", "CMD", "ENTRYPOINT", "ENV", "VOLUME"):
            if "docker.sock" in rest:
                report.fail("dockerfile-docker-socket",
                            "Dockerfile references the Docker socket")
            if "majeur" in rest:
                report.fail("dockerfile-updater",
                            "Dockerfile references the upstream updater (majeur.js)")
            if keyword == "ADD" and re.search(r"https?://", rest):
                report.warn("dockerfile-remote-add",
                            f"ADD fetches a remote URL without checksum: {rest[:80]}")
            if keyword == "RUN" and re.search(r"(curl|wget)[^|;&]*\|\s*(ba|da)?sh", rest):
                report.fail("dockerfile-pipe-to-shell", "RUN pipes a download into a shell")
    if from_count == 0:
        report.fail("dockerfile-from-missing", "Dockerfile has no FROM")

    upstream_version = None
    if not upstream_refs:
        report.fail("dockerfile-upstream",
                    f"no FROM derives from the pinned upstream image {UPSTREAM_IMAGE}")
    else:
        versions = set()
        for ref in upstream_refs:
            last = ref.split("@")[0].split("/")[-1]
            tag = last.split(":", 1)[1] if ":" in last else None
            if tag and VERSION.match(tag.lstrip("v")):
                versions.add(tag.lstrip("v"))
            elif tag not in (None, "latest", "main", "master", "edge", "dev", "nightly"):
                report.fail("dockerfile-upstream-version",
                            f"upstream tag '{tag}' in FROM {ref} is not a release version")
        if len(versions) == 1:
            upstream_version = versions.pop()
            report.info("upstream-version", f"Dockerfile pins upstream {upstream_version}")
        elif len(versions) > 1:
            report.fail("dockerfile-upstream-version",
                        f"Dockerfile references several upstream versions: {sorted(versions)}")

    labels = set(re.findall(r"(io\.hass\.[a-z]+)\s*=", text))
    for label in ("io.hass.version", "io.hass.type", "io.hass.arch"):
        if label not in labels:
            report.warn("dockerfile-labels",
                        f"label {label} is not set in the Dockerfile; required "
                        f"unless the Home Assistant builder actions add it at "
                        f"build time")
    return text, upstream_version


def check_build_yaml(report: Report, app_dir: Path, upstream_version) -> None:
    for name in ("build.yaml", "build.yml", "build.json"):
        path = app_dir / name
        if not path.is_file():
            continue
        report.warn("build-yaml-deprecated",
                    f"{path.name} exists: it is no longer used by the Home "
                    f"Assistant builder (2026-04 migration) and Supervisor "
                    f"only reads it with a deprecation warning. Move its "
                    f"content into the Dockerfile.")
        data = load_yaml(path, report, "build-yaml")
        if not isinstance(data, dict):
            return
        build_from = data.get("build_from") or {}
        refs = build_from.values() if isinstance(build_from, dict) else [build_from]
        for ref in refs:
            ref = str(ref)
            last = ref.split("@")[0].split("/")[-1]
            tag = last.split(":", 1)[1] if ":" in last else None
            if tag in (None, "latest") and "@" not in ref:
                report.fail("build-yaml-floating", f"build_from {ref} is not version pinned")
            if (ref.startswith(UPSTREAM_IMAGE) and tag and upstream_version
                    and tag.lstrip("v") != upstream_version):
                report.fail("version-mismatch",
                            f"{path.name} build_from uses upstream {tag} but "
                            f"the Dockerfile pins {upstream_version}")
        for key, value in (data.get("args") or {}).items():
            if (re.search(r"upstream.*version|lmm.*version", str(key), re.I)
                    and upstream_version and str(value).lstrip("v") != upstream_version):
                report.fail("version-mismatch",
                            f"{path.name} args.{key}={value} but the "
                            f"Dockerfile pins upstream {upstream_version}")


def check_changelog(report: Report, app_dir: Path, version, upstream_version) -> None:
    path = app_dir / "CHANGELOG.md"
    if not path.is_file():
        report.fail("changelog-missing", f"{path} is missing")
        return
    text = path.read_text(encoding="utf-8")
    headings = re.findall(r"^#{1,3}\s*\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?", text, re.M)
    if not isinstance(version, str):
        return
    if not headings:
        report.fail("version-mismatch", "CHANGELOG.md has no version heading")
    elif headings[0] != version:
        report.fail("version-mismatch",
                    f"config.yaml version is {version} but the newest "
                    f"CHANGELOG.md entry is {headings[0]}")
    if upstream_version and upstream_version not in text:
        report.warn("changelog-upstream",
                    f"CHANGELOG.md does not mention upstream version {upstream_version}")


def check_app_files(report: Report, app_dir: Path) -> None:
    for name in ("DOCS.md", "README.md"):
        if not (app_dir / name).is_file():
            report.fail("file-missing", f"{app_dir / name} is missing")
    for name in ("icon.png", "logo.png"):
        if not (app_dir / name).is_file():
            report.warn("file-missing", f"{app_dir / name} is missing (store presentation)")
    if not (app_dir / "apparmor.txt").is_file():
        report.warn("apparmor-profile",
                    "no apparmor.txt: the App runs under the generic Docker "
                    "profile. Home Assistant recommends a custom profile.")
    nested = [p for p in app_dir.rglob("config.yaml") if p != app_dir / "config.yaml"]
    for path in nested:
        report.fail("nested-config-yaml",
                    f"{path}: Supervisor searches recursively for config.yaml; "
                    f"do not use that filename for anything else")


def check_repository(report: Report, repo: Path) -> None:
    path = repo / "repository.yaml"
    data = load_yaml(path, report, "repository-yaml")
    if data is None:
        return
    if not isinstance(data, dict):
        report.fail("repository-yaml", "repository.yaml must be a mapping")
        return
    if not isinstance(data.get("name"), str) or not data["name"].strip():
        report.fail("repository-yaml", "repository.yaml requires a non-empty 'name'")
    url = data.get("url")
    if not url:
        report.warn("repository-yaml", "repository.yaml has no 'url'")
    elif not re.match(r"^https://\S+$", str(url)):
        report.fail("repository-yaml", f"repository.yaml url {url!r} must be https")
    if not data.get("maintainer"):
        report.warn("repository-yaml", "repository.yaml has no 'maintainer'")
    unknown = sorted(set(data) - {"name", "url", "maintainer"})
    if unknown:
        report.fail("repository-yaml", f"repository.yaml has unknown keys {unknown}")


def validate(repo: Path, app_dir: Path) -> Report:
    report = Report()
    check_repository(report, repo)
    config = load_yaml(app_dir / "config.yaml", report, "config-yaml")
    if config is None:
        return report
    if not isinstance(config, dict):
        report.fail("config-yaml", "config.yaml must be a mapping")
        return report
    check_config(report, config, app_dir)
    check_translations(report, config, app_dir)
    dockerfile_text, upstream_version = check_dockerfile(report, app_dir)
    check_lora_default(report, config, dockerfile_text)
    check_build_yaml(report, app_dir, upstream_version)
    check_changelog(report, app_dir, config.get("version"), upstream_version)
    check_app_files(report, app_dir)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo", default=".", type=Path)
    parser.add_argument("--app", default="live-mesh-map", type=Path)
    parser.add_argument("--strict", action="store_true",
                        help="release gate: treat WARN as failure")
    args = parser.parse_args(argv)
    app_dir = args.app if args.app.is_absolute() else args.repo / args.app
    report = validate(args.repo, app_dir)
    order = {"FAIL": 0, "WARN": 1, "INFO": 2}
    for level, ident, message in sorted(report.findings, key=lambda f: order[f[0]]):
        print(f"{level} {ident}: {message}")
    fails, warns = report.count("FAIL"), report.count("WARN")
    blocking = fails + (warns if args.strict else 0)
    verdict = "FAILED" if blocking else "ok"
    print(f"manifest validation {verdict}: {fails} FAIL, {warns} WARN"
          f"{' (strict: WARN is failure)' if args.strict else ''}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
