FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run setup
ENV PORT=8000
EXPOSE 8000
CMD ["npx", "tsx", "server.mjs"]
