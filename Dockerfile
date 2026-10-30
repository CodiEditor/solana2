FROM node:24-alpine
ENV NODE_ENV=production
# Balances live in Postgres: pass DATABASE_URL (and JWT_SECRET) when the container starts.
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
