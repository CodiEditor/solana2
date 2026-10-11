FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production --ignore-scripts || npm install --production
COPY server ./server
COPY dist ./dist
EXPOSE 3000
CMD ["node", "--import", "tsx/esm", "server/index.ts"]
