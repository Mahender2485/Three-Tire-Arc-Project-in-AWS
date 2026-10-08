--Install Nginx
dnf install nginx -y
systemctl enable nginx
systemctl start nginx

--Deploy Frontend Content
rm -rf /usr/share/nginx/html/*
curl -o /tmp/frontend.tar.gz https://raw.githubusercontent.com/daws-92s/expense-documentation/refs/heads/main/artifacts/expense-frontend-v5.tar.gz
cd /usr/share/nginx/html
tar -xzf /tmp/frontend.tar.gz
--Configure Nginx Reverse Proxy
vim /etc/nginx/default.d/expense.conf
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s;
proxy_read_timeout    30s;   # 504 if the backend takes longer than this

# Browser calls /api/transaction → nginx strips /api → backend gets /transaction
location /api/ {
    proxy_pass http://<BACKEND-PRIVATE-IP>:8080/;
}

location /health {
    stub_status on;
    access_log off;
}

# ── HTTP status code demos at the web-server layer ──────────────────────────
# 301 — page moved permanently
location = /home {
    return 301 /;
}

# 302 — temporary redirect to an external page
location = /docs {
    return 302 https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status;
}

# 403 — nobody is allowed here
location /admin {
    deny all;
}

--Test Config
nginx -t

--Verification
Open the browser at http://<FRONTEND-PUBLIC-IP>
Test the reverse proxy is forwarding correctly:
curl http://localhost/api/health
