# make test          unit tests (needs Node.js 22 or newer)
# make build         builds the App image local/live-mesh-map:dev
# make test-ingress  builds the image and runs the browser tests below an
#                    Ingress-style path prefix (needs docker)
# make update        moves to the latest Live Mesh Map World release, then
#                    runs the tests

IMAGE ?= local/live-mesh-map:dev

.PHONY: test build test-ingress update

test:
	node --test tests/unit/*.test.mjs

build:
	docker build -t $(IMAGE) live-mesh-map

test-ingress: build
	LMM_IMAGE=$(IMAGE) tests/ingress/run.sh

update:
	node scripts/update-upstream.mjs
	$(MAKE) test test-ingress
