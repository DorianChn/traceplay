.PHONY: install build test test-watch typecheck check clean dev

install:
	npm install

build:
	npm run build

test:
	npm test

test-watch:
	npm run test:watch

typecheck:
	npm run typecheck

# Full local gate: type-check, build, and run tests
check: typecheck build test

clean:
	rm -rf dist

dev:
	npm run dev -- --help
