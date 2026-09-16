# Publicação na internet (Render, Fly.io, Railway, VPS...). O banco fica em /app/data: monte um volume persistente nesse caminho.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/escola.db
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
