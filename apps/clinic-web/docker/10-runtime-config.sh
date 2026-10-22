#!/bin/sh
# Writes /config.json for the web app from the container environment (Kamal env), so no value is baked into the image.
set -eu
cat > /usr/share/nginx/html/config.json <<JSON
{"sentryDsn":"${SENTRY_DSN_WEB:-}","environment":"${APP_ENV:-local}","release":"${KAMAL_VERSION:-}"}
JSON
