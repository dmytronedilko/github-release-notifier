FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# HUSKY=0 prevents the `prepare` script from trying to install git hooks
RUN HUSKY=0 npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY proto/ ./proto/
COPY drizzle/ ./drizzle/
RUN npm run build

# ---- Runtime image ----
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN HUSKY=0 npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY drizzle/ ./drizzle/

# Proto files for gRPC
COPY proto/ ./proto/

# Static UI
COPY public/ ./public/

# Pug templates
COPY views/ ./views/

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]
