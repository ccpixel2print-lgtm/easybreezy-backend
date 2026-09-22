# ---- build stage ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# openssl is needed by Prisma's engine
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`; needs schema present (copied above)
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# prisma client was generated into node_modules during build's npm ci;
# runtime npm ci re-runs postinstall (prisma generate) so the client is present
EXPOSE 3001
CMD ["node", "dist/src/main"]
