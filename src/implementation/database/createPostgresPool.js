const { Pool } = require("pg");

function createPostgresPool() {
    return new Pool({
        connectionString:
            process.env.DATABASE_URL
    });
}

module.exports =
    createPostgresPool;