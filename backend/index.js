const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const transactionService = require('./TransactionService');

const app = express();
const PORT = process.env.APP_PORT || 8080;

const ADMIN_TOKEN        = process.env.ADMIN_TOKEN || 'admin123';
const RATE_LIMIT_MAX     = Number(process.env.RATE_LIMIT_MAX) || 10;
const RATE_LIMIT_WINDOW  = (Number(process.env.RATE_LIMIT_WINDOW_SEC) || 60) * 1000;

// ── middleware ───────────────────────────────────────────────────────────────

app.use(cors());

// access log: every request with its status code shows up in `journalctl -u backend`
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
});

// 413 when the JSON body is larger than 10kb (see error handler below)
app.use(bodyParser.json({ limit: '10kb' }));

// ── helpers ──────────────────────────────────────────────────────────────────

function validateTransaction(body) {
    const errors = [];

    const amount = Number(body.amount);
    if (!body.amount && body.amount !== 0) {
        errors.push('amount is required');
    } else if (!Number.isInteger(amount) || amount <= 0) {
        errors.push('amount must be a positive integer');
    } else if (amount > 1000000) {
        errors.push('amount cannot exceed 1,000,000');
    }

    if (!body.description || String(body.description).trim() === '') {
        errors.push('description is required');
    } else if (String(body.description).trim().length > 255) {
        errors.push('description cannot exceed 255 characters');
    }

    if (!body.category || String(body.category).trim() === '') {
        errors.push('category is required');
    } else if (!transactionService.VALID_CATEGORIES.includes(body.category)) {
        errors.push(`category must be one of: ${transactionService.VALID_CATEGORIES.join(', ')}`);
    }

    return errors;
}

function parseId(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ message: 'invalid id' });
        return null;
    }
    return id;
}

// DB unreachable → 503 (temporary, retry later); any other DB error → 500 (server bug)
function sendDbError(req, res, err, message) {
    const unavailable = transactionService.isDbUnavailable(err);
    console.error(`${req.method} ${req.originalUrl} error:`, err.code || '', err.message);
    if (unavailable) {
        return res.status(503).set('Retry-After', '30').json({ message: 'database unavailable', error: err.message });
    }
    res.status(500).json({ message, error: err.message });
}

// 415 — POST/PUT must send JSON
function requireJson(req, res, next) {
    if (!req.is('application/json')) {
        return res.status(415).json({ message: 'Content-Type must be application/json' });
    }
    next();
}

// 401 — no token sent, 403 — wrong token sent
function requireAdmin(req, res, next) {
    const auth = req.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).trim() === '') {
        return res.status(401).set('WWW-Authenticate', 'Bearer realm="expense"')
            .json({ message: 'admin token required' });
    }
    if (auth.slice(7).trim() !== ADMIN_TOKEN) {
        return res.status(403).json({ message: 'invalid admin token' });
    }
    next();
}

// 429 — simple in-memory rate limit on write requests, per client IP
const hits = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(ip);
    }
}, RATE_LIMIT_WINDOW).unref();

function rateLimit(req, res, next) {
    const ip = (req.get('X-Forwarded-For') || '').split(',')[0].trim() || req.ip;
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
        hits.set(ip, entry);
    }
    entry.count++;
    res.set('RateLimit-Limit', String(RATE_LIMIT_MAX));
    res.set('RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - entry.count)));
    if (entry.count > RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return res.status(429).set('Retry-After', String(retryAfter))
            .json({ message: `too many requests, try again in ${retryAfter}s` });
    }
    next();
}

// ── health ───────────────────────────────────────────────────────────────────

// 200 when the DB answers, 503 when it doesn't
app.get('/health', (req, res) => {
    transactionService.ping((err) => {
        if (err) {
            return res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
        }
        res.json({ status: 'ok', db: 'up' });
    });
});

// ── /transaction ─────────────────────────────────────────────────────────────

// GET all transactions  →  200 (304 when the client sends a matching If-None-Match)
app.get('/transaction', (req, res) => {
    transactionService.getAllTransactions((err, results) => {
        if (err) return sendDbError(req, res, err, 'could not retrieve transactions');
        res.json({ result: results });
    });
});

// ADD a transaction  →  201 Created + Location header
/*app.post('/transaction/bulk', rateLimit, requireJson, (req, res) => {
    const errors = validateTransaction(req.body);
    if (errors.length > 0) {
        return res.status(422).json({ message: 'validation failed', errors });
    }

    const amount      = Number(req.body.amount);
    const description = String(req.body.description).trim();
    const category    = String(req.body.category).trim();

    transactionService.addTransaction(amount, description, category, (err, result) => {
        if (err) return sendDbError(req, res, err, 'could not add transaction');
        res.status(201)
            .location(`transaction/${result.insertId}`)
            .json({ message: 'transaction added successfully', id: result.insertId });
    });
});*/
app.post('/transaction/bulk', rateLimit, requireJson, (req, res) => {
    const { transactions } = req.body;

    // Validate request structure
    if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(422).json({
            message: 'validation failed',
            errors: ['transactions must be a non-empty array']
        });
    }

    // Validate every transaction
    const validationErrors = [];

    transactions.forEach((transaction, index) => {
        const errors = validateTransaction(transaction);

        errors.forEach(error => {
            validationErrors.push(`transaction ${index + 1}: ${error}`);
        });
    });

    if (validationErrors.length > 0) {
        return res.status(422).json({
            message: 'validation failed',
            errors: validationErrors
        });
    }

    // Prepare clean data
    const cleanedTransactions = transactions.map(transaction => ({
        amount: Number(transaction.amount),
        description: String(transaction.description).trim(),
        category: String(transaction.category).trim()
    }));

    // Insert all transactions
    transactionService.addTransactions(
        cleanedTransactions,
        (err, result) => {
            if (err) {
                return sendDbError(
                    req,
                    res,
                    err,
                    'could not add transactions'
                );
            }

            res.status(201).json({
                message: 'transactions added successfully',
                inserted: result.affectedRows
            });
        }
    );
});

