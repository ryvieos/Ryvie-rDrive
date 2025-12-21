# ---------- First stage: build frontend ----------
FROM node:lts-alpine AS build

WORKDIR /tdrive-react

# Meilleur cache : d'abord les manifestes
COPY frontend/package*.json ./
# Use npm install instead of npm ci because dependencies were updated without regenerating lockfile
RUN npm install --legacy-peer-deps

# Copier uniquement les fichiers de config nécessaires pour le build
COPY frontend/tsconfig*.json frontend/craco.config.js frontend/tailwind.config.js ./
COPY frontend/public ./public

# Puis le code source (séparé pour meilleur cache)
COPY frontend/src ./src

# Optimisations pour accélérer le build
ENV GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true \
    TSC_COMPILE_ON_ERROR=true \
    SKIP_PREFLIGHT_CHECK=true \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=4096"

# Ensure a favicon.ico exists in the CRA public folder (fallback to PNG)
RUN [ -f public/favicon.ico ] || cp public/favicon.png public/favicon.ico || true

# Build args fournis par docker-compose pour injecter les URLs au build React
ARG REACT_APP_FRONTEND_URL
ARG REACT_APP_BACKEND_URL
ARG REACT_APP_WEBSOCKET_URL
ARG REACT_APP_ONLYOFFICE_CONNECTOR_URL
ARG REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL
ARG REACT_APP_FRONTEND_URL_PRIVATE

# Expose ces variables au process de build CRA
ENV REACT_APP_FRONTEND_URL=${REACT_APP_FRONTEND_URL}
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV REACT_APP_WEBSOCKET_URL=${REACT_APP_WEBSOCKET_URL}
ENV REACT_APP_ONLYOFFICE_CONNECTOR_URL=${REACT_APP_ONLYOFFICE_CONNECTOR_URL}
ENV REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL=${REACT_APP_ONLYOFFICE_DOCUMENT_SERVER_URL}
ENV REACT_APP_FRONTEND_URL_PRIVATE=${REACT_APP_FRONTEND_URL_PRIVATE}

# Copie de l'env si présent (sinon ne pas casser le build)
RUN if [ -f src/app/environment/environment.ts.dist ]; then \
      cp src/app/environment/environment.ts.dist src/app/environment/environment.ts; \
    fi

# Build avec cache et optimisations
RUN npm run build

# Nettoyer pour réduire la taille de l'image
RUN rm -rf node_modules src

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

