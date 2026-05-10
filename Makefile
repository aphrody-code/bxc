.PHONY: help bootstrap clone-vendor patch build-lib build-fork test bench clean

ZIG := /home/ubuntu/.local/zig-0.15.2/zig
BUN := bun
ROOT := $(CURDIR)

help: ## affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?##"}{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

bootstrap: clone-vendor ## bootstrap complet (vendor + install deps)
	$(BUN) install
	@echo "✓ bootstrap complete"

clone-vendor: ## clone vendor/lightpanda et vendor/bun
	@if [ ! -d vendor/lightpanda ]; then \
		git clone --depth 1 https://github.com/lightpanda-io/browser vendor/lightpanda; \
	fi
	@if [ ! -d vendor/bun ]; then \
		git clone --depth 1 https://github.com/oven-sh/bun vendor/bun; \
	fi

patch: ## applique les patches sur vendor/lightpanda
	@for p in patches/*.patch; do \
		echo "applying $$p"; \
		(cd vendor/lightpanda && git apply --check ../../$$p 2>/dev/null && git apply ../../$$p) || echo "  skipped (already applied)"; \
	done

build-lib: clone-vendor patch ## build liblightpanda.so (DOM-only, no V8)
	$(BUN) scripts/build-lightpanda-static.ts

build-fork: clone-vendor ## build le fork Bun avec bun:browser
	$(BUN) scripts/build-bun-fork.ts

test: ## run les tests bun:test
	$(BUN) test

test-transport: ## tests du transport seulement
	$(BUN) test test/transport.test.ts

bench: ## run les benchmarks vs Chrome / Lightpanda CDP
	$(BUN) benchmarks/runner.ts

clean: ## nettoie build/ et zig-out/
	rm -rf build zig-out vendor/lightpanda/zig-out vendor/lightpanda/.zig-cache

clean-vendor: ## supprime aussi vendor/ (re-clone à bootstrap)
	rm -rf vendor/lightpanda vendor/bun
