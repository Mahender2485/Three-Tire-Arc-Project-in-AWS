const dbcreds = require('./DbConfig');
const mysql = require('mysql2');

const pool = mysql.createPool({
    host     : process.env.DB_HOST     || dbcreds.DB_HOST,
    user     : process.env.DB_USER     || dbcreds.DB_USER,
    password : process.env.DB_PWD      || dbcreds.DB_PWD,
    database : process.env.DB_DATABASE || dbcreds.DB_DATABASE,
    waitForConnections : true,
    connectionLimit    : 10,
    connectTimeout     : 5000
});

const VALID_CATEGORIES = ['Food', 'Travel', 'Entertainment', 'Shopping', 'Health', 'Utilities', 'Other'];

// Error codes that mean "database is unreachable" (→ 503) rather than "query is broken" (→ 500)
const DB_UNAVAILABLE_CODES = [
    'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR'
];

function isDbUnavailable(err) {
    return Boolean(err && DB_UNAVAILABLE_CODES.includes(err.code));
}

function ping(callback) {
    pool.query('SELECT 1', callback);
}

function addTransaction(amount, description, category, callback) {
    const sql = 'INSERT INTO transactions (amount, description, category) VALUES (?, ?, ?)';
    pool.query(sql, [amount, description, category], callback);
}
function addTransactions(transactions, callback) {
    const sql = `
        INSERT INTO transactions
        (amount, description, category)
        VALUES ?
    `;

    const values = transactions.map(transaction => [
        transaction.amount,
        transaction.description,
        transaction.category
    ]);

    pool.query(sql, [values], callback);
}

function getAllTransactions(callback) {
    pool.query('SELECT * FROM transactions ORDER BY id DESC', callback);
}

function findTransactionById(id, callback) {
    pool.query('SELECT * FROM transactions WHERE id = ?', [id], callback);
}

function findLatestTransaction(callback) {
    pool.query('SELECT * FROM transactions ORDER BY id DESC LIMIT 1', callback);
}

function updateTransaction(id, amount, description, category, callback) {
    const sql = 'UPDATE transactions SET amount = ?, description = ?, category = ? WHERE id = ?';
    pool.query(sql, [amount, description, category, id], callback);
}

function deleteAllTransactions(callback) {
    pool.query('DELETE FROM transactions', callback);
}

function deleteTransactionById(id, callback) {
    pool.query('DELETE FROM transactions WHERE id = ?', [id], callback);
}

module.exports = {
    VALID_CATEGORIES,
    isDbUnavailable,
    ping,
    addTransaction,
    addTransactions,
    getAllTransactions,
    findTransactionById,
    findLatestTransaction,
    updateTransaction,
    deleteAllTransactions,
    deleteTransactionById
};
