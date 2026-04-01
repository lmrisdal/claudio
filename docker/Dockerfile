# Stage 1: Build frontend (platform-independent, always runs natively)
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

# Stage 2: Build .NET API (cross-compile natively using dotnet RID)
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS backend
ARG TARGETARCH
WORKDIR /build
COPY Directory.Build.props Directory.Packages.props Claudio.slnx ./
COPY src/ src/
COPY --from=frontend /build/src/Claudio.Api/wwwroot/ src/Claudio.Api/wwwroot/
RUN dotnet publish src/Claudio.Api/Claudio.Api.csproj -c Release -o /app -a $TARGETARCH

# Stage 3: Runtime (runs on target platform)
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
# icu-libs is required for globalization, sqlite-libs ensures system-level sqlite support
RUN apk add --no-cache libavif-apps icu-libs sqlite-libs
WORKDIR /app
COPY --from=backend /app ./
VOLUME /config
VOLUME /games
ENV CLAUDIO_CONFIG_PATH=/config/config.toml
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["dotnet", "Claudio.Api.dll"]
