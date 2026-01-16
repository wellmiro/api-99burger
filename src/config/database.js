const mysql = require("mysql2");

// Usamos createPool para que a conexão se recupere sozinha de quedas
const db = mysql.createPool({
    host: "mysql-30331302-burgers-api-99.e.aivencloud.com",
    port: 20808,
    user: "avnadmin",
    password: process.env.MYSQLPASSWORD,
    database: "defaultdb",
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// No Pool, verificamos a conexão assim:
db.getConnection((err, connection) => {
    if (err) {
        console.log("Erro ao conectar com o banco da Nuvem:", err.message);
    } else {
        console.log("Conectado com sucesso ao banco Aiven (AWS)!");
        connection.release(); // Libera a conexão para o pool
    }
});

module.exports = db;