FROM node:26-alpine AS runtime

WORKDIR /app/apps/backend
COPY apps/backend/package.json apps/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY apps/backend ./
COPY apps/packages ../packages
RUN rm -rf ./patches
COPY assets/ips/ ./patches/

RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.mjs"]
