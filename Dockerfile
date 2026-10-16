FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
COPY data.json ./
EXPOSE 3000
CMD ["npm", "start"]
