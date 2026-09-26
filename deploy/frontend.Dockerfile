FROM node:26-alpine AS build

WORKDIR /app/apps/frontend
COPY apps/frontend/package.json apps/frontend/package-lock.json ./
RUN npm ci

COPY apps/frontend ./
COPY apps/packages ../packages
ARG PLAYER_ORIGIN_PORTS=""
ENV VITE_PLAYER_PORTS=$PLAYER_ORIGIN_PORTS
RUN npm run build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
