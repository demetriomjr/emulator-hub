FROM node:26-alpine AS build

WORKDIR /app/apps/frontend
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci

COPY apps/frontend ./
COPY apps/packages ../packages
ARG PLAYER_ORIGIN_PORTS=""
ENV VITE_PLAYER_PORTS=$PLAYER_ORIGIN_PORTS
RUN mkdir -p /tmp/pokemon-seed && if [ -d /app/apps/frontend/public/resources/pokemon ]; then cp -a /app/apps/frontend/public/resources/pokemon/. /tmp/pokemon-seed/; fi
RUN --mount=type=cache,id=emulator-hub-pokemon-sprites,target=/tmp/pokemon-cache,sharing=locked \
    sh -c 'if [ -n "$(ls -A /tmp/pokemon-seed)" ]; then cp -a /tmp/pokemon-seed/. /tmp/pokemon-cache/; fi && rm -rf /app/apps/frontend/public/resources/pokemon && mkdir -p /app/apps/frontend/public/resources/pokemon && cp -a /tmp/pokemon-cache/. /app/apps/frontend/public/resources/pokemon/ && npm run build && rm -rf /tmp/pokemon-cache/* && cp -a /app/apps/frontend/public/resources/pokemon/. /tmp/pokemon-cache/'

FROM nginx:1.29-alpine
COPY --chmod=755 deploy/15-frontend-events.sh /docker-entrypoint.d/15-frontend-events.sh
COPY apps/packages/frontend-events.mjs /opt/emulator-hub/apps/packages/frontend-events.mjs
COPY apps/frontend/server/frontend-events-nginx.mjs /opt/emulator-hub/apps/frontend/server/frontend-events-nginx.mjs
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
