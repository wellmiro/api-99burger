const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "mysql-30331302-burgers-api-99.e.aivencloud.com",
    port: 20808,
    user: "avnadmin",
    password: process.env.MYSQLPASSWORD,
    database: "defaultdb",
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect(function(err){
    if (err){
        console.log("Erro ao conectar com o banco da Nuvem:", err.message);
    } else {
        console.log("Conectado com sucesso ao banco Aiven (AWS)!");
    }
});

module.exports = db;