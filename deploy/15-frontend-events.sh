#!/bin/sh
set -eu
if ! grep -q '^load_module .*ngx_http_js_module.so;' /etc/nginx/nginx.conf; then
  sed -i '1i load_module /usr/lib/nginx/modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf
fi
