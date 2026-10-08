--Install Node.js
dnf module disable nodejs -y
dnf module enable nodejs:24 -y
dnf install nodejs -y

--Verify
node -v

--Set Up Application Directory
mkdir /app
--Create Application User
useradd --system --home /app --shell /sbin/nologin --comment "expense system user" expense

--Download and Extract Application
curl -o /tmp/backend.tar.gz https://raw.githubusercontent.com/daws-92s/expense-documentation/refs/heads/main/artifacts/expense-backend-v5.tar.gz
cd /app
tar -xzf /tmp/backend.tar.gz

--Install Dependencies
cd /app
npm install

--Configure SystemD Service
vim /etc/systemd/system/backend.service
[Unit]
Description=Expense Backend Service
After=network.target

[Service]
User=expense
Environment=DB_HOST=<MYSQL-SERVER-IPADDRESS>
Environment=DB_USER=expense
Environment=DB_PWD=ExpenseApp@1
Environment=DB_DATABASE=transactions
Environment=ADMIN_TOKEN=admin123
ExecStart=/bin/node /app/index.js
SyslogIdentifier=backend
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target

--Load Database Schema
dnf install mysql -y
mysql -h <MYSQL-SERVER-IPADDRESS> -u root -pExpenseApp@1 < /app/schema/backend.sql

--Start the Service
systemctl daemon-reload
systemctl enable backend
systemctl start backend

--Test the health endpoint (from the same server):

curl http://localhost:8080/health
