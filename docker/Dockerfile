# Stage 1: Build frontend
FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build .NET API
FROM mcr.microsoft.com/dotnet/sdk:10.0-preview AS backend
WORKDIR /build
COPY Directory.Build.props Directory.Packages.props Claudio.slnx ./
COPY src/ src/
COPY --from=frontend /build/src/Claudio.Api/wwwroot/ src/Claudio.Api/wwwroot/
RUN dotnet publish src/Claudio.Api/Claudio.Api.csproj -c Release -o /app

# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0-preview-alpine AS runtime
WORKDIR /app
COPY --from=backend /app ./
VOLUME /config
VOLUME /games
ENV CLAUDIO_CONFIG_PATH=/config/config.toml
EXPOSE 8080
ENTRYPOINT ["dotnet", "Claudio.Api.dll"]
