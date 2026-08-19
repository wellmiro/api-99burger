require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require("express");
const cors = require("cors");
const db = require("./config/database");

const app = express();
const token = require("./token.js"); 

// --- MIDDLEWARES ---
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// =============================================================================
// FUNÇÕES AUXILIARES (IMPLEMENTATION) - Necessárias para as rotas de estoque
// =============================================================================

function executeQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
}

async function recalcularEstoqueProduto(id_produto, id_estabelecimento) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT T.qtd_consumida, I.qtd_atual, P.unidade_medida
            FROM produto_ficha_tecnica T
            JOIN insumo I ON T.id_insumo = I.id_insumo
            JOIN produto P ON P.id_produto = T.id_produto
            WHERE T.id_produto = ? AND P.id_estabelecimento = ?
        `;

        db.query(sql, [id_produto, id_estabelecimento], (err, rows) => {
            if (err) return reject(err);
            if (rows.length === 0) return resolve(0);

            const capacidades = rows.map(item => {
                const qtdInsumo = parseFloat(item.qtd_atual) || 0;
                const consome = parseFloat(item.qtd_consumida) || 0;
                return consome > 0 ? qtdInsumo / consome : 999999;
            });

            let estoqueReal = Math.min(...capacidades);
            if (rows[0].unidade_medida === 'UN') {
                estoqueReal = Math.floor(estoqueReal);
            } else {
                estoqueReal = parseFloat(estoqueReal.toFixed(3));
            }

            db.query("UPDATE produto SET qtd = ? WHERE id_produto = ?", [estoqueReal, id_produto], (err2) => {
                if (err2) return reject(err2);
                resolve(estoqueReal);
            });
        });
    });
}

// =============================================================================
// ROTAS DE USUÁRIOS E VERSÃO
// =============================================================================

app.get("/versao", function (req, res) {
    const ssql = "SELECT plataforma, numero_versao FROM versao";
    db.query(ssql, function (err, result) {
        if (err) return res.status(500).send(err);
        const versoes = {};
        result.forEach(v => versoes[v.plataforma] = v.numero_versao);
        return res.status(200).json(versoes);
    });
});

app.post('/usuarios', token.ValidateJWT, (req, res) => {
    const { nome, email, senha, tipo } = req.body;
    const ssql = "INSERT INTO usuario (nome, email, senha, tipo, status) VALUES (?, ?, ?, ?, 'S')";
    db.query(ssql, [nome, email, senha, tipo || 'A'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(201).json({ id_usuario: result.insertId });
    });
});

app.post("/login", function (req, res) {
    const { email, senha } = req.body;
    const ssql = `SELECT u.*, e.nome AS nome_estabelecimento, e.logo AS url_logo, e.qtd_mesas 
                  FROM usuario u LEFT JOIN estabelecimento e ON e.id_estabelecimento = u.id_estabelecimento 
                  WHERE u.email = ?`;
    db.query(ssql, [email], function (err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco" });
        if (result.length > 0 && senha === result[0].senha) {
            const usuario = result[0];
            const tokenJwt = jwt.sign({ id_usuario: usuario.id_usuario, nome: usuario.nome, tipo: usuario.tipo, id_estabelecimento: usuario.id_estabelecimento, qtd_mesas: usuario.qtd_mesas }, process.env.JWT_SECRET, { expiresIn: "24h" });
            return res.status(200).json({ ...usuario, token: tokenJwt });
        }
        return res.status(401).json({ error: "Credenciais inválidas" });
    });
});

// =============================================================================
// ROTAS DE PRODUTOS E ESTOQUE
// =============================================================================

app.get('/produtos/estoque/:id', (req, res) => {
    db.query('SELECT qtd FROM produto WHERE id_produto = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: "Erro ao consultar estoque" });
        if (results.length > 0) res.json({ qtd: results[0].qtd });
        else res.status(404).json({ error: "Não encontrado" });
    });
});

app.get("/produtos", token.ValidateJWT, function (request, response) {
    const id_estabelecimento = request.id_estabelecimento;
    let ssql = `SELECT p.*, c.descricao AS categoria,
                (SELECT COALESCE(SUM(pft.qtd_consumida * i.custo_unitario), 0) FROM produto_ficha_tecnica pft JOIN insumo i ON i.id_insumo = pft.id_insumo WHERE pft.id_produto = p.id_produto) AS custo_total
                FROM produto p JOIN produto_categoria c ON c.id_categoria = p.id_categoria
                WHERE p.id_estabelecimento = ? ORDER BY c.ordem`;
    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) return response.status(500).send(err);
        const produtos = result.map(p => ({ ...p, preco: parseFloat(p.preco), custo_total: parseFloat(p.custo_total) || 0 }));
        return response.status(200).json(produtos);
    });
});

// ROTA DE UPDATE (FIX PRODUÇÃO: AGORA ACEITA ATUALIZAÇÃO PARCIAL)
app.put("/produtos/:id", token.ValidateJWT, function (req, res) {
    const id_produto = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, unidade_medida } = req.body;
    
    const campos = []; const valores = [];
    if (nome !== undefined) { campos.push("nome = ?"); valores.push(nome); }
    if (preco !== undefined) { campos.push("preco = ?"); valores.push(Math.max(0, parseFloat(preco))); }
    if (descricao !== undefined) { campos.push("descricao = ?"); valores.push(descricao); }
    if (url_foto !== undefined) { campos.push("url_foto = ?"); valores.push(url_foto); }
    if (qtd !== undefined) { campos.push("qtd = ?"); valores.push(qtd); }
    if (qtd_max !== undefined) { campos.push("qtd_max = ?"); valores.push(qtd_max); }
    if (qtd_min !== undefined) { campos.push("qtd_min = ?"); valores.push(qtd_min); }
    if (id_categoria !== undefined) { campos.push("id_categoria = ?"); valores.push(id_categoria); }
    if (unidade_medida !== undefined) { campos.push("unidade_medida = ?"); valores.push(unidade_medida); }

    if (campos.length === 0) return res.status(400).json({ error: "Nada para atualizar" });
    const ssql = `UPDATE produto SET ${campos.join(", ")} WHERE id_produto = ? AND id_estabelecimento = ?`;
    valores.push(id_produto, id_estabelecimento);
    db.query(ssql, valores, (err, result) => {
        if (err) return res.status(500).json(err);
        res.status(200).json({ message: "Atualizado com sucesso" });
    });
});

app.post("/produtos", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento;
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, unidade_medida } = req.body;
    const ssql = `INSERT INTO produto (nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, id_estabelecimento, unidade_medida) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(ssql, [nome, preco || 0, descricao || "", url_foto || "", qtd || 0, qtd_max || 0, qtd_min || 0, id_categoria, id_estabelecimento, unidade_medida || "UN"], (err, result) => {
        if (err) return res.status(500).json(err);
        res.status(201).json({ id_produto: result.insertId });
    });
});

