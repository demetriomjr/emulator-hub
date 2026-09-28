FROM node:26-alpine AS build

WORKDIR /app/apps/frontend
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci

COPY apps/frontend ./
COPY apps/packages ../packages
ARG PLAYER_ORIGIN_PORTS=""
ENV VITE_PLAYER_PORTS=$PLAYER_ORIGIN_PORTS
RUN mkdir -p /tmp/pokemon-seed && if [ -d /app/apps/frontend/public/resources/pokemon ]; then cp -a /app/apps/frontend/public/resources/pokemon/. /tmp/pokemon-seed/; fi
RUN --mount=type=cache,id=emulator-hub-pokemon-sprites,target=/app/apps/frontend/public/resources/pokemon,sharing=locked \
    sh -c 'cp -an /tmp/pokemon-seed/. /app/apps/frontend/public/resources/pokemon/ && npm run build'

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
