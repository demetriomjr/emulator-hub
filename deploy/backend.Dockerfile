FROM node:26-alpine AS runtime

WORKDIR /app/apps
COPY apps/package.json apps/package-lock.json ./
RUN npm ci --omit=dev

COPY apps/backend ./backend
COPY apps/packages ./packages
COPY assets/ips/ ./backend/patches/

WORKDIR /app/apps/backend
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.mjs"]
