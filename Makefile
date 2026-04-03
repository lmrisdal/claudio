.PHONY: bump

bump:
	@version="$(word 2,$(MAKECMDGOALS))"; \
	if [ -z "$$version" ]; then \
		echo "Usage: make bump 0.1.1"; \
		exit 1; \
	fi; \
	node scripts/bump_desktop_version.cjs "$$version"; \
	git add src/claudio-desktop/tauri.conf.json src/claudio-desktop/Cargo.toml frontend/package.json; \
	git commit -m "chore(release): bump desktop version to $$version"; \
	git tag "v$$version"; \
	echo "Created commit + tag v$$version. Push with: git push origin HEAD --tags"

%:
	@:
