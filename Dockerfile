# Imagem Ãºnica para hospedar (Render, Railway, Fly.io): a API serve tambÃ©m o painel web.
# O backend/Dockerfile continua sendo o do docker-compose.

FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
# Mostra as opções de desenvolvedor no painel (o Render passa as variáveis do serviço como build args)
ARG DEV_TOOLS=false
RUN VITE_DEV_TOOLS=$DEV_TOOLS npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
ENV STATIC_DIR=/app/static
EXPOSE 8000
# A hospedagem informa a porta em $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
