# DataWalk Hub image. Build from the repository root:
#   docker build -f packages/hub/Dockerfile -t datawalk-hub .
# Run behind HTTPS (a reverse proxy) with a data volume and secrets from your secret store:
#   docker run -p 8800:8800 -v hub-data:/data -e HUB_BASE_URL=https://hub.example.internal \
#     -e HUB_ENCRYPTION_KEY=... -e HUB_SECRET_KEY=... datawalk-hub

FROM node:22-slim AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY assets /src/assets
COPY apps/web ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 HUB_DATA_DIR=/data
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY packages/python packages/python
COPY --from=web /src/packages/python/datawalk/server/static packages/python/datawalk/server/static
COPY --from=web /src/packages/python/datawalk/server/viewer packages/python/datawalk/server/viewer
COPY packages/hub packages/hub
RUN pip install . ./packages/hub && useradd --system --home /data hub && mkdir -p /data && chown hub /data
USER hub
VOLUME /data
EXPOSE 8800
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8800/login')"
CMD ["datawalk-hub", "serve", "--host", "0.0.0.0", "--port", "8800"]
