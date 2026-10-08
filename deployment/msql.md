--Install

dnf install mysql-server -y

--Configure
systemctl enable mysqld
systemctl start mysqld

--Set the root password

mysql_secure_installation --set-root-pass <Password>

--Verification
mysql 
mysql -h <MYSQL-SERVER-IPADDRESS> -u root -p<password>
SHOW DATABASES;
