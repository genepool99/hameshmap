# Tests

Everything here is synthetic: local containers and a simulated Ingress
gateway. None of it is a Home Assistant acceptance test. What each layer
proves and does not prove is in `docs/testing/test-plan.md`.

| Path | Purpose | Owner |
| --- | --- | --- |
| `images.env` | Pinned tool and test images (tag and digest) | quality |
| `lib/` | Gate runner, shared container harness, fake Supervisor, cleanup | quality |
| `manifest/` | Static validator for `config.yaml`, translations, Dockerfile, `repository.yaml`, with its own tests and fixtures | quality |
| `unit/` | `node:test` unit tests (`*.test.mjs`) of the App's startup code | App engineering |
| `integration/` | Local container tests of the built image | quality |
| `ingress/` | Simulated Ingress gateway and Playwright browser tests | quality |
| `.artifacts/` | Logs, reports, screenshots of the last run (git-ignored) | generated |

Run with `make check`, `make test-integration`, `make test-ingress`
(see the `Makefile` header). Requirements: docker, bash, jq, node >= 20.

Conventions:

- containers are named `lmm-c-*`, images `local/lmm-c-*`, the network
  `lmm-c-hassio`; `make clean` removes them all;
- no host port is published unless `LMM_GATEWAY_HOST_PORT` is set, and then
  only on `127.0.0.1`;
- no public broker is ever contacted; brokers are throwaway Mosquitto
  containers; browser requests to external hosts are blocked and recorded;
- secrets used by the tests are random per run and never written to the
  repository; artifacts are scrubbed of them;
- the test network uses the Supervisor range `172.30.32.0/23` so the App's
  default source-address rule is exercised. If that range is busy the harness
  falls back to `172.31.232.0/23`, passes `LMM_INGRESS_ALLOW` to the App and
  labels the run **NON-CANONICAL**. Such a run does not cover the built-in
  default address.

Environment variables: `LMM_IMAGE`, `LMM_KEEP=1`, `LMM_START_TIMEOUT`,
`LMM_STOP_TIMEOUT`, `LMM_SUBNET`, `LMM_FALLBACK_SUBNET`, `LMM_MODE`
(`strict`/`baseline`), `LMM_APP_PORT`, `LMM_EXPECT_PORTS`, `EXTERNAL_ALLOW`,
`PW_ARGS`, `LMM_MANIFEST_RUNNER` (`auto`/`host`/`container`).
