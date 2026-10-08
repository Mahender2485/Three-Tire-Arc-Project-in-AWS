# Load Balancer

## Components

- Nginx
- HAProxy

## Nginx

Nginx listens on port 80.

Nginx forwards traffic to the HAProxy/load-balancing layer.

## HAProxy

HAProxy distributes traffic between:

- frontend1
- frontend2

Algorithm:

roundrobin

Health check:
haproxy -c -f /etc/haproxy/haproxy.cfg
curl http://frontend1
curl http://frontend2
