.PHONY: bump

bump:
	@version="$(word 2,$(MAKECMDGOALS))"; \
	push_flag="$(word 3,$(MAKECMDGOALS))"; \
	if [ -z "$$version" ]; then \
		echo "Usage: make bump 0.1.1 [push=true]"; \
		exit 1; \
	fi; \
	node scripts/bump_version.cjs "$$version"; \
	git add src/claudio-desktop/tauri.conf.json src/claudio-desktop/Cargo.toml frontend/package.json; \
	git commit -m "chore(release): bump version to $$version"; \
	git tag "v$$version"; \
	case "$$push_flag" in \
		push=true|push=yes|push=1) git push origin HEAD --tags ;; \
		*) \
			printf "Push commit and tag now (y/N)? "; \
			read -r confirm; \
			case "$$confirm" in \
				[yY]|[yY][eE][sS]) git push origin HEAD --tags ;; \
				*) echo "Created commit + tag v$$version. Push later with: git push origin HEAD --tags" ;; \
			esac ;; \
	esac

%:
	@:
