# First stage: building frontend
FROM node:lts-alpine AS build

RUN npm install -g webpack webpack-cli
COPY tdrive/frontend /tdrive-react/

WORKDIR /tdrive-react/

ENV GENERATE_SOURCEMAP=false
RUN cp /tdrive-react/src/app/environment/environment.ts.dist /tdrive-react/src/app/environment/environment.ts && \
    npm ci --legacy-peer-deps && \
    # cat /tdrive-react/src/app/environment/environment.ts.dist && \
    # cat /tdrive-react/src/app/environment/environment.ts && \
    DISABLE_ESLINT_PLUGIN=true TSC_COMPILE_ON_ERROR=true SKIP_PREFLIGHT_CHECK=true npm run build && \
    rm -rf node_modules

# Second stage: configuring nginx and copying build artifacts
FROM nginx:latest
COPY tdrive/docker/tdrive-frontend/nginx.conf /etc/nginx/nginx.conf
COPY tdrive/docker/tdrive-frontend/site.conf /etc/nginx/sites-available/site.template
COPY tdrive/docker/tdrive-frontend/redirect.conf /etc/nginx/sites-available/redirect
COPY tdrive/docker/tdrive-frontend/entrypoint.sh /
COPY tdrive/docker/tdrive-frontend/self-signed.sh /usr/local/bin/
COPY --from=build /tdrive-react /tdrive-react

RUN chmod +x /entrypoint.sh && rm /etc/nginx/conf.d/default.conf

ENTRYPOINT ["/entrypoint.sh", "$DEV"]

EXPOSE 80
EXPOSE 443
