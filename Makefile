# make test      Python tests (docker) and panel tests (Node.js 22 or newer)
# make frontend  rebuilds custom_components/meshcore_map/frontend/meshcore-map-panel.js
# make lint      ruff on the Python code (docker)

.PHONY: test test-python test-frontend frontend lint

test: test-python test-frontend

test-python:
	docker run --rm -e PYTHONDONTWRITEBYTECODE=1 -v "$(CURDIR)":/repo:ro -w /repo python:3.14-slim \
	  sh -c "pip install -q --root-user-action=ignore -r requirements_test.txt && python -m pytest -q -p no:cacheprovider tests"

test-frontend:
	cd frontend && npm test

frontend:
	cd frontend && npm ci && npm run build

lint:
	docker run --rm -v "$(CURDIR)":/repo:ro -w /repo ghcr.io/astral-sh/ruff:0.14.5 check --no-cache custom_components tests
