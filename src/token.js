const jwt = require("jsonwebtoken");

function ValidateJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Pega o token após o "Bearer"

    if (!token) {
        return res.status(401).json({ error: "Token não fornecido. Acesso negado." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "Token inválido ou expirado." });
        }

        // --- O PULO DO GATO ---
        // Pegamos o ID do estabelecimento que guardamos no login e injetamos no request
        req.id_usuario = decoded.id_usuario;
        req.id_estabelecimento = decoded.id_estabelecimento;
        
        next(); // Pode seguir para a rota
    });
}

module.exports = { ValidateJWT };