// Offline rendering. Without the private include nginx cannot start.
const { render } = require('./config.cjs');
const { routes } = require('./showroom-policy.cjs');

function renderShowroom(config) {
  const baseline = render(config);
  const host = new URL(config.publicOrigin).host;
  const map = routes.map(([method, pattern, service]) => `    "~^${method}:${pattern}$" ${service};`).join('\n');
  const prefix = baseline.slice(0, baseline.indexOf('  server { listen 8080 default_server;'))
    .replace('http {', 'http {\n  map_hash_bucket_size 128;')
    .replace('  limit_req_zone $binary_remote_addr zone=login_ip:1m rate=2r/m;', '');
  const login = 'POST:/api/auth/login';
  return `${prefix}
  map "$request_method:$request_uri" $showroom_target {
    default deny;
${map}
  }
  map "$request_method:$request_uri" $showroom_login_ip {
    default "";
    "${login}" $binary_remote_addr;
  }
  limit_req_zone $showroom_login_ip zone=login_ip:1m rate=2r/m;
  map "$showroom_target:$http_upgrade:$http_origin" $showroom_upgrade {
    default "";
    "socket:websocket:${config.publicOrigin}" websocket;
  }
  map $showroom_upgrade $showroom_connection { default upgrade; "" close; }
  server { listen 8080 default_server; server_name _; return 404; }
  server {
    listen 8080;
    server_name ${host};
    add_header Cache-Control "no-store" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    # This private include declares proxy_set_header x-vantara-showroom-ingress.
    # It replaces any value supplied by the client and is never rendered to stdout.
    include showroom-ingress.inc;
    proxy_set_header Host ${host};
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header X-Forwarded-Port "";
    proxy_set_header Upgrade $showroom_upgrade;
    proxy_set_header Connection $showroom_connection;
    limit_conn total_connections 100;
    limit_conn connections 20;
    if ($http_host != "${host}") { return 404; }
    if ($showroom_target = deny) { return 404; }
    error_page 418 = @showroom_api;
    error_page 419 = @showroom_socket;
    location / {
      if ($showroom_target = api) { return 418; }
      if ($showroom_target = socket) { return 419; }
      proxy_pass ${config.webUpstream};
    }
    location @showroom_api {
      limit_req zone=login_ip burst=4 nodelay;
      limit_req zone=api_ip burst=20 nodelay;
      proxy_pass ${config.apiUpstream};
    }
    location @showroom_socket {
      if ($showroom_upgrade = "") { return 404; }
      limit_req zone=socket_ip burst=5 nodelay;
      limit_conn connections 5;
      limit_conn total_connections 100;
      proxy_read_timeout 75s;
      proxy_buffering off;
      proxy_pass ${config.apiUpstream};
    }
  }
}
`;
}
module.exports = { renderShowroom };
if (require.main === module) process.stdout.write(renderShowroom(require('./staging.example.json')));
