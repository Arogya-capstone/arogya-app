# Stage 1 — build the Vite app
FROM node:18-alpine AS builder
WORKDIR /app

# Build-time URLs injected by CI (empty = use Vite proxy / relative paths in prod)
ARG VITE_USER_URL=""
ARG VITE_APPOINTMENT_URL=""
ARG VITE_HEALTH_URL=""
ARG VITE_DOCUMENT_URL=""
ARG VITE_RAG_URL=""

ENV VITE_USER_URL=$VITE_USER_URL \
    VITE_APPOINTMENT_URL=$VITE_APPOINTMENT_URL \
    VITE_HEALTH_URL=$VITE_HEALTH_URL \
    VITE_DOCUMENT_URL=$VITE_DOCUMENT_URL \
    VITE_RAG_URL=$VITE_RAG_URL

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve static files with nginx (non-root, port 8080)
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
