# For hosts that run containers (Railway, Fly.io, a VPS with Docker, ...).
# Mount a persistent volume at /var/data. No other settings are required;
# add the SMTP_* variables to switch on enquiry emails.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/var/data UPLOAD_DIR=/var/data/uploads PORT=3000 TRUST_PROXY=true
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
