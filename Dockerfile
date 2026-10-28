# ---- the app ----
FROM node:22-alpine AS web
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ .
COPY engine/ /engine/
# the voice's thesaurus, made from WordNet before the build (tools/wordnet.mjs)
COPY tools/wordnet.mjs /tools/
RUN npm run build

# ---- the server: no dependencies, Node's own library only ----
FROM node:22-alpine
ENV TZ=UTC MOSHE_ROOT=/data MOSHE_STATIC=/app/static NODE_ENV=production
RUN apk add --no-cache tzdata
WORKDIR /app
COPY engine/package.json ./engine/package.json
COPY engine/src ./engine/src
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=web /frontend/dist ./static
VOLUME ["/data"]
EXPOSE 8430
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8430/api/health || exit 1
CMD ["node", "server/src/main.js"]
