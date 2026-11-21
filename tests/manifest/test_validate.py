"""Tests of the manifest validator itself (stdlib unittest + PyYAML).

Each test copies the known-good fixture, applies one mutation and asserts that
the expected finding appears. Run with:

    tests/manifest/run.sh python3 -m unittest discover -s tests/manifest -p 'test_*.py'
"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import validate  # noqa: E402  pylint: disable=wrong-import-position

GOOD = HERE / "fixtures" / "good"


class FixtureCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name) / "repo"
        shutil.copytree(GOOD, self.repo)
        (self.repo / "repository.fixture.yaml").rename(self.repo / "repository.yaml")
        self.app = self.repo / "app"
        (self.app / "config.fixture.yaml").rename(self.app / "config.yaml")

    # -- helpers ----------------------------------------------------------
    def edit_yaml(self, relative, mutate):
        path = self.repo / relative
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        mutate(data)
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")

    def edit_config(self, mutate):
        self.edit_yaml("app/config.yaml", mutate)

    def write(self, relative, text):
        (self.repo / relative).write_text(text, encoding="utf-8")

    def run_validator(self):
        return validate.validate(self.repo, self.app)

    def assert_fails(self, ident):
        report = self.run_validator()
        self.assertIn(ident, report.ids("FAIL"), report.findings)

    def assert_warns(self, ident):
        report = self.run_validator()
        self.assertIn(ident, report.ids("WARN"), report.findings)
        return report


class GoodFixture(FixtureCase):
    def test_good_fixture_has_no_fail_and_no_warn(self):
        report = self.run_validator()
        self.assertEqual(report.count("FAIL"), 0, report.findings)
        self.assertEqual(report.count("WARN"), 0, report.findings)

    def test_cli_exit_codes(self):
        argv = ["--repo", str(self.repo), "--app", "app"]
        self.assertEqual(validate.main(argv), 0)
        self.edit_config(lambda c: c.update(host_network=True))
        self.assertEqual(validate.main(argv), 1)

    def test_strict_turns_warnings_into_failure(self):
        text = (self.app / "Dockerfile").read_text(encoding="utf-8")
        self.write("app/Dockerfile", text.replace("@sha256:" + "0" * 64, ""))
        argv = ["--repo", str(self.repo), "--app", "app"]
        self.assertEqual(validate.main(argv), 0)
        self.assertEqual(validate.main(argv + ["--strict"]), 1)


class RequiredKeysAndFormats(FixtureCase):
    def test_missing_required_key(self):
        for key in ("name", "version", "slug", "description", "arch"):
            with self.subTest(key=key):
                self.setUp()
                self.edit_config(lambda c, k=key: c.pop(k))
                self.assert_fails("required-key")

    def test_unquoted_version_becomes_float(self):
        self.edit_config(lambda c: c.update(version=1.5))
        self.assert_fails("version-format")

    def test_version_not_semver(self):
        self.edit_config(lambda c: c.update(version="1.5"))
        self.assert_fails("version-format")

    def test_slug_uppercase(self):
        self.edit_config(lambda c: c.update(slug="Live Mesh"))
        self.assert_fails("slug-format")

    def test_legacy_arch_rejected(self):
        self.edit_config(lambda c: c["arch"].append("armv7"))
        self.assert_fails("arch-unsupported")

    def test_missing_aarch64(self):
        self.edit_config(lambda c: c.update(arch=["amd64"]))
        self.assert_fails("arch-missing")

    def test_mqtt_need_instead_of_want(self):
        self.edit_config(lambda c: c.update(services=["mqtt:need"]))
        self.assert_fails("mqtt-service")

    def test_mqtt_service_absent(self):
        self.edit_config(lambda c: c.pop("services"))
        self.assert_fails("mqtt-service")


class SecurityPosture(FixtureCase):
    def test_forbidden_boolean_keys(self):
        for key in validate.FORBIDDEN_TRUE:
            with self.subTest(key=key):
                self.setUp()
                self.edit_config(lambda c, k=key: c.update({k: True}))
                self.assert_fails(f"forbidden-{key}")

    def test_forbidden_key_explicitly_false_is_fine(self):
        self.edit_config(lambda c: c.update(host_network=False, full_access=False))
        self.assertEqual(self.run_validator().count("FAIL"), 0)

    def test_privileged_capabilities(self):
        self.edit_config(lambda c: c.update(privileged=["NET_ADMIN"]))
        self.assert_fails("forbidden-privileged")

    def test_devices(self):
        self.edit_config(lambda c: c.update(devices=["/dev/ttyACM0"]))
        self.assert_fails("forbidden-devices")

    def test_apparmor_disabled(self):
        self.edit_config(lambda c: c.update(apparmor=False))
        self.assert_fails("forbidden-apparmor-disabled")

    def test_admin_role(self):
        self.edit_config(lambda c: c.update(hassio_role="admin"))
        self.assert_fails("forbidden-hassio-role")

    def test_host_config_mount_both_syntaxes(self):
        for entry in ("homeassistant_config:rw", {"type": "share", "read_only": False}):
            with self.subTest(entry=entry):
                self.setUp()
                self.edit_config(lambda c, e=entry: c.update(map=[e]))
                self.assert_fails("forbidden-map")

    def test_port_published_by_default(self):
        self.edit_config(lambda c: c["ports"].update({"4404/tcp": 4404}))
        self.assert_fails("port-published-by-default")

    def test_web_port_published_by_default(self):
        self.edit_config(lambda c: c["ports"].update({"8095/tcp": 8095}))
        self.assert_fails("port-published-by-default")

    def test_ingress_port_listed_in_ports(self):
        self.edit_config(lambda c: c["ports"].update({"8099/tcp": None}))
        self.assert_fails("ingress-port-published")

    def test_ingress_disabled(self):
        self.edit_config(lambda c: c.update(ingress=False))
        self.assert_fails("ingress-disabled")

    def test_ingress_port_changed(self):
        self.edit_config(lambda c: c.update(ingress_port=8095))
        self.assert_fails("ingress-port")

    def test_secret_in_environment(self):
        self.edit_config(lambda c: c.update(environment={"MQTT_MOT_DE_PASSE": "x"}))
        self.assert_fails("secret-in-environment")

    def test_updater_environment(self):
        self.edit_config(lambda c: c.update(environment={"MAJ_URL": "http://maj:1"}))
        self.assert_fails("updater-configured")

    def test_panel_for_non_admins_warns(self):
        self.edit_config(lambda c: c.update(panel_admin=False))
        self.assert_warns("panel-admin")

    def test_hot_backup_warns(self):
        self.edit_config(lambda c: c.pop("backup"))
        self.assert_warns("backup-hot")


class OptionsAndSchema(FixtureCase):
    def test_option_without_schema(self):
        self.edit_config(lambda c: c["options"].update(orphan="x"))
        self.assert_fails("options-without-schema")

    def test_mandatory_schema_without_default(self):
        self.edit_config(lambda c: c["schema"].update(required_thing="str"))
        self.assert_fails("schema-without-default")

    def test_optional_schema_without_default_is_fine(self):
        self.edit_config(lambda c: c["schema"].update(optional_thing="int?"))
        report = self.run_validator()
        self.assertNotIn("schema-without-default", report.ids("FAIL"))

    def test_unknown_schema_type(self):
        self.edit_config(lambda c: c["schema"].update(mqtt_host="string"))
        self.assert_fails("schema-type")

    def test_default_violates_type(self):
        cases = {
            "mqtt_port": 70000,
            "lora_send": "no",
            "log_level": "verbose",
            "mqtt_host": 5,
        }
        for key, value in cases.items():
            with self.subTest(key=key):
                self.setUp()
                self.edit_config(lambda c, k=key, v=value: c["options"].update({k: v}))
                self.assert_fails("options-type")

    def test_secret_typed_as_str(self):
        self.edit_config(lambda c: c["schema"].update(mqtt_password="str"))
        self.assert_fails("secret-not-password-type")

    def test_nested_secret_typed_as_str(self):
        self.edit_config(lambda c: c["schema"]["extra_brokers"][0].update(password="str?"))
        self.assert_fails("secret-not-password-type")

    def test_french_secret_name_detected(self):
        def mutate(config):
            config["schema"]["export_jeton"] = "str?"
        self.edit_config(mutate)
        self.assert_fails("secret-not-password-type")

    def test_setup_code_is_a_secret(self):
        self.edit_config(lambda c: c["schema"].update(setup_code="str?"))
        self.assert_fails("secret-not-password-type")

    def test_password_with_default_value(self):
        self.edit_config(lambda c: c["options"].update(mqtt_password="hunter2"))
        self.assert_fails("secret-default-value")

    def test_schema_false(self):
        self.edit_config(lambda c: c.update(schema=False))
        self.assert_fails("schema-disabled")


class LoraDefault(FixtureCase):
    def test_bool_option_true(self):
        self.edit_config(lambda c: c["options"].update(lora_send=True))
        self.assert_fails("lora-send-default-on")

    def test_environment_enables_transmit(self):
        self.edit_config(lambda c: c.update(environment={"DOMOTIQUE_ENVOI_LORA": "oui"}))
        self.assert_fails("lora-send-default-on")

    def test_dockerfile_enables_transmit(self):
        with (self.app / "Dockerfile").open("a", encoding="utf-8") as handle:
            handle.write("ENV DOMOTIQUE_ENVOI_LORA=oui\n")
        self.assert_fails("lora-send-default-on")

    def test_environment_disabling_transmit_is_fine(self):
        self.edit_config(lambda c: c.update(environment={"DOMOTIQUE_ENVOI_LORA": "non"}))
        self.assertEqual(self.run_validator().count("FAIL"), 0)


class Translations(FixtureCase):
    def test_missing_file(self):
        (self.app / "translations" / "en.yaml").unlink()
        self.assert_fails("translation-file")

    def test_missing_key(self):
        self.edit_yaml("app/translations/en.yaml",
                       lambda t: t["configuration"].pop("mqtt_host"))
        self.assert_fails("translation-missing")

    def test_missing_description(self):
        self.edit_yaml("app/translations/en.yaml",
                       lambda t: t["configuration"]["mqtt_host"].pop("description"))
        self.assert_fails("translation-missing")

    def test_missing_nested_field(self):
        self.edit_yaml("app/translations/en.yaml",
                       lambda t: t["configuration"]["extra_brokers"]["fields"].pop("url"))
        self.assert_fails("translation-missing")

    def test_orphan_translation(self):
        self.edit_yaml("app/translations/en.yaml",
                       lambda t: t["configuration"].update(
                           gone={"name": "x", "description": "y"}))
        self.assert_fails("translation-orphan")

    def test_port_without_description(self):
        self.edit_yaml("app/translations/en.yaml", lambda t: t.pop("network"))
        self.assert_fails("translation-missing")


class Dockerfile(FixtureCase):
    def set_from(self, line):
        text = (self.app / "Dockerfile").read_text(encoding="utf-8").splitlines()
        text[1] = line
        self.write("app/Dockerfile", "\n".join(text) + "\n")

    def test_latest_tag(self):
        self.set_from("FROM ghcr.io/sauveteur71/live-mesh-map-world:latest")
        self.assert_fails("dockerfile-from-floating")

    def test_untagged(self):
        self.set_from("FROM ghcr.io/sauveteur71/live-mesh-map-world")
        self.assert_fails("dockerfile-from-untagged")

    def test_build_from_without_default(self):
        self.set_from("FROM ${BUILD_FROM}")
        self.assert_fails("dockerfile-from-unresolved")

    def test_not_derived_from_upstream(self):
        self.set_from("FROM node:22.23.5-bookworm-slim")
        self.assert_fails("dockerfile-upstream")

    def test_missing_digest_is_release_blocking_warning_not_failure(self):
        self.set_from("FROM ghcr.io/sauveteur71/live-mesh-map-world:${UPSTREAM_VERSION}")
        report = self.assert_warns("dockerfile-digest-missing")
        self.assertEqual(report.count("FAIL"), 0, report.findings)
        messages = [m for lvl, i, m in report.findings if i == "dockerfile-digest-missing"]
        self.assertTrue(all("RELEASE-BLOCKING" in m for m in messages))

    def test_multi_stage_reference_to_earlier_stage_is_not_an_image(self):
        self.write("app/Dockerfile", (
            "FROM ghcr.io/sauveteur71/live-mesh-map-world:1.5.14@sha256:" + "0" * 64 + " AS upstream\n"
            "FROM upstream\n"
            'LABEL io.hass.version="x" io.hass.type="app" io.hass.arch="amd64"\n'))
        report = self.run_validator()
        self.assertEqual(report.count("FAIL"), 0, report.findings)
        self.assertEqual(report.count("WARN"), 0, report.findings)

    def test_docker_socket(self):
        with (self.app / "Dockerfile").open("a", encoding="utf-8") as handle:
            handle.write("VOLUME /var/run/docker.sock\n")
        self.assert_fails("dockerfile-docker-socket")

    def test_updater_entrypoint(self):
        with (self.app / "Dockerfile").open("a", encoding="utf-8") as handle:
            handle.write('CMD ["node", "src/majeur.js"]\n')
        self.assert_fails("dockerfile-updater")

    def test_pipe_to_shell(self):
        with (self.app / "Dockerfile").open("a", encoding="utf-8") as handle:
            handle.write("RUN curl -fsSL https://example.invalid/i.sh | sh\n")
        self.assert_fails("dockerfile-pipe-to-shell")

    def test_missing_labels_warn(self):
        text = (self.app / "Dockerfile").read_text(encoding="utf-8")
        self.write("app/Dockerfile",
                   "\n".join(l for l in text.splitlines() if "LABEL" not in l) + "\n")
        self.assert_warns("dockerfile-labels")

    def test_missing_dockerfile(self):
        (self.app / "Dockerfile").unlink()
        self.assert_fails("dockerfile-missing")


class VersionConsistency(FixtureCase):
    def test_changelog_behind_config(self):
        self.edit_config(lambda c: c.update(version="0.2.0"))
        self.assert_fails("version-mismatch")

    def test_changelog_without_headings(self):
        self.write("app/CHANGELOG.md", "nothing here\n")
        self.assert_fails("version-mismatch")

    def test_changelog_keepachangelog_style(self):
        self.write("app/CHANGELOG.md", "# Changelog\n\n## [0.1.0] - 2026-11-20\n\nUpstream 1.5.14\n")
        self.assertEqual(self.run_validator().count("FAIL"), 0)

    def test_build_yaml_is_deprecated_warning(self):
        self.write("app/build.yaml", "build_from:\n  amd64: ghcr.io/sauveteur71/live-mesh-map-world:1.5.14\n")
        self.assert_warns("build-yaml-deprecated")

    def test_build_yaml_disagrees_with_dockerfile(self):
        self.write("app/build.yaml", "build_from:\n  amd64: ghcr.io/sauveteur71/live-mesh-map-world:1.5.13\n")
        self.assert_fails("version-mismatch")

    def test_build_yaml_latest(self):
        self.write("app/build.yaml", "build_from:\n  amd64: ghcr.io/sauveteur71/live-mesh-map-world:latest\n")
        self.assert_fails("build-yaml-floating")


class FilesAndRepository(FixtureCase):
    def test_missing_docs(self):
        (self.app / "DOCS.md").unlink()
        self.assert_fails("file-missing")

    def test_missing_apparmor_profile_warns(self):
        (self.app / "apparmor.txt").unlink()
        self.assert_warns("apparmor-profile")

    def test_nested_config_yaml(self):
        (self.app / "rootfs").mkdir()
        self.write("app/rootfs/config.yaml", "x: 1\n")
        self.assert_fails("nested-config-yaml")

    def test_repository_missing(self):
        (self.repo / "repository.yaml").unlink()
        self.assert_fails("repository-yaml")

    def test_repository_without_name(self):
        self.edit_yaml("repository.yaml", lambda r: r.pop("name"))
        self.assert_fails("repository-yaml")

    def test_repository_http_url(self):
        self.edit_yaml("repository.yaml", lambda r: r.update(url="http://example.invalid"))
        self.assert_fails("repository-yaml")

    def test_invalid_yaml(self):
        self.write("app/config.yaml", "name: [unclosed\n")
        self.assert_fails("config-yaml")


if __name__ == "__main__":
    unittest.main()
