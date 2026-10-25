FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=8000
EXPOSE 8000
CMD ["node", "server.mjs"]
