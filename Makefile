.PHONY: bump

bump:
	@set -e; \
	version="$(word 2,$(MAKECMDGOALS))"; \
	push_flag="$(push)"; \
	if [ -z "$$version" ]; then \
		echo "Usage: make bump 0.1.1 [push=true]"; \
		exit 1; \
	fi; \
	node scripts/bump_version.cjs "$$version"; \
	dotnet build src/claudio-core; \
	git add src/claudio-electron/package.json src/claudio-core/Claudio.Core.csproj src/claudio-web/package.json; \
	git commit -m "chore(release): bump version to $$version"; \
	git tag -a "v$$version" -m "Claudio $$version"; \
	case "$$push_flag" in \
		true|yes|1) git push origin HEAD "refs/tags/v$$version" ;; \
		*) \
			printf "Push commit and tag now (y/N)? "; \
			read -r confirm; \
			case "$$confirm" in \
				[yY]|[yY][eE][sS]) git push origin HEAD "refs/tags/v$$version" ;; \
				*) echo "Created commit + tag v$$version. Push later with: git push origin HEAD refs/tags/v$$version" ;; \
			esac ;; \
	esac

%:
	@:
