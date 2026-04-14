# syntax=docker/dockerfile:1.7

# Stage 1: Build web app (platform-independent, always runs natively)
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /build/src/claudio-web
COPY src/claudio-web/package.json src/claudio-web/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY src/claudio-web/ ./
RUN pnpm build

# Stage 2: Prepare Rust dependency graph for caching
FROM --platform=$BUILDPLATFORM rust:1.94-alpine AS chef
WORKDIR /build
RUN apk add --no-cache musl-dev pkgconfig && cargo install cargo-chef --locked

COPY Cargo.toml Cargo.lock ./
# Strip workspace members excluded from the container build so Cargo can resolve only API crates.
RUN sed -i '/"src\/claudio-desktop"/d; /"src\/claudio-uninstaller"/d; /"tests\/claudio-desktop"/d; /"tests\/claudio-api-rs"/d' Cargo.toml
COPY src/claudio-api/Cargo.toml src/claudio-api/Cargo.toml
COPY src/claudio-api/migration/Cargo.toml src/claudio-api/migration/Cargo.toml

RUN mkdir -p src/claudio-api/src src/claudio-api/migration/src && \
    touch src/claudio-api/src/lib.rs src/claudio-api/src/main.rs && \
    touch src/claudio-api/migration/src/lib.rs src/claudio-api/migration/src/main.rs

RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS planner

FROM chef AS cacher
COPY --from=planner /build/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo chef cook --release --recipe-path recipe.json

# Stage 3: Build Rust API
FROM chef AS backend
COPY Cargo.toml Cargo.lock ./
RUN sed -i '/"src\/claudio-desktop"/d; /"src\/claudio-uninstaller"/d; /"tests\/claudio-desktop"/d; /"tests\/claudio-api-rs"/d' Cargo.toml
COPY src/claudio-api/ src/claudio-api/
COPY --from=frontend /build/src/claudio-api/wwwroot/ src/claudio-api/wwwroot/

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    mkdir -p /app && cargo build --release -p claudio-api && cp target/release/claudio-api /app/claudio-api

# Stage 4: Runtime
FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates libavif-apps sqlite-libs su-exec
WORKDIR /app
COPY --from=backend /app ./
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /config
VOLUME /config
VOLUME /games
ENV CLAUDIO_CONFIG_PATH=/config/config.toml
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
