# ---------- First stage: build frontend ----------
FROM node:lts-alpine AS build

# (optionnel) inutile d’installer webpack globalement si présent en devDeps
# RUN npm install -g webpack webpack-cli

WORKDIR /tdrive-react

# Meilleur cache : d'abord les manifestes
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

# Puis le reste du code
COPY frontend/ .

ENV GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true \
    TSC_COMPILE_ON_ERROR=true \
    SKIP_PREFLIGHT_CHECK=true

# Build args fournis par docker-compose pour injecter les URLs au build React
ARG REACT_APP_FRONTEND_URL
ARG REACT_APP_BACKEND_URL
ARG REACT_APP_WEBSOCKET_URL
ARG REACT_APP_ONLYOFFICE_CONNECTOR_URL
ARG REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL

# Expose ces variables au process de build CRA
ENV REACT_APP_FRONTEND_URL=${REACT_APP_FRONTEND_URL}
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV REACT_APP_WEBSOCKET_URL=${REACT_APP_WEBSOCKET_URL}
ENV REACT_APP_ONLYOFFICE_CONNECTOR_URL=${REACT_APP_ONLYOFFICE_CONNECTOR_URL}
ENV REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL=${REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL}

# Copie de l'env si présent (sinon ne pas casser le build)
RUN if [ -f src/app/environment/environment.ts.dist ]; then \
      cp src/app/environment/environment.ts.dist src/app/environment/environment.ts; \
    fi && \
    npm run build && \
    rm -rf node_modules

# ---------- Second stage: nginx ----------
FROM nginx:latest

# Ton script est en bash et utilise openssl → on s’assure qu’ils sont là
RUN apt-get update && apt-get install -y --no-install-recommends bash openssl && rm -rf /var/lib/apt/lists/*

# Chemins corrigés (plus de préfixe "tdrive/")
COPY docker/tdrive-frontend/nginx.conf /etc/nginx/nginx.conf
COPY docker/tdrive-frontend/site.conf /etc/nginx/sites-available/site.template
COPY docker/tdrive-frontend/redirect.conf /etc/nginx/sites-available/redirect
COPY docker/tdrive-frontend/entrypoint.sh /entrypoint.sh
COPY docker/tdrive-frontend/self-signed.sh /usr/local/bin/self-signed.sh

# Artifacts front
COPY --from=build /tdrive-react /tdrive-react

RUN chmod +x /entrypoint.sh /usr/local/bin/self-signed.sh && \
    rm -f /etc/nginx/conf.d/default.conf

# Ne pas passer "$DEV" ici (pas d'expansion en forme JSON)
ENTRYPOINT ["/entrypoint.sh"]

EXPOSE 80
EXPOSE 443

