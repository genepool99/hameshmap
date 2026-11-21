# Validator fixtures

`good/` is a minimal manifest set the validator must accept without FAIL or
WARN. `test_validate.py` copies it to a temporary directory and applies one
mutation per test to prove that each rule fires. The fixtures are not a
template for the real App and contain no real hosts or credentials.

The manifests are stored as `config.fixture.yaml` and
`repository.fixture.yaml` and renamed by the test when copied. This is
deliberate: Supervisor searches an App repository recursively for
`config.yaml`, so a fixture with the real filename would be offered to users
as an installable App.
