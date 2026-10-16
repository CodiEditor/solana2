FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
RUN ls -R /app/server
COPY data.json ./
EXPOSE 3000
CMD ["node", "server/index.ts"]
