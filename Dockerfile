FROM node:24-alpine
ENV NODE_ENV=production
# Balances live in /data/data.json. Mount a volume at /data so they survive redeploys.
ENV DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data
EXPOSE 3000
CMD ["npm", "start"]