// DELETE all transactions  →  200 (admin token required)
app.delete('/transaction', rateLimit, requireAdmin, (req, res) => {
    transactionService.deleteAllTransactions((err, result) => {
        if (err) return sendDbError(req, res, err, 'could not delete transactions');
        res.json({ message: 'all transactions deleted', deleted: result.affectedRows });
    });
});

// 405 for any other method on /transaction
app.all('/transaction', (req, res) => {
    res.status(405).set('Allow', 'GET, POST, DELETE').json({ message: 'method not allowed' });
});

// ── /transaction/:id ─────────────────────────────────────────────────────────

// GET single transaction  →  200 / 404
app.get('/transaction/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    transactionService.findTransactionById(id, (err, results) => {
        if (err) return sendDbError(req, res, err, 'could not retrieve transaction');
        if (!results || results.length === 0) {
            return res.status(404).json({ message: `transaction ${id} not found` });
        }
        res.json(results[0]);
    });
});

// UPDATE a transaction  →  200 with the updated row / 404
app.put('/transaction/:id', rateLimit, requireJson, (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;

    const errors = validateTransaction(req.body);
    if (errors.length > 0) {
        return res.status(422).json({ message: 'validation failed', errors });
    }

    const amount      = Number(req.body.amount);
    const description = String(req.body.description).trim();
    const category    = String(req.body.category).trim();

    transactionService.updateTransaction(id, amount, description, category, (err) => {
        if (err) return sendDbError(req, res, err, 'could not update transaction');
        transactionService.findTransactionById(id, (err2, results) => {
            if (err2) return sendDbError(req, res, err2, 'could not retrieve transaction');
            if (!results || results.length === 0) {
                return res.status(404).json({ message: `transaction ${id} not found` });
            }
            res.json({ message: 'transaction updated successfully', transaction: results[0] });
        });
    });
});

// DELETE single transaction  →  204 No Content / 404
app.delete('/transaction/:id', rateLimit, (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    transactionService.deleteTransactionById(id, (err, result) => {
        if (err) return sendDbError(req, res, err, 'could not delete transaction');
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: `transaction ${id} not found` });
        }
        res.status(204).end();
    });
});

// 405 for any other method on /transaction/:id
app.all('/transaction/:id', (req, res) => {
    res.status(405).set('Allow', 'GET, PUT, DELETE').json({ message: 'method not allowed' });
});

// ── redirects (3XX) ──────────────────────────────────────────────────────────
// Relative Location headers so they work both directly (:8080) and behind nginx (/api/)

// 301 — old plural URL moved permanently (GET/HEAD)
app.get('/transactions', (req, res) => {
    res.redirect(301, 'transaction');
});

// 308 — same, but keeps the method and body (POST stays POST)
app.all('/transactions', (req, res) => {
    res.redirect(308, 'transaction');
});

// 302 — temporary redirect to whichever transaction is newest right now
app.get('/latest', (req, res) => {
    transactionService.findLatestTransaction((err, results) => {
        if (err) return sendDbError(req, res, err, 'could not retrieve latest transaction');
        if (!results || results.length === 0) {
            return res.status(404).json({ message: 'no transactions yet' });
        }
        res.redirect(302, `transaction/${results[0].id}`);
    });
});

// ── demo endpoints for 5XX ───────────────────────────────────────────────────

// 500 — unhandled exception in application code
app.get('/error', () => {
    throw new Error('simulated application failure');
});

// 503 — service is deliberately in maintenance
app.get('/maintenance', (req, res) => {
    res.status(503).set('Retry-After', '60').json({ message: 'service temporarily unavailable' });
});

// 504 — slow response; nginx gives up first (LB: 10s, frontend: 30s). ?seconds=N (default 40, max 120)
app.get('/slow', (req, res) => {
    const seconds = Math.min(Math.max(Number(req.query.seconds) || 40, 0), 120);
    setTimeout(() => res.json({ message: `finally responded after ${seconds}s` }), seconds * 1000);
});

// ── fallbacks ────────────────────────────────────────────────────────────────

// 404 for unknown routes (JSON instead of Express's default HTML page)
app.use((req, res) => {
    res.status(404).json({ message: `route ${req.method} ${req.path} not found` });
});

// 400 malformed JSON, 413 body too large, 500 anything else
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: 'malformed JSON body' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ message: 'request body too large (limit 10kb)' });
    }
    console.error(`${req.method} ${req.originalUrl} unhandled error:`, err.message);
    res.status(500).json({ message: 'internal server error', error: err.message });
});

// ── start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`Expense backend v5 listening on port ${PORT}`);
});
