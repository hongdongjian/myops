.PHONY: install dev build pack deploy undeploy restart info test typecheck clean

install:
	npm install

dev:
	npm run dev

build:
	npm run build

pack: build
	cd packages/server && npm pack
	mkdir -p dist-pack
	mv packages/server/my-ops-*.tgz dist-pack/

deploy: pack
	tsx scripts/deploy-launchd.ts

undeploy:
	-launchctl unload ~/Library/LaunchAgents/com.hongdongjian.my-ops.plist
	rm -f ~/Library/LaunchAgents/com.hongdongjian.my-ops.plist

restart: undeploy deploy

info:
	@launchctl list | grep my-ops || echo "not running"

test:
	npm test

typecheck:
	npm run typecheck

clean:
	rm -rf packages/*/dist packages/server/conf packages/server/my-ops-*.tgz dist-pack
