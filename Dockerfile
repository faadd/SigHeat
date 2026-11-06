FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /var/lib/sigheat && chown node:node /var/lib/sigheat
USER node
ENV SIGHEAT_HOST=0.0.0.0 SIGHEAT_PORT=8787 SIGHEAT_DATA_DIR=/var/lib/sigheat
EXPOSE 8787
CMD ["node", "server/index.cjs"]