// =============================================================================
// ROTAS DE FICHA TÉCNICA E INSUMOS
// =============================================================================

app.get('/produtos/:id_produto/ficha', token.ValidateJWT, (req, res) => {
    const sql = `SELECT T.*, I.nome, I.unidade_medida, I.custo_unitario, I.qtd_atual 
                 FROM produto_ficha_tecnica T JOIN insumo I ON T.id_insumo = I.id_insumo
                 WHERE T.id_produto = ?`;
    db.query(sql, [req.params.id_produto], (err, results) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(results);
    });
});

app.post('/produtos/ficha', token.ValidateJWT, async (req, res) => {
    const { id_produto, id_insumo, qtd_consumida } = req.body;
    try {
        await executeQuery(`INSERT INTO produto_ficha_tecnica (id_produto, id_insumo, qtd_consumida) VALUES (?, ?, ?)`, [id_produto, id_insumo, qtd_consumida]);
        const estoque = await recalcularEstoqueProduto(id_produto, req.id_estabelecimento);
        res.status(201).json({ sucesso: true, estoque_calculado: estoque });
    } catch (err) { res.status(500).json({ erro: "Erro ao salvar ficha" }); }
});

app.delete('/produtos/ficha/:id_ficha', token.ValidateJWT, async (req, res) => {
    try {
        const rows = await executeQuery(`SELECT id_produto FROM produto_ficha_tecnica WHERE id_ficha = ?`, [req.params.id_ficha]);
        if (rows.length === 0) return res.status(404).json({ erro: "Não encontrado" });
        const id_produto = rows[0].id_produto;
        await executeQuery(`DELETE FROM produto_ficha_tecnica WHERE id_ficha = ?`, [req.params.id_ficha]);
        const novoEstoque = await recalcularEstoqueProduto(id_produto, req.id_estabelecimento);
        res.json({ sucesso: true, qtd: novoEstoque });
    } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.get('/insumos', token.ValidateJWT, (req, res) => {
    db.query("SELECT * FROM insumo WHERE id_estabelecimento = ? ORDER BY nome", [req.id_estabelecimento], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

// =============================================================================
// ROTAS DE PEDIDOS E FINANCEIRO (MANTIDAS INTEGRALMENTE)
// =============================================================================

app.get("/pedidos/resumo", token.ValidateJWT, function (request, response) {
    const ssql = `SELECT p.*, DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i:%s') AS dt_pedido, u.nome AS nome_login
                  FROM pedido p LEFT JOIN usuario u ON u.id_usuario = p.id_usuario
                  WHERE p.id_estabelecimento = ? ORDER BY p.dt_pedido DESC`;
    db.query(ssql, [request.id_estabelecimento], (err, result) => {
        if (err) return response.status(500).send(err);
        return response.status(200).json(result);
    });
});

app.post('/pedidos/status/:id_pedido', token.ValidateJWT, async (req, res) => {
    const { id_pedido } = req.params;
    const { status } = req.body;
    try {
        await executeQuery("UPDATE pedido SET status = ? WHERE id_pedido = ? AND id_estabelecimento = ?", [status.toUpperCase(), id_pedido, req.id_estabelecimento]);
        res.json({ message: "Status atualizado" });
    } catch (err) { res.status(500).json(err); }
});

app.get("/despesas", token.ValidateJWT, function (req, res) {
    const ssql = `SELECT d.*, c.descricao as categoria_nome FROM despesa d 
                  LEFT JOIN despesa_categoria c ON (c.id_categoria = d.id_categoria) 
                  WHERE d.id_estabelecimento = ? ORDER BY d.data_vencimento ASC`;
    db.query(ssql, [req.id_estabelecimento], (err, result) => {
        if (err) return res.status(500).json(err);
        return res.status(200).json(result);
    });
});

app.get("/financeiro/resumo", token.ValidateJWT, function (req, res) {
    const { mes, ano } = req.query;
    const ssql = `SELECT 
            (SELECT SUM(vl_total) FROM pedido WHERE id_estabelecimento = ? AND MONTH(dt_pedido) = ? AND YEAR(dt_pedido) = ? AND status <> 'C') as total_vendas,
            (SELECT SUM(valor) FROM despesa WHERE id_estabelecimento = ? AND MONTH(data_vencimento) = ? AND YEAR(data_vencimento) = ? AND status = 'P') as total_despesas_pagas`;
    db.query(ssql, [req.id_estabelecimento, mes, ano, req.id_estabelecimento, mes, ano], (err, result) => {
        if (err) return res.status(500).json(err);
        return res.status(200).json(result[0]);
    });
});

// v2, v3, v4, v5... (comentários preservados)

// =============================================================================
// LIGAR O SERVIDOR (SÓ UMA VEZ NO FINAL DO ARQUIVO)
// =============================================================================
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`API 99Burger rodando na porta ${port}`);
});