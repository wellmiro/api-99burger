require('dotenv').config();
const db = require('./src/config/database'); // ajuste aqui

const email = 'wellingtonmiranda@gmail.com';  // usuário de teste que existe no seu banco
const senha = '4321';           // senha correspondente

db.query('SELECT * FROM usuario WHERE email = ? AND senha = ?', [email, senha], (err, result) => {
    if (err) {
        console.error('Erro no teste de login:', err);
    } else if (result.length === 0) {
        console.log('Login falhou');
    } else {
        console.log('Login OK:', result[0]);
    }
    process.exit();
});
