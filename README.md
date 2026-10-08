# AWS 3-Tier Expense Application

A highly available 3-tier expense application deployed on AWS EC2.

## Architecture

Internet
↓
Nginx + HAProxy Load Balancer
↓
Frontend 1 / Frontend 2
↓
Node.js Backend
↓
MySQL Database

## Infrastructure

| Server | Role | Port |
|---|---|---|
| Load Balancer | Nginx + HAProxy | 80 / 8080 |
| Frontend 1 | Nginx | 80 |
| Frontend 2 | Nginx | 80 |
| Backend | Node.js / Express | 8080 |
| Database | MySQL | 3306 |

## Traffic Flow

Client → Load Balancer → HAProxy → Frontend → Backend → MySQL

## API

### Get transactions

GET /api/transaction

### Add transaction

POST /api/transaction

### Bulk insert

POST /api/transaction/bulk

### Get transaction

GET /api/transaction/:id

### Update

PUT /api/transaction/:id

### Delete

DELETE /api/transaction/:id

## High Availability

HAProxy distributes requests between:

- frontend1
- frontend2

using round-robin load balancing.

## Health Checks

HAProxy checks:

GET /

Backend health:

GET /health

## Security

Secrets and credentials are not stored in Git.

Environment variables are used for:

- Database credentials
- Admin token
- Application configuration
