# For hosts that run containers (Fly.io, Railway, a VPS with Docker, ...).
# Mount a persistent volume at /var/data.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/var/data UPLOAD_DIR=/var/data/uploads PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
