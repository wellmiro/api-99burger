require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require("express");
const cors = require("cors");
const db = require("./config/database");
const axios = require("axios");

const app = express();

const token = require("./token.js"); // Certifique-se que o caminho está correto

// --- MIDDLEWARES ---
app.use(express.json());

// O CORS configurado assim está perfeito para aceitar conexões do seu Portal e App
app.use(cors({
    origin: '*',
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// --- ROTAS DO MERCADO PAGO ---
const registrarRotasMercadoPago = require("./routes/mercadopago");
registrarRotasMercadoPago(app);

// Recalcula o total pago na divisao_pagamento e atualiza pedido.vl_falta
async function recalcularSaldoPedido(id_pedido, id_estabelecimento) {
    const rows = await executeQuery(
        `SELECT 
            p.vl_total,
            p.status,
            COALESCE((SELECT SUM(d.valor_pago) FROM divisao_pagamento d WHERE d.id_pedido = p.id_pedido), 0) AS vl_pago
         FROM pedido p
         WHERE p.id_pedido = ? AND p.id_estabelecimento = ?`,
        [id_pedido, id_estabelecimento]
    );

    if (rows.length === 0) return null;

    const vl_total = Number(rows[0].vl_total) || 0;
    const vl_pago = Number(rows[0].vl_pago) || 0;
    const vl_falta = Math.max(0, Number((vl_total - vl_pago).toFixed(2)));

    await executeQuery(
        "UPDATE pedido SET vl_falta = ? WHERE id_pedido = ? AND id_estabelecimento = ?",
        [vl_falta, id_pedido, id_estabelecimento]
    );

    return { vl_total, vl_pago, vl_falta, status: rows[0].status };
}


// --- ROTAS ---

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

// Rota para consultar estoque em tempo real
app.get('/produtos/estoque/:id', (req, res) => {
    const idProduto = req.params.id;

    // Correção: Alterado de 'produtos' para 'produto' 
    // e de 'id' para 'id_produto' conforme o seu schema
    const sql = 'SELECT qtd FROM produto WHERE id_produto = ?';

    db.query(sql, [idProduto], (err, results) => {
        if (err) {
            console.error("Erro no SQL de estoque:", err);
            return res.status(500).json({ error: "Erro ao consultar estoque" });
        }

        if (results.length > 0) {
            // Retorna o objeto com a quantidade encontrada
            res.json({ qtd: results[0].qtd });
        } else {
            // Se o produto não existir, retorna 404
            res.status(404).json({ error: "Produto não encontrado" });
        }
    });
});

  // Rotas
  // GET: listar produtos do cardápio com qtd_min e qtd_max
  // O id_estabelecimento vem 'carimbado' no token e o middleware joga no request
app.get("/produtos/cardapio", token.ValidateJWT, function (request, response) {
    
    // SEGURANÇA: Pegamos o ID direto do Token decodificado, nunca do body ou URL
    const id_estabelecimento = request.id_estabelecimento;

    if (!id_estabelecimento) {
        return response.status(400).json({ error: "Estabelecimento não identificado no token." });
    }

    let ssql = `
        SELECT 
            p.id_produto,
            p.nome,
            p.descricao,
            p.url_foto,
            p.preco,
            p.qtd,
            p.qtd_max,
            p.qtd_min,
            p.unidade_medida,
            c.descricao AS categoria,
            c.id_categoria
        FROM produto p
        JOIN produto_categoria c ON c.id_categoria = p.id_categoria
        WHERE p.id_estabelecimento = ? 
        ORDER BY c.ordem
    `;

    // Passamos o ID no array [id_estabelecimento] para evitar SQL Injection
    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) {
            console.error("Erro ao buscar produtos:", err);
            return response.status(500).json({ error: "Erro interno no servidor" });
        }

        const produtos = result.map(p => ({
            id_produto: p.id_produto,
            nome: p.nome,
            descricao: p.descricao,
            url_foto: p.url_foto,
            preco: parseFloat(p.preco),
            qtd: Number(p.qtd),
            qtd_max: Number(p.qtd_max),
            qtd_min: Number(p.qtd_min),
            unidade_medida: p.unidade_medida || "UN",
            categoria: p.categoria,
            id_categoria: p.id_categoria
        }));

        return response.status(200).json(produtos);
    });
});


  app.get("/produtos", token.ValidateJWT, function (request, response) {
    const id_estabelecimento = request.id_estabelecimento;

    let ssql = `
        SELECT 
            p.id_produto,
            p.nome,
            p.descricao,
            p.url_foto,
            p.preco,
            p.qtd,
            p.qtd_max,
            p.qtd_min,
            p.unidade_medida,
            c.descricao AS categoria,
            c.id_categoria,
            (
                SELECT COALESCE(SUM(pft.qtd_consumida * i.custo_unitario), 0)
                FROM produto_ficha_tecnica pft
                JOIN insumo i ON i.id_insumo = pft.id_insumo
                WHERE pft.id_produto = p.id_produto
            ) AS custo_total
        FROM produto p
        JOIN produto_categoria c ON c.id_categoria = p.id_categoria
        WHERE p.id_estabelecimento = ?
        ORDER BY c.ordem
    `;

    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) {
            console.error("Erro ao buscar produtos:", err);
            return response.status(500).send(err);
        } else {
            const produtos = result.map(p => ({
                id_produto: p.id_produto,
                nome: p.nome,
                descricao: p.descricao,
                url_foto: p.url_foto,
                preco: parseFloat(p.preco),
                qtd: Number(p.qtd),
                qtd_max: Number(p.qtd_max),
                qtd_min: Number(p.qtd_min),
                unidade_medida: p.unidade_medida || "UN",
                categoria: p.categoria,
                id_categoria: p.id_categoria,
                custo_total: parseFloat(p.custo_total) || 0
            }));
            return response.status(200).json(produtos);
        }
    });
});


  // Atualizar produto
 // Atualizar produto - Versão Flexível para Produção
  app.put("/produtos/:id", token.ValidateJWT, function (req, res) {
    const id_produto = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;
    const body = req.body;

    const campos = [];
    const valores = [];

    // Mapeia apenas o que foi enviado no JSON
    const colunasPermitidas = ["nome", "preco", "descricao", "url_foto", "qtd", "qtd_max", "qtd_min", "id_categoria", "unidade_medida"];
    
    Object.keys(body).forEach(chave => {
      if (colunasPermitidas.includes(chave)) {
        campos.push(`${chave} = ?`);
        // Se for preço, garante que não seja negativo
        let valor = body[chave];
        if (chave === 'preco') valor = Math.max(0, parseFloat(valor));
        valores.push(valor);
      }
    });

    if (campos.length === 0) {
      return res.status(400).json({ error: "Nenhum campo válido para atualizar" });
    }

    const ssql = `UPDATE produto SET ${campos.join(", ")} WHERE id_produto = ? AND id_estabelecimento = ?`;
    valores.push(id_produto, id_estabelecimento);

    db.query(ssql, valores, function (err, result) {
      if (err) {
        console.error("Erro ao atualizar produto:", err);
        return res.status(500).json({ error: "Erro interno no banco" });
      }
      if (result.affectedRows === 0) {
        return res.status(403).json({ error: "Produto não encontrado ou acesso negado" });
      }
      return res.status(200).json({ message: "Produto atualizado com sucesso" });
    });
});

// POST - Criar novo produto (Usado pelo Portal React e App Delphi)
app.post("/produtos", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento; // Vem do Token decodificado
    const { 
        nome, 
        preco, 
        descricao, 
        url_foto, 
        qtd, 
        qtd_max, 
        qtd_min, 
        id_categoria, 
        unidade_medida 
    } = req.body;

    // Validação de campos obrigatórios (conforme seu Delphi envia)
    if (!nome || preco === undefined || !id_categoria) {
        return res.status(400).json({ error: "Campos obrigatórios: nome, preco e id_categoria." });
    }

    // Regra: Se a unidade_medida não vier, vira 'UN'
    const unidadeFinal = unidade_medida || 'UN';

    const ssql = `
        INSERT INTO produto (
            id_categoria, 
            nome, 
            descricao, 
            preco, 
            url_foto, 
            qtd, 
            qtd_max, 
            qtd_min, 
            unidade_medida, 
            id_estabelecimento
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const valores = [
        id_categoria,
        nome,
        descricao || "",
        Math.max(0, parseFloat(preco)),
        url_foto || "",
        qtd || 0,
        qtd_max || 0,
        qtd_min || 0,
        unidadeFinal,
        id_estabelecimento
    ];

    db.query(ssql, valores, function (err, result) {
        if (err) {
            console.error("Erro no INSERT de produto:", err);
            return res.status(500).json({ error: "Erro interno no banco: " + err.message });
        }

        // Retorno 201 (Created) para o Delphi e React
        return res.status(201).json({ 
            id_produto: result.insertId, 
            message: "Produto cadastrado com sucesso!" 
        });
    });
});


  // Deletar um produto pelo id
 // Deletar um produto pelo id (com limpeza de dependências e proteção de histórico)
app.delete("/produtos/:id", token.ValidateJWT, async function (req, res) {
    const id_produto = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;

    if (!id_produto) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
    }

    try {
        // 1. Confirma se o produto pertence ao estabelecimento logado
        const prod = await executeQuery(
            "SELECT id_produto FROM produto WHERE id_produto = ? AND id_estabelecimento = ?",
            [id_produto, id_estabelecimento]
        );

        if (prod.length === 0) {
            return res.status(403).json({ error: "Produto não encontrado ou acesso negado" });
        }

        // 2. Verifica se o produto já está vinculado a algum pedido histórico
        const vendas = await executeQuery(
            "SELECT COUNT(*) AS total FROM pedido_item WHERE id_produto = ?",
            [id_produto]
        );

        if (vendas[0].total > 0) {
            return res.status(400).json({
                error: "Este produto já possui pedidos registrados e não pode ser excluído."
            });
        }

        // 3. Remove vínculos de ficha técnica e grupos de opções antes de apagar o produto
        await executeQuery("DELETE FROM produto_ficha_tecnica WHERE id_produto = ?", [id_produto]);

        await executeQuery(
            `DELETE i FROM produto_opcao_item i
             INNER JOIN produto_opcao o ON o.id_opcao = i.id_opcao
             WHERE o.id_produto = ?`,
            [id_produto]
        );
        await executeQuery("DELETE FROM produto_opcao WHERE id_produto = ?", [id_produto]);

        // 4. Agora deleta o produto com segurança
        await executeQuery(
            "DELETE FROM produto WHERE id_produto = ? AND id_estabelecimento = ?",
            [id_produto, id_estabelecimento]
        );

        return res.status(200).json({ message: "Produto deletado com sucesso" });
    } catch (err) {
        console.error("Erro ao deletar produto:", err);
        return res.status(500).json({ error: "Erro ao deletar produto: " + err.message });
    }
});



// Rota para buscar grupos e itens do cardápio
app.get("/produtos/cardapio/opcoes/:id_produto", token.ValidateJWT, function (req, res) {
    const id_produto = req.params.id_produto;
    const id_estabelecimento = req.id_estabelecimento; 

    const ssql = `
        SELECT 
            o.id_opcao,
            o.id_produto,
            o.descricao,
            o.ind_obrigatorio,
            o.qtd_max_escolha,
            o.ind_ativo,
            o.ordem AS ordem_grupo,
            i.id_item,
            i.nome_item,
            i.vl_item,
            i.ordem AS ordem_item
        FROM produto p
        INNER JOIN produto_opcao o ON o.id_produto = p.id_produto
        LEFT JOIN produto_opcao_item i ON i.id_opcao = o.id_opcao
        WHERE p.id_produto = ? 
          AND p.id_estabelecimento = ?
          AND o.ind_ativo = 'S'
        ORDER BY o.ordem, i.ordem
    `;

    db.query(ssql, [id_produto, id_estabelecimento], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Se rows estiver vazio, ele manda [] e status 200. 
        // O Delphi vai apenas ignorar e não vai estourar Exception.
        res.status(200).json(rows);
    });
});

// Rota para deletar um item específico de um grupo (Adicional)
app.delete("/produtos/opcoes/item/:id_item", token.ValidateJWT, function(req, res) {
    const id_item = req.params.id_item;
    const id_estabelecimento = req.id_estabelecimento; // Vem do Token

    // SQL com "Escalada de Segurança":
    // Só deleta o item se ele estiver ligado a uma opção que pertence ao meu estabelecimento
    const ssql = `
        DELETE i FROM produto_opcao_item i
        INNER JOIN produto_opcao o ON o.id_opcao = i.id_opcao
        INNER JOIN produto p ON p.id_produto = o.id_produto
        WHERE i.id_item = ? AND p.id_estabelecimento = ?
    `;

    db.query(ssql, [id_item, id_estabelecimento], function(error, result) {
        if (error) {
            return res.status(500).json({ error: "Erro ao deletar item", details: error.message });
        }

        // Se affectedRows for 0, o item não existe ou o usuário tentou deletar de outro restaurante
        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Permissão negada ou item não encontrado." });
        }

        res.status(200).json({ message: "Item removido!", id_item: id_item });
    });
});

  // DELETE - excluir grupo de produto
  app.delete("/produtos/opcoes/:id_opcao", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento;
    const id_opcao = req.params.id_opcao;

    // DELETE com JOIN para garantir que a opção pertence ao estabelecimento do Token
    const ssql = `
        DELETE o FROM produto_opcao o
        INNER JOIN produto p ON p.id_produto = o.id_produto
        WHERE o.id_opcao = ? AND p.id_estabelecimento = ?
    `;

    db.query(ssql, [id_opcao, id_estabelecimento], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Não permitido ou não encontrado." });
        }

        res.status(200).json({ message: "Grupo removido com sucesso!" });
    });
});

app.post("/produtos/opcoes", token.ValidateJWT, function (req, res) {
    const { id_produto, descricao, ind_obrigatorio, qtd_max_escolha, ind_ativo, ordem } = req.body;
    const id_estabelecimento = req.id_estabelecimento; // Vem do Token

    // 1. Primeiro valida se o produto é mesmo desse estabelecimento
    db.query("SELECT id_produto FROM produto WHERE id_produto = ? AND id_estabelecimento = ?", 
    [id_produto, id_estabelecimento], (err, result) => {
        if (err || result.length === 0) return res.status(403).json({ error: "Acesso negado" });

        // 2. Insere o grupo
        const sql = `INSERT INTO produto_opcao (id_produto, descricao, ind_obrigatorio, qtd_max_escolha, ind_ativo, ordem) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        
        db.query(sql, [id_produto, descricao, ind_obrigatorio, qtd_max_escolha, ind_ativo, ordem], (err2, result2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.status(201).json({ id_opcao: result2.insertId });
        });
    });
});

// NOVA ROTA NO NODE.JS PARA INSERIR ITENS
app.post("/produtos/opcoes/itens", token.ValidateJWT, function (req, res) {
    // Pegamos os nomes que o Delphi envia no JSON
    const { id_opcao, nome_item, vl_item, descricao_item, ordem } = req.body;

    // Ajustamos o SQL para as colunas REAIS da sua tabela (id_opcao, nome_item, vl_item, descricao, ordem)
    const sql = `INSERT INTO produto_opcao_item (id_opcao, nome_item, vl_item, descricao, ordem) 
                 VALUES (?, ?, ?, ?, ?)`;
    
    // Passamos os valores na ordem correta
    db.query(sql, [id_opcao, nome_item, vl_item, descricao_item || '', ordem || 0], (err, result) => {
        if (err) {
            console.log("Erro no banco:", err.message); // Isso ajuda a debugar no terminal do VS Code
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id_item: result.insertId });
    });
});

// 1. Ver os ingredientes (ficha técnica) de um produto específico
app.get('/produtos/:id_produto/ficha', token.ValidateJWT, (req, res) => {
  const { id_produto } = req.params;
  const id_estabelecimento = req.id_estabelecimento;
  const sql = `
    SELECT T.id_ficha, T.id_insumo, I.nome, I.unidade_medida, T.qtd_consumida, I.custo_unitario, I.qtd_atual
    FROM produto_ficha_tecnica T
    JOIN insumo I ON T.id_insumo = I.id_insumo
    JOIN produto P ON P.id_produto = T.id_produto
    WHERE T.id_produto = ? AND P.id_estabelecimento = ?
  `;
  
  db.query(sql, [id_produto, id_estabelecimento], (err, results) => {
    if (err) {
      console.error("Erro ao buscar ficha técnica:", err);
      return res.status(500).json({ erro: "Erro ao buscar ficha técnica" });
    }
    res.json(results);
  });
});

// 2. Adicionar um insumo na receita de um produto (Ex: X-Salada leva 100g de Frango)
app.post('/produtos/ficha', token.ValidateJWT, async (req, res) => {
    const id_estabelecimento = req.id_estabelecimento;

    const {
        id_produto,
        id_insumo,
        qtd_consumida
    } = req.body;

    if (
        !id_produto ||
        !id_insumo ||
        qtd_consumida == null ||
        isNaN(parseFloat(qtd_consumida)) ||
        parseFloat(qtd_consumida) <= 0
    ) {
        return res.status(400).json({
            erro: "Informe produto, insumo e uma quantidade consumida válida (maior que zero)"
        });
    }

    try {
        const sqlChecagem = `
            SELECT
                (
                    SELECT COUNT(*)
                    FROM produto
                    WHERE id_produto = ?
                      AND id_estabelecimento = ?
                ) AS produto_ok,

                (
                    SELECT COUNT(*)
                    FROM insumo
                    WHERE id_insumo = ?
                      AND id_estabelecimento = ?
                ) AS insumo_ok
        `;

        const check = await executeQuery(sqlChecagem, [
            id_produto,
            id_estabelecimento,
            id_insumo,
            id_estabelecimento
        ]);

        if (
            !check[0].produto_ok ||
            !check[0].insumo_ok
        ) {
            return res.status(403).json({
                erro: "Produto ou insumo não pertence a este estabelecimento"
            });
        }

        const sqlInsert = `
            INSERT INTO produto_ficha_tecnica
                (id_produto, id_insumo, qtd_consumida)
            VALUES (?, ?, ?)
        `;

        const result = await executeQuery(sqlInsert, [
            id_produto,
            id_insumo,
            Number(parseFloat(qtd_consumida).toFixed(3))
        ]);

        const estoqueReal =
            await recalcularEstoqueProduto(
                id_produto,
                id_estabelecimento
            );

        return res.status(201).json({
            sucesso: true,
            id_ficha: result.insertId,
            estoque_calculado: estoqueReal,
            mensagem: "Ingrediente vinculado ao produto com sucesso!"
        });

    } catch (err) {
        console.error(
            "❌ Erro ao adicionar ficha:",
            err
        );

        return res.status(500).json({
            erro: "Erro ao salvar ficha técnica"
        });
    }
});

// 3. Remover um ingrediente da ficha técnica
// Remover um ingrediente da ficha técnica e atualizar estoque principal
app.delete('/produtos/ficha/:id_ficha', token.ValidateJWT, async (req, res) => {
  const { id_ficha } = req.params;
  const id_estabelecimento = req.id_estabelecimento;

  try {
      // 1. Descobrir qual o produto antes de deletar (Segurança)
      const rows = await executeQuery(`
          SELECT T.id_produto FROM produto_ficha_tecnica T 
          JOIN produto P ON P.id_produto = T.id_produto
          WHERE T.id_ficha = ? AND P.id_estabelecimento = ?`, [id_ficha, id_estabelecimento]);

      if (rows.length === 0) return res.status(404).json({ erro: "Item não encontrado ou acesso negado" });

      const id_produto = rows[0].id_produto;

      // 2. Deleta o ingrediente
      await executeQuery(`DELETE FROM produto_ficha_tecnica WHERE id_ficha = ?`, [id_ficha]);

      // 3. Recalcula o estoque do produto principal (Usa a função do fim do arquivo)
      const novoEstoque = await recalcularEstoqueProduto(id_produto, id_estabelecimento);

      res.json({ sucesso: true, id_produto, qtd: novoEstoque, mensagem: "Ingrediente removido e estoque atualizado!" });
  } catch (err) {
      console.error("Erro ao remover item da ficha:", err);
      res.status(500).json({ erro: "Erro ao processar exclusão" });
  }
});

app.get("/pedidos/completo/:id_pedido", token.ValidateJWT, async function (request, response) {
    const id_estabelecimento = request.id_estabelecimento;
    const id_pedido = request.params.id_pedido;

    try {
        await recalcularSaldoPedido(id_pedido, id_estabelecimento);

        const sqlPedido = `
            SELECT 
                p.id_pedido,
                DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i:%s') AS dt_pedido,
                p.status,
                p.nome_cliente,
                p.observacao,
                p.forma_pagamento,
                p.numero_mesa,
                p.numero_pessoas,
                p.vl_subtotal,
                p.vl_entrega,
                p.dinheiro,
                p.troco,
                p.local_consumo,
                p.endereco_entrega,
                u.nome AS nome_login,
                p.rota,
                p.vl_total,
                COALESCE((SELECT SUM(d.valor_pago) FROM divisao_pagamento d WHERE d.id_pedido = p.id_pedido), 0) AS vl_pago,
                COALESCE(p.vl_falta, p.vl_total) AS vl_falta
            FROM pedido p
            LEFT JOIN usuario u ON u.id_usuario = p.id_usuario
            WHERE p.id_pedido = ? AND p.id_estabelecimento = ?
        `;

        const sqlItens = `
            SELECT 
                p.id_pedido,
                p.numero_mesa,
                p.nome_cliente,
                p.numero_pessoas,
                i.id_item,
                o.nome AS nome_produto,
                o.url_foto,
                i.qtd,
                i.vl_unitario,
                i.vl_total,
                i.observacao
            FROM pedido_item i
            JOIN pedido p ON i.id_pedido = p.id_pedido
            JOIN produto o ON o.id_produto = i.id_produto
            WHERE i.id_pedido = ? AND p.id_estabelecimento = ?
        `;

        const sqlPagamentos = `
            SELECT 
                d.id_divisao,
                d.id_pedido,
                d.id_usuario,
                COALESCE(u.nome, '') AS nome_usuario,
                d.valor_pago,
                d.forma_pagamento,
                COALESCE(d.observacao, '') AS observacao,
                DATE_FORMAT(d.dt_pagamento, '%d/%m/%Y %H:%i:%s') AS dt_pagamento
            FROM divisao_pagamento d
            LEFT JOIN usuario u ON u.id_usuario = d.id_usuario
            WHERE d.id_pedido = ?
            ORDER BY d.id_divisao ASC
        `;

        const resPedido = await executeQuery(sqlPedido, [id_pedido, id_estabelecimento]);
        if (resPedido.length === 0) {
            return response.status(404).json({ error: "Pedido não encontrado" });
        }

        const [resItens, resPagamentos] = await Promise.all([
            executeQuery(sqlItens, [id_pedido, id_estabelecimento]),
            executeQuery(sqlPagamentos, [id_pedido])
        ]);

        return response.status(200).json({
            pedido: resPedido[0],
            itens: resItens,
            pagamentos: resPagamentos
        });
    } catch (err) {
        console.error("Erro em /pedidos/completo:", err);
        return response.status(500).json({ error: err.message });
    }
});

// 1. Listar todos os insumos do estabelecimento logado
app.get('/insumos', token.ValidateJWT, (req, res) => {
  const id_estabelecimento = req.id_estabelecimento;
  const sql = "SELECT * FROM insumo WHERE id_estabelecimento = ? ORDER BY nome ASC";
  
  db.query(sql, [id_estabelecimento], (err, results) => {
    if (err) {
      console.error("Erro ao buscar insumos:", err);
      return res.status(500).json({ erro: "Erro ao buscar insumos" });
    }
    res.json(results);
  });
});

// 2. Cadastrar um novo insumo (ex: Farinha de Trigo, Kg, etc.)
app.post('/insumos', token.ValidateJWT, (req, res) => {
  const id_estabelecimento = req.id_estabelecimento;
  const { nome, unidade_medida, qtd_atual, qtd_minima, custo_unitario } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: "O nome do insumo é obrigatório" });
  }

  const UNIDADES_VALIDAS = ["UN", "KG", "G", "L", "ML"];
  const unidadeSegura = UNIDADES_VALIDAS.includes(unidade_medida) ? unidade_medida : "UN";
  
  const sql = `
    INSERT INTO insumo (id_estabelecimento, nome, unidade_medida, qtd_atual, qtd_minima, custo_unitario) 
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  db.query(sql, [id_estabelecimento, nome, unidadeSegura, qtd_atual || 0, qtd_minima || 0, custo_unitario || 0], (err, result) => {
    if (err) {
      console.error("Erro ao cadastrar insumo:", err);
      return res.status(500).json({ erro: "Erro ao cadastrar insumo" });
    }
    res.json({ sucesso: true, id_insumo: result.insertId, mensagem: "Insumo cadastrado com sucesso!" });
  });
});



app.put("/pedidos/atualizar_valor_total/:id_pedido", token.ValidateJWT, async function (request, response) {
    const idPedido = request.params.id_pedido;
    const id_estabelecimento = request.id_estabelecimento;

    try {
        await executeQuery(
            `UPDATE pedido 
             SET vl_total = (
                 SELECT COALESCE(SUM(vl_total), 0) + vl_entrega 
                 FROM pedido_item 
                 WHERE id_pedido = ?
             ) 
             WHERE id_pedido = ? AND id_estabelecimento = ?`,
            [idPedido, idPedido, id_estabelecimento]
        );

        const saldo = await recalcularSaldoPedido(idPedido, id_estabelecimento);

        return response.status(200).json({
            message: "Valor total atualizado com sucesso",
            id_pedido: idPedido,
            ...saldo
        });
    } catch (err) {
        console.error("Erro ao atualizar valor total:", err);
        return response.status(500).send(err);
    }
});

// Endpoint para validar a existência do pedido antes de processar a notificação
app.get("/pedido/check/:id_pedido", token.ValidateJWT, function (req, res) {
    const id_pedido = req.params.id_pedido;
    const id_estabelecimento = req.id_estabelecimento;

    // Busca apenas o ID para confirmar que ele existe e pertence ao estabelecimento
    const ssql = "SELECT id_pedido FROM pedido WHERE id_pedido = ? AND id_estabelecimento = ?";

    db.query(ssql, [id_pedido, id_estabelecimento], function (err, result) {
        if (err) return res.status(500).json({ error: err.message });

        if (result.length > 0) {
            return res.status(200).json({ status: "existe" });
        } else {
            return res.status(404).json({ status: "nao_encontrado" });
        }
    });
});

 app.get("/pedidos", token.ValidateJWT, function (request, response) {
    const id_est = request.id_estabelecimento; 
    const { data } = request.query;

    let params = [id_est];
    let filtro_data = "";

    if (data) {
        // Mudou de '=' para '>=' para pegar a partir da data informada (ontem e hoje)
        filtro_data = " AND DATE(p.dt_pedido) >= ? ";
        params.push(data);
    }

    let ssql = "select p.id_pedido, p.status, date_format(p.dt_pedido, '%d/%m/%Y %H:%i:%s') as dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.forma_pagamento, p.vl_total, ";
    ssql += "p.numero_mesa, p.numero_pessoas, p.local_consumo, ";
    ssql += "count(i.id_item) as qtd_item, p.nome_cliente ";
    ssql += "from pedido p ";
    ssql += "left join pedido_item i on i.id_pedido = p.id_pedido ";
    ssql += "where p.id_estabelecimento = ? " + filtro_data; 
    ssql += "group by p.id_pedido, p.status, p.forma_pagamento, p.dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.vl_total, p.nome_cliente, ";
    ssql += "p.numero_mesa, p.numero_pessoas, p.local_consumo ";
    ssql += "order by p.id_pedido desc ";

    db.query(ssql, params, function (err, result) {
        if (err) {
            console.error("Erro ao listar pedidos:", err);
            return response.status(500).json({ error: "Erro interno no servidor." });
        }
        return response.status(200).json(result);
    });
});


  // 1. ADICIONADO: token.ValidateJWT para segurança
app.get("/pedidos/itens", token.ValidateJWT, function (request, response) {
      
      // 2. ADICIONADO: Pegar o ID da empresa que vem do Token decodificado
      const id_estabelecimento = request.id_estabelecimento;

      let ssql = `
          SELECT 
              p.id_pedido,
              DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i:%s') AS dt_pedido,
              p.status,
              p.nome_cliente,
              p.forma_pagamento,
              p.vl_entrega,
              p.endereco_entrega,
              p.rota,
              u.nome AS nome_login,
              i.id_item,
              o.nome AS nome_produto,
              o.url_foto,
              i.vl_unitario,
              i.qtd,
              i.vl_total AS vl_total_item,
              i.observacao AS obs_item,
              p.vl_total,
              c.descricao AS categoria,
              c.url_icone AS categoria_icone
          FROM pedido p
          LEFT JOIN usuario u ON u.id_usuario = p.id_usuario
          JOIN pedido_item i ON i.id_pedido = p.id_pedido
          JOIN produto o ON o.id_produto = i.id_produto
          LEFT JOIN produto_categoria c ON c.id_categoria = o.id_categoria
          WHERE p.id_estabelecimento = ? 
          ORDER BY p.dt_pedido
      `;

      // 3. ALTERADO: Passando o parâmetro id_estabelecimento para a query
      db.query(ssql, [id_estabelecimento], function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              let id_pedidos = [];
              let pedidos = [];

              // Criar a lista de pedidos sem duplicação
              result.forEach((ped) => {
                  if (!id_pedidos.includes(ped.id_pedido)) {
                      id_pedidos.push(ped.id_pedido);

                      pedidos.push({
                          id_pedido: ped.id_pedido,
                          dt_pedido: ped.dt_pedido,
                          status: ped.status,
                          nome_cliente: ped.nome_cliente,
                          forma_pagamento: ped.forma_pagamento,
                          vl_entrega: ped.vl_entrega ?? null,
                          endereco_entrega: ped.endereco_entrega ?? null,
                          rota: ped.rota ?? null,
                          nome_login: ped.nome_login,
                          vl_total: ped.vl_total,
                          itens: []
                      });
                  }
              });

              // Adicionar os itens em cada pedido
              pedidos.forEach((ped) => {
                  let itens = [];
                  result.forEach((pedResult) => {
                      if (pedResult.id_pedido == ped.id_pedido) {
                          itens.push({
                              id_item: pedResult.id_item,
                              nome_produto: pedResult.nome_produto,
                              url_foto: pedResult.url_foto,
                              qtd: pedResult.qtd,
                              vl_unitario: pedResult.vl_unitario,
                              vl_total: pedResult.vl_total_item,
                              observacao: pedResult.obs_item ?? null,
                              categoria: pedResult.categoria ?? 'Sem Categoria',
                              categoria_icone: pedResult.categoria_icone ?? null
                          });
                      }
                  });
                  ped.itens = itens;
              });

              return response.status(200).json(pedidos);
          }
      });
});


 app.get("/pedidos/resumo", token.ValidateJWT, function (request, response) {
      const id_estabelecimento = request.id_estabelecimento;

      let ssql = `
          SELECT 
              p.id_pedido,
              DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i:%s') AS dt_pedido,
              p.status,
              p.nome_cliente,
              p.observacao,
              p.forma_pagamento,
              p.vl_entrega,
              p.dinheiro,
              p.troco,
              p.local_consumo,
              p.endereco_entrega,
              u.nome AS nome_login,
              p.rota,
              p.vl_total
          FROM pedido p
          LEFT JOIN usuario u ON u.id_usuario = p.id_usuario
          WHERE p.id_estabelecimento = ?
          ORDER BY p.dt_pedido
      `;

      db.query(ssql, [id_estabelecimento], function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              return response.status(200).json(result);
          }
      });
});

app.get('/pedidos/historico/:slug/:session_id', (req, res) => {
    const { slug, session_id } = req.params;

    const ssql = `
        SELECT 
            p.id_pedido,
            p.nome_cliente,
            p.status,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i') AS dt_pedido,
            p.vl_total,
            p.forma_pagamento
        FROM pedido p
        JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
        WHERE e.slug = ? AND p.session_id = ?
        ORDER BY p.id_pedido DESC
    `;

    db.query(ssql, [slug, session_id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });
});

app.get('/pedidos/acompanhar/:id_pedido', (req, res) => {
    const idPedido = req.params.id_pedido;

    const ssql = `
        SELECT 
            p.id_pedido, p.nome_cliente, p.status,
            p.vl_subtotal, p.vl_entrega, p.vl_total,
            p.endereco_entrega, p.forma_pagamento,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i') AS dt_pedido
        FROM pedido p
        WHERE p.id_pedido = ?
    `;

    db.query(ssql, [idPedido], (err, result) => {
        if (err || result.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });

        const pedido = result[0];

        const ssqlItens = `
            SELECT i.qtd, pr.nome AS nome_produto, i.vl_total
            FROM pedido_item i
            JOIN produto pr ON pr.id_produto = i.id_produto
            WHERE i.id_pedido = ?
        `;

        db.query(ssqlItens, [idPedido], (err2, itens) => {
            res.status(200).json({ ...pedido, itens });
        });
    });
});

  app.put('/usuarios/:id', token.ValidateJWT, (req, res) => {
    const { nome, email, tipo, senha, status, latitude, longitude } = req.body;
    const { id } = req.params;
    const id_estabelecimento = req.id_estabelecimento;

    // 🛵 Se for o Motoboy atualizando localização/status (sem nome nem email):
    if (latitude !== undefined || longitude !== undefined || (status && !nome)) {
        const sqlGps = `
            UPDATE usuario 
            SET latitude = COALESCE(?, latitude), 
                longitude = COALESCE(?, longitude) 
            WHERE id_usuario = ?
        `;
        db.query(sqlGps, [latitude || null, longitude || null, id], (err) => {
            if (err) {
                console.error("Erro ao atualizar GPS do motoboy:", err);
                return res.status(500).json({ error: err.message });
            }
            return res.status(200).json({ message: "Status e localização atualizados com sucesso!" });
        });
        return; // Encerra aqui sem pedir nome, email ou tipo!
    }

    // 🖥️ Se for a edição de perfil do painel desktop (onde nome e email são obrigatórios):
    if (!nome || !email || !tipo) {
        return res.status(400).json({ error: 'Nome, E-mail e Tipo são obrigatórios!' });
    }

    let sql;
    let params;

    if (senha && senha.trim() !== '') {
        sql = `UPDATE usuario SET nome=?, email=?, senha=?, tipo=? 
               WHERE id_usuario = ? AND id_estabelecimento = ?`;
        params = [nome, email, tipo, senha, id, id_estabelecimento];
    } else {
        sql = `UPDATE usuario SET nome=?, email=?, tipo=? 
               WHERE id_usuario = ? AND id_estabelecimento = ?`;
        params = [nome, email, tipo, id, id_estabelecimento];
    }

    db.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ error: 'Erro no banco: ' + err.message });
        res.status(200).json({ message: 'Perfil atualizado com sucesso!' });
    });
});


 app.get("/pedidos/itens_lista", token.ValidateJWT, function (request, response) {
    let ssql = `
        SELECT 
            p.id_pedido,
            p.numero_mesa,
            p.nome_cliente,
            p.numero_pessoas,
            i.id_item,
            o.nome AS nome_produto,
            o.url_foto,
            i.qtd,
            i.vl_unitario,
            i.vl_total,
            i.observacao
        FROM pedido p
        JOIN pedido_item i ON i.id_pedido = p.id_pedido
        JOIN produto o ON o.id_produto = i.id_produto
        ORDER BY p.dt_pedido, i.id_item
    `;

    db.query(ssql, (err, results) => {
        if (err) {
            return response.status(500).json({ error: err.message });
        }
        const itens = results.map(r => ({
            ...r,
            qtd: parseInt(r.qtd, 10) || 0,
            vl_unitario: parseFloat(r.vl_unitario) || 0,
            vl_total: parseFloat(r.vl_total) || 0
        }));
        response.json(itens);
    });
});


  // GET /categorias - Listar categorias do estabelecimento logado
app.get('/categorias', token.ValidateJWT, (req, response) => {
    // Pegamos o ID direto do Token decodificado (injetado pelo seu middleware)
    const id_estabelecimento = req.id_estabelecimento;

    if (!id_estabelecimento) {
        return response.status(400).json({ error: "Estabelecimento não identificado no token." });
    }

    let ssql = "SELECT id_categoria, descricao, ordem, url_icone ";
    ssql += "FROM produto_categoria ";
    ssql += "WHERE id_estabelecimento = ? "; 
    ssql += "ORDER BY ordem";

    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) {
            console.error("Erro ao buscar categorias:", err);
            return response.status(500).json({ error: "Erro interno no servidor" });
        }
        return response.status(200).json(result);
    });
});

// POST /categorias - Cadastrar nova categoria
app.post('/categorias', token.ValidateJWT, (req, res) => {
    const id_estabelecimento = req.id_estabelecimento;
    const { descricao, ordem, url_icone } = req.body;

    if (!descricao || ordem == null || !url_icone) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando: descricao, ordem, url_icone' });
    }

    const ssql = 'INSERT INTO produto_categoria (descricao, ordem, url_icone, id_estabelecimento) VALUES (?, ?, ?, ?)';
    
    db.query(ssql, [descricao, ordem, url_icone, id_estabelecimento], (err, result) => {
        if (err) {
            console.error("Erro ao cadastrar categoria:", err);
            return res.status(500).json({ error: "Erro ao cadastrar categoria" });
        }
        return res.status(201).json({
            id_categoria: result.insertId,
            message: 'Categoria cadastrada com sucesso'
        });
    });
});

// PUT /categorias/:id - Atualizar categoria com trava de segurança
app.put('/categorias/:id', token.ValidateJWT, (req, res) => {
    const id_categoria = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;
    const { descricao, ordem, url_icone } = req.body;

    if (!descricao || ordem == null || !url_icone) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const ssql = `
        UPDATE produto_categoria 
        SET descricao = ?, ordem = ?, url_icone = ? 
        WHERE id_categoria = ? AND id_estabelecimento = ?
    `;

    db.query(ssql, [descricao, ordem, url_icone, id_categoria, id_estabelecimento], (err, result) => {
        if (err) {
            console.error("Erro ao atualizar categoria:", err);
            return res.status(500).json({ error: "Erro ao atualizar categoria" });
        }
        
        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Categoria não encontrada ou acesso negado" });
        }

        return res.status(200).json({ message: 'Categoria atualizada com sucesso' });
    });
});

// DELETE /categorias/:id - Apagar categoria com trava de segurança
app.delete('/categorias/:id', token.ValidateJWT, (req, res) => {
    const id_categoria = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;

    const ssql = 'DELETE FROM produto_categoria WHERE id_categoria = ? AND id_estabelecimento = ?';
    
    db.query(ssql, [id_categoria, id_estabelecimento], (err, result) => {
        if (err) {
            console.error("Erro ao deletar categoria:", err);
            return res.status(500).json({ error: "Erro ao deletar categoria" });
        }

        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Categoria não encontrada ou acesso negado" });
        }

        return res.status(200).json({ message: 'Categoria deletada com sucesso' });
    });
});



  app.delete("/pedidos/:id_pedido", token.ValidateJWT, async function (request, response) {
    const idPedido = request.params.id_pedido;
    const id_estabelecimento = request.id_estabelecimento;

    try {
        await executeQuery("DELETE FROM divisao_pagamento WHERE id_pedido = ?", [idPedido]);
        await executeQuery("DELETE FROM pedido_item WHERE id_pedido = ?", [idPedido]);
        await executeQuery("DELETE FROM pedido WHERE id_pedido = ? AND id_estabelecimento = ?", [idPedido, id_estabelecimento]);

        return response.status(200).json({
            message: "Pedido deletado com sucesso",
            id_pedido: idPedido
        });
    } catch (err) {
        return response.status(500).json({ error: err.message });
    }
});

  app.put("/pedidos/numero_pessoas/:id_pedido", token.ValidateJWT, function (request, response) {

      // URL exemplo:
      // http://localhost:3000/pedidos/numero_pessoas/1000
      // no body: { "numero_pessoas": 3 }

      const numeroPessoas = request.body.numero_pessoas;
      const idPedido = request.params.id_pedido;

      if (typeof numeroPessoas !== 'number' || numeroPessoas < 1) {
          return response.status(400).json({ error: "Número de pessoas inválido." });
      }

      let ssql = "UPDATE pedido SET numero_pessoas = ? WHERE id_pedido = ?";

      db.query(ssql, [numeroPessoas, idPedido], function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              return response.status(200).json({ id_pedido: idPedido, numero_pessoas: numeroPessoas });
          }
      });

  });

  app.put("/pedidos/forma_pagamento/:id_pedido", token.ValidateJWT, function (request, response) {

    // URL exemplo:
    // http://localhost:3000/pedidos/forma_pagamento/1000
    // no body: { "forma_pagamento": "Dinheiro" }

    const formaPagamento = request.body.forma_pagamento;
    const idPedido = request.params.id_pedido;

    if (typeof formaPagamento !== 'string' || formaPagamento.trim() === '') {
        return response.status(400).json({ error: "Forma de pagamento inválida." });
    }

    let ssql = "UPDATE pedido SET forma_pagamento = ? WHERE id_pedido = ?";

    db.query(ssql, [formaPagamento, idPedido], function (err, result) {
        if (err) {
            return response.status(500).send(err);
        } else {
            return response.status(200).json({ id_pedido: idPedido, forma_pagamento: formaPagamento });
        }
    });

});


  app.put("/pedidos/endereco/:id_pedido", token.ValidateJWT, function (request, response) {

      const enderecoEntrega = request.body.endereco_entrega;
      const rota = request.body.rota || null; // pode vir vazio ou null
      const idPedido = parseInt(request.params.id_pedido, 10);

      if (!enderecoEntrega || enderecoEntrega.trim() === "") {
          return response.status(400).json({ error: "Endereço de entrega inválido." });
      }

      let ssql = "UPDATE pedido SET endereco_entrega = ?, rota = ? WHERE id_pedido = ?";

      db.query(ssql, [enderecoEntrega, rota, idPedido], function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else if (result.affectedRows === 0) {
              return response.status(404).json({ 
                  error: "Pedido não encontrado." 
              });
          } else {
              return response.status(200).json({ 
                  id_pedido: idPedido, 
                  endereco_entrega: enderecoEntrega,
                  rota: rota
              });
          }
      });

  });


  app.delete("/pedidos/itens/:id_item", function (request, response) {

      // Exemplo: DELETE http://localhost:3000/pedidos/itens/500

      let ssql = "DELETE FROM pedido_item WHERE id_item = ?";

      db.query(ssql, [request.params.id_item], function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              return response.status(200).json({ id_item: request.params.id_item });
          }
      });

  });

  // 1) GET: Lista totais + pagamentos parciais já lançados na mesa/pedido
app.get("/pedidos/:id_pedido/pagamentos", token.ValidateJWT, async (req, res) => {
    const { id_pedido } = req.params;
    const id_estabelecimento = req.id_estabelecimento;

    try {
        const resumo = await recalcularSaldoPedido(id_pedido, id_estabelecimento);
        if (!resumo) {
            return res.status(404).json({ error: "Pedido não encontrado." });
        }

        const pagamentos = await executeQuery(
            `SELECT 
                d.id_divisao,
                d.id_pedido,
                d.id_usuario,
                COALESCE(u.nome, '') AS nome_usuario,
                d.valor_pago,
                d.forma_pagamento,
                COALESCE(d.observacao, '') AS observacao,
                DATE_FORMAT(d.dt_pagamento, '%d/%m/%Y %H:%i:%s') AS dt_pagamento
             FROM divisao_pagamento d
             LEFT JOIN usuario u ON u.id_usuario = d.id_usuario
             WHERE d.id_pedido = ?
             ORDER BY d.id_divisao ASC`,
            [id_pedido]
        );

        return res.status(200).json({
            id_pedido: Number(id_pedido),
            vl_total: resumo.vl_total,
            vl_pago: resumo.vl_pago,
            vl_falta: resumo.vl_falta,
            status: resumo.status,
            pagamentos: pagamentos.map(p => ({
                ...p,
                valor_pago: Number(p.valor_pago) || 0
            }))
        });
    } catch (err) {
        console.error("Erro ao buscar pagamentos do pedido:", err);
        return res.status(500).json({ error: err.message });
    }
});

// 2) POST: Lança 1 pagamento parcial OU vários de uma vez ({ pagamentos: [...] })
app.post("/pedidos/:id_pedido/pagamentos", token.ValidateJWT, async (req, res) => {
    const { id_pedido } = req.params;
    const id_estabelecimento = req.id_estabelecimento;
    const { valor_pago, forma_pagamento, observacao, id_usuario, pagamentos } = req.body;

    // Aceita tanto um array { pagamentos: [...] } quanto um pagamento único { valor_pago, forma_pagamento, observacao }
    const lista = Array.isArray(pagamentos) && pagamentos.length > 0
        ? pagamentos
        : [{ valor_pago, forma_pagamento, observacao, id_usuario }];

    for (const item of lista) {
        if (!Number(item.valor_pago) || Number(item.valor_pago) <= 0) {
            return res.status(400).json({ error: "Todos os pagamentos precisam ter valor_pago maior que zero." });
        }
        if (!item.forma_pagamento || String(item.forma_pagamento).trim() === "") {
            return res.status(400).json({ error: "Todos os pagamentos precisam ter forma_pagamento." });
        }
    }

    const totalLancado = lista.reduce((acc, item) => acc + Number(item.valor_pago), 0);

    try {
        const saldoAtual = await recalcularSaldoPedido(id_pedido, id_estabelecimento);
        if (!saldoAtual) {
            return res.status(404).json({ error: "Pedido não encontrado." });
        }
        if (saldoAtual.status === 'C') {
            return res.status(400).json({ error: "Pedido cancelado não pode receber pagamento." });
        }
        if (totalLancado > saldoAtual.vl_falta + 0.01) {
            return res.status(400).json({
                error: `Total informado (R$ ${totalLancado.toFixed(2)}) é maior que o saldo restante (Falta: R$ ${saldoAtual.vl_falta.toFixed(2)}).`
            });
        }

        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const dtPagamento = agora.toISOString().slice(0, 19).replace('T', ' ');

        const valoresInsert = lista.map(item => [
            id_pedido,
            item.id_usuario || req.id_usuario || null,
            Number(Number(item.valor_pago).toFixed(2)),
            String(item.forma_pagamento).trim(),
            item.observacao ? String(item.observacao).trim() : null,
            dtPagamento
        ]);

        const insertRes = await executeQuery(
            `INSERT INTO divisao_pagamento (id_pedido, id_usuario, valor_pago, forma_pagamento, observacao, dt_pagamento) VALUES ?`,
            [valoresInsert]
        );

        const novoSaldo = await recalcularSaldoPedido(id_pedido, id_estabelecimento);

        return res.status(201).json({
            sucesso: true,
            id_divisao: insertRes.insertId,
            vl_total: novoSaldo.vl_total,
            vl_pago: novoSaldo.vl_pago,
            vl_falta: novoSaldo.vl_falta,
            quitado: novoSaldo.vl_falta <= 0
        });
    } catch (err) {
        console.error("Erro ao registrar pagamento:", err);
        return res.status(500).json({ error: err.message });
    }
});

// 3) DELETE: Estorna/apaga um pagamento da divisao_pagamento e recalcula vl_falta
app.delete("/pedidos/:id_pedido/pagamentos/:id_divisao", token.ValidateJWT, async (req, res) => {
    const { id_pedido, id_divisao } = req.params;
    const id_estabelecimento = req.id_estabelecimento;

    try {
        const result = await executeQuery(
            `DELETE d FROM divisao_pagamento d
             INNER JOIN pedido p ON p.id_pedido = d.id_pedido
             WHERE d.id_divisao = ? AND d.id_pedido = ? AND p.id_estabelecimento = ?`,
            [id_divisao, id_pedido, id_estabelecimento]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Pagamento não encontrado." });
        }

        const novoSaldo = await recalcularSaldoPedido(id_pedido, id_estabelecimento);

        return res.status(200).json({
            sucesso: true,
            vl_total: novoSaldo.vl_total,
            vl_pago: novoSaldo.vl_pago,
            vl_falta: novoSaldo.vl_falta,
            quitado: novoSaldo.vl_falta <= 0
        });
    } catch (err) {
        console.error("Erro ao remover pagamento:", err);
        return res.status(500).json({ error: err.message });
    }
});

  app.get("/configs", function (request, response) {

      let ssql = "select * from config ";

      db.query(ssql, function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              return response.status(200).json(result[0]);
          }
      });

  });

  app.get("/usuarios/:id_usuario", token.ValidateJWT, (req, res) => {
    // O id_usuario vem da URL (params)
    const id_usuario = req.params.id_usuario;
    
    // IMPORTANTE: Pegamos o id do estabelecimento que o ValidateJWT injetou no req
    const id_estabelecimento = req.id_estabelecimento;

    // Filtramos pelo ID do usuário E pelo estabelecimento para garantir segurança total
    const sql = `
        SELECT id_usuario, nome, email, status, dt_cadastro 
        FROM usuario 
        WHERE id_usuario = ? AND id_estabelecimento = ?
    `;

    db.query(sql, [id_usuario, id_estabelecimento], (err, result) => {
        if (err) {
            console.error("Erro ao buscar usuário:", err);
            return res.status(500).json({ error: 'Erro no banco de dados' });
        }

        if (result.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado ou acesso negado' });
        }

        // Retorna o primeiro registro encontrado
        res.json(result[0]);
    });
});

// Rota exclusiva para o Dashboard React buscar os dados e horários da loja logada
app.get("/dashboard/estabelecimento", token.ValidateJWT, function (request, response) {
    const id_estabelecimento = request.id_estabelecimento;

    const ssql = `
        SELECT nome AS nome_empresa, rua, numero, cidade, estado, cep, logo AS logo_empresa,
               horario_abertura, horario_fechamento
        FROM estabelecimento
        WHERE id_estabelecimento = ?
    `;

    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) return response.status(500).json({ error: err.message });
        if (result.length === 0) return response.status(404).json({ error: "Estabelecimento não encontrado" });
        return response.status(200).json(result[0]);
    });
});

  // Rota para buscar a forma de pagamento de um pedido
app.get("/pedidos/:id_pedido", (req, res) => {
  const id_pedido = req.params.id_pedido;

  const sql = `
    SELECT forma_pagamento
    FROM pedido
    WHERE id_pedido = ?
  `;

  db.query(sql, [id_pedido], (err, result) => {
    if (err) {
      console.error('Erro no banco de dados:', err);
      return res.status(500).json({ error: 'Erro no banco de dados' });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    // Retorna só a forma de pagamento
    res.json({ forma_pagamento: result[0].forma_pagamento });
  });
});


app.post('/usuarios', (req, res) => {
    // Pegamos os dados do corpo da requisição
    const { nome, email, senha, id_estabelecimento, tipo } = req.body;

    // Validação básica
    if (!nome || !email || !senha || !id_estabelecimento) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    // O 'tipo' aqui é opcional, se não vier, vira 'padrao'
    const tipoFinal = tipo || 'padrao';

    const sql = `
        INSERT INTO usuario (nome, email, senha, dt_cadastro, status, id_estabelecimento, tipo) 
        VALUES (?, ?, ?, NOW(), 'A', ?, ?)
    `;

    db.query(sql, [nome, email, senha, id_estabelecimento, tipoFinal], (err, result) => {
        if (err) {
            console.error("Erro ao cadastrar usuário:", err);
            return res.status(500).json({ error: 'Erro ao cadastrar usuário' });
        }
        
        // Retornamos os dados criados (menos a senha por segurança)
        res.status(201).json({ 
            id_usuario: result.insertId, 
            nome, 
            email, 
            tipo: tipoFinal,
            id_estabelecimento 
        });
    });
});

 app.post("/login", function (req, res) {
    const { email, senha } = req.body;

    if (!email || !senha)
        return res.status(400).json({ error: "Email e senha obrigatórios" });

    const ssql = `
        SELECT
            u.id_usuario,
            u.nome,
            u.email,
            u.senha,
            u.tipo,
            u.funcao,
            u.status,
            u.placa,
            u.id_estabelecimento,
            e.nome AS nome_estabelecimento,
            u.dt_cadastro,
            e.logo AS url_logo,
            e.qtd_mesas
        FROM usuario u
        LEFT JOIN estabelecimento e
            ON e.id_estabelecimento = u.id_estabelecimento
        WHERE u.email = ?
    `;

    db.query(ssql, [email], function (err, result) {
        if (err) {
            console.error("Erro SQL /login:", err);
            return res.status(500).json({ error: "Erro no banco" });
        }

        if (result.length > 0) {
            const usuario = result[0];

            if (senha === usuario.senha) {
                const token = jwt.sign(
                    {
                        id_usuario: usuario.id_usuario,
                        nome: usuario.nome,
                        tipo: usuario.tipo,
                        funcao: usuario.funcao || "geral",
                        id_estabelecimento: usuario.id_estabelecimento,
                        qtd_mesas: usuario.qtd_mesas
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: "30d" }
                );

                return res.status(200).json({
                    id_usuario: usuario.id_usuario,
                    id_motorista: usuario.id_usuario,
                    nome: usuario.nome,
                    email: usuario.email,
                    tipo: usuario.tipo,
                    funcao: usuario.funcao || "geral",
                    status: usuario.status,
                    placa: usuario.placa || "",
                    id_estabelecimento: usuario.id_estabelecimento,
                    nome_estabelecimento: usuario.nome_estabelecimento,
                    dt_cadastro: usuario.dt_cadastro,
                    url_logo: usuario.url_logo,
                    qtd_mesas: usuario.qtd_mesas,
                    token: token
                });
            } else {
                return res.status(401).json({ error: "Senha incorreta" });
            }
        } else {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }
    });
});


// versao 2

// --- HISTÓRICO: ÚLTIMOS 3 DIAS COM LIMITE ---
app.get("/corridas", token.ValidateJWT, async function (req, res) {
    let placa = req.query.placa || req.headers['placa'];

    if (!placa && req.id_usuario) {
        try {
            const rows = await executeQuery("SELECT placa FROM usuario WHERE id_usuario = ?", [req.id_usuario]);
            if (rows.length > 0 && rows[0].placa) {
                placa = rows[0].placa;
            }
        } catch (e) {
            console.error("Erro ao buscar placa:", e);
        }
    }

    if (!placa) {
        return res.status(400).json({ error: "Este motorista não possui placa cadastrada no sistema." });
    }

    // 🔒 Filtra apenas os últimos 3 dias e limita aos 50 mais recentes
    const ssql = `
        SELECT 
            p.id_pedido,
            p.id_pedido AS id_corrida,
            p.nome_cliente,
            p.nome_cliente AS nome,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i') AS dt_pedido,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i') AS dt_cadastro,
            COALESCE(e.nome, 'Lanchonete') AS nome_estabelecimento,
            COALESCE(e.nome, 'Lanchonete') AS origem,
            COALESCE(p.endereco_entrega, 'Retirada no local') AS endereco_entrega,
            COALESCE(p.endereco_entrega, 'Retirada no local') AS destino,
            p.vl_entrega,
            p.vl_entrega AS vl_corrida,
            p.vl_total,
            p.status,
            p.forma_pagamento
        FROM pedido p
        LEFT JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
        WHERE p.status = 'F' 
          AND p.placa = ?
          AND p.dt_pedido >= DATE_SUB(NOW(), INTERVAL 3 DAY)
        ORDER BY p.dt_pedido DESC
        LIMIT 50
    `;

    db.query(ssql, [placa], function (err, result) {
        if (err) {
            console.error("Erro ao listar histórico:", err);
            return res.status(500).json({ error: err.message });
        }
        return res.status(200).json(result);
    });
});

// --- 1. ATUALIZAR STATUS E LOCALIZAÇÃO GPS DO MOTOBOY ---
app.put("/motoristas/status", token.ValidateJWT, function (req, res) {
    const { status, latitude, longitude } = req.body;
    const id_usuario = req.id_usuario;

    if (!id_usuario) {
        return res.status(400).json({ error: "Usuário não identificado no token." });
    }

    // Atualiza na tabela motorista vinculada ao id_usuario
    const ssql = `
        UPDATE motorista 
        SET status_trabalho = COALESCE(?, status_trabalho), 
            latitude = COALESCE(?, latitude), 
            longitude = COALESCE(?, longitude)
        WHERE id_usuario = ?
    `;

    db.query(ssql, [status || 'online', latitude || null, longitude || null, id_usuario], (err, result) => {
        if (err) {
            console.error("Erro ao atualizar status do motorista:", err);
            return res.status(500).json({ error: err.message });
        }
        return res.status(200).json({ message: "Status e localização atualizados com sucesso!" });
    });
});

// --- 2. BUSCAR ENTREGAS DISPONÍVEIS (O app chama a cada poucos segundos quando está Online) ---
app.get("/corridas/ofertas", token.ValidateJWT, function (req, res) {
    // Busca pedidos que estão em produção ou prontos para entrega, sem motoboy atribuído
    const ssql = `
        SELECT 
            p.id_pedido AS id_corrida,
            p.id_pedido AS id_fila,
            p.nome_cliente AS nome,
            COALESCE(e.nome, 'Lanchonete') AS origem,
            COALESCE(p.endereco_entrega, 'Endereço não informado') AS destino,
            COALESCE(p.nome_cliente, '') AS whatsapp,
            p.vl_entrega AS vl_corrida
        FROM pedido p
        LEFT JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
        WHERE p.status IN ('P', 'E') 
          AND (p.placa IS NULL OR p.placa = '')
          AND p.local_consumo = 'DELIVERY'
        ORDER BY p.id_pedido ASC
        LIMIT 1
    `;

    db.query(ssql, (err, rows) => {
        if (err) {
            console.error("Erro ao buscar ofertas de entrega:", err);
            return res.status(500).json({ error: err.message });
        }
        // Retorna a lista (se não tiver nada, devolve [] com status 200 sem travar)
        return res.status(200).json(rows);
    });
});

// --- 3. ACEITAR / INICIAR / FINALIZAR A ENTREGA ---
app.put("/corridas/:id_corrida/status", token.ValidateJWT, async function (req, res) {
    const id_pedido = req.params.id_corrida;
    const { status } = req.body;
    const id_usuario = req.id_usuario;

    try {
        // Busca a placa do motoboy logado
        let placa = null;
        const mot = await executeQuery("SELECT placa FROM motorista WHERE id_usuario = ?", [id_usuario]);
        if (mot.length > 0) {
            placa = mot[0].placa;
        }

        // Mapeia o status do app de mototáxi para o status do seu sistema 99Burger:
        // 'aceita' / 'iniciada' -> status 'E' (Saiu para entrega) e vincula a placa
        // 'encerrada'          -> status 'F' (Finalizado)
        // 'cancelada'          -> remove a placa para outro motoboy pegar
        let novoStatus = 'E';
        let updatePlaca = placa;

        if (status === 'encerrada') {
            novoStatus = 'F';
        } else if (status === 'cancelada') {
            novoStatus = 'P';
            updatePlaca = null; // Libera o pedido para outro motoboy
        }

        const sql = "UPDATE pedido SET status = ?, placa = ? WHERE id_pedido = ?";
        await executeQuery(sql, [novoStatus, updatePlaca, id_pedido]);

        return res.status(200).json({ message: "Status da corrida atualizado com sucesso!" });
    } catch (e) {
        console.error("Erro ao atualizar status da corrida:", e);
        return res.status(500).json({ error: e.message });
    }
});

// --- 4. DASHBOARD DO MOTOBOY: GANHOS DO DIA ---
app.get("/motoristas/resumo", token.ValidateJWT, async function (req, res) {
    const id_usuario = req.id_usuario;

    try {
        const mot = await executeQuery("SELECT placa FROM motorista WHERE id_usuario = ?", [id_usuario]);
        if (mot.length === 0 || !mot[0].placa) {
            return res.status(404).json({ error: "Motorista não encontrado." });
        }

        const placa = mot[0].placa;

        const ssql = `
            SELECT 
                COUNT(*) AS total_entregas_hoje,
                COALESCE(SUM(vl_entrega), 0) AS total_ganho_hoje
            FROM pedido
            WHERE placa = ?
              AND status = 'F'
              AND DATE(dt_pedido) = CURDATE()
        `;

        const dados = await executeQuery(ssql, [placa]);
        return res.status(200).json(dados[0]);
    } catch (e) {
        console.error("Erro no resumo do motoboy:", e);
        return res.status(500).json({ error: e.message });
    }
});


// 1. Retorna todas as notificações ativas ('A') do estabelecimento logado
app.get("/notificacoes", token.ValidateJWT, function (request, response) {
    const id_estabelecimento = request.id_estabelecimento;

    const ssql = `
        SELECT id_notificacao, id_usuario, mensagem, status, dt_criacao,
               id_estabelecimento, tipo, id_produto, id_pedido
        FROM notificacoes
        WHERE status = 'A'
          AND id_estabelecimento = ?
          AND tipo = 'CARDAPIO_DIGITAL'
        ORDER BY id_notificacao ASC
    `;

    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) {
            return response.status(500).json({ error: err.message });
        }

        console.log("JSON enviado para o Delphi:", result);
        return response.status(200).json(result);
    });
});
app.put("/notificacoes/:id", token.ValidateJWT, function (request, response) {
    const id_notificacao = request.params.id;
    const id_estabelecimento = request.id_estabelecimento;

    const ssql = `
        UPDATE notificacoes
           SET status = 'L'
         WHERE id_notificacao = ?
           AND id_estabelecimento = ?
    `;

    db.query(ssql, [id_notificacao, id_estabelecimento], function (err) {
        if (err) {
            return response.status(500).json({ error: err.message });
        }
        return response.status(200).json({ ok: true });
    });
});

app.post('/notificacoes/publico', async (req, res) => {

    const { id_estabelecimento, mensagem, id_pedido, id_produto } = req.body;

    if (!id_estabelecimento || !mensagem) {
        return res.status(400).json({
            error: 'Campos obrigatórios: id_estabelecimento e mensagem.'
        });
    }

    // Rede de segurança: se já existe notificação desse pedido, não cria outra
    if (id_pedido) {
        try {
            const existente = await executeQuery(
                `SELECT id_notificacao FROM notificacoes
                  WHERE id_pedido = ? AND id_estabelecimento = ? AND tipo = 'CARDAPIO_DIGITAL'
                  LIMIT 1`,
                [id_pedido, id_estabelecimento]
            );
            if (existente.length > 0) {
                return res.status(200).json({
                    ok: true,
                    id_notificacao: existente[0].id_notificacao,
                    duplicado: true
                });
            }
        } catch (e) {
            console.error('Erro ao checar notificação existente:', e.message);
        }
    }

    // 🔒 Trava: pedido Pix só gera notificação (alarme no Delphi) se o pagamento estiver APROVADO
    if (id_pedido) {
        try {
            const ped = await executeQuery(
                `SELECT p.mp_payment_id, p.forma_pagamento, e.mp_access_token
                   FROM pedido p
                   INNER JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
                  WHERE p.id_pedido = ? AND p.id_estabelecimento = ?
                  LIMIT 1`,
                [id_pedido, id_estabelecimento]
            );

            if (ped.length > 0) {
                const pedido = ped[0];
                const ehPix = pedido.forma_pagamento && pedido.forma_pagamento.toUpperCase().includes('PIX');

                if (ehPix && pedido.mp_payment_id) {
                    const tokenMP = pedido.mp_access_token || process.env.MP_ACCESS_TOKEN;
                    const consulta = await axios.get(
                        `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}`,
                        { headers: { Authorization: `Bearer ${tokenMP}` } }
                    );

                    if (consulta.data.status !== 'approved') {
                        return res.status(409).json({
                            error: 'Pix ainda não foi pago. Notificação não enviada.',
                            mp_status: consulta.data.status
                        });
                    }

                    // aproveita e marca como aprovado no pedido
                    await executeQuery(
                        'UPDATE pedido SET mp_status = ? WHERE id_pedido = ?',
                        ['approved', id_pedido]
                    );
                }
            }
        } catch (e) {
            console.error('Erro ao validar pagamento Pix antes de notificar:', e.response?.data || e.message);
            return res.status(500).json({ error: 'Não foi possível validar o pagamento Pix.' });
        }
    }

    const sql = `
        INSERT INTO notificacoes
        (
            id_usuario,
            mensagem,
            status,
            dt_criacao,
            id_estabelecimento,
            tipo,
            id_produto,
            id_pedido
        )
        VALUES
        (
            0,
            ?,
            'A',
            NOW(),
            ?,
            'CARDAPIO_DIGITAL',
            ?,
            ?
        )
    `;

    const valores = [
        mensagem,
        id_estabelecimento,
        id_produto || null,
        id_pedido || null
    ];

    db.query(sql, valores, (err, result) => {

        if(err){
            console.error(err);

            return res.status(500).json({
                error: err.message
            });
        }

        res.status(201).json({
            ok:true,
            id_notificacao: result.insertId
        });

    });

});

app.get("/estabelecimentos/:slug", function (request, response) {
    const { slug } = request.params;

    const ssql = `
        SELECT *
        FROM estabelecimento
        WHERE slug = ?
        LIMIT 1
    `;

    db.query(ssql, [slug], function (err, result) {
        if (err) {
            return response.status(500).json({
                error: "Erro ao buscar estabelecimento: " + err.message
            });
        }

        if (result.length === 0) {
            return response.status(404).json({
                error: "Estabelecimento não encontrado."
            });
        }

        return response.status(200).json(result[0]);
    });
});

// Adicione esta rota no seu arquivo de rotas ou server.js principal
app.get("/pedidos", token.ValidateJWT, function (request, response) {
    const id_est = request.id_estabelecimento;
    const { data } = request.query;

    let params = [id_est];
    let filtro_data = "";

    if (data) {
        filtro_data = " AND DATE(p.dt_pedido) >= ? ";
        params.push(data);
    }

    const ssql = `
        SELECT 
            p.id_pedido,
            p.status,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i:%s') AS dt_pedido,
            p.vl_subtotal,
            p.vl_entrega,
            p.forma_pagamento,
            p.vl_total,
            COALESCE((SELECT SUM(d.valor_pago) FROM divisao_pagamento d WHERE d.id_pedido = p.id_pedido), 0) AS vl_pago,
            COALESCE(
                p.vl_falta,
                GREATEST(0, p.vl_total - COALESCE((SELECT SUM(d.valor_pago) FROM divisao_pagamento d WHERE d.id_pedido = p.id_pedido), 0))
            ) AS vl_falta,
            p.numero_mesa,
            p.numero_pessoas,
            p.local_consumo,
            COUNT(i.id_item) AS qtd_item,
            p.nome_cliente
        FROM pedido p
        LEFT JOIN pedido_item i ON i.id_pedido = p.id_pedido
        WHERE p.id_estabelecimento = ? ${filtro_data}
        GROUP BY 
            p.id_pedido, p.status, p.forma_pagamento, p.dt_pedido,
            p.vl_subtotal, p.vl_entrega, p.vl_total, p.vl_falta,
            p.nome_cliente, p.numero_mesa, p.numero_pessoas, p.local_consumo
        ORDER BY p.id_pedido DESC
    `;

    db.query(ssql, params, function (err, result) {
        if (err) {
            console.error("Erro ao listar pedidos:", err);
            return response.status(500).json({ error: "Erro interno no servidor." });
        }
        return response.status(200).json(result);
    });
});


app.post('/pedidos/:id/atualizar_impressao', token.ValidateJWT, (req, res) => {
    const id_pedido = req.params.id;
    const id_estabelecimento = req.id_estabelecimento; 
    const { numero_impressoes_desejadas, numero_impressoes_realizadas } = req.body;

    // --- SUA NOVA VALIDAÇÃO NA LINHA 1106 ---
    if (numero_impressoes_desejadas === undefined) {
        return res.status(400).json({ error: 'Faltando dados de impressão' });
    }
    // ----------------------------------------

    const sql = `
        UPDATE pedido 
        SET numero_impressoes_desejadas = ?, numero_impressoes_realizadas = ? 
        WHERE id_pedido = ? AND id_estabelecimento = ?`;

    db.query(sql, [numero_impressoes_desejadas, numero_impressoes_realizadas, id_pedido, id_estabelecimento], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Status de impressão atualizado' });
    });
});

  // Adicionar ou atualizar impressora
  // POST /impressora - Registra ou Atualiza (Upsert)
app.post('/impressora', token.ValidateJWT, (req, res) => {
    const id_estabelecimento = req.id_estabelecimento;
    const { tipo, ip } = req.body;

    if (!tipo || !ip) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    // Usando ON DUPLICATE KEY UPDATE para garantir que só exista uma linha por estabelecimento
    const sql = `
        INSERT INTO impressora (ip, tipo, id_estabelecimento) 
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE ip = ?, tipo = ?
    `;

    db.query(sql, [ip, tipo, id_estabelecimento, ip, tipo], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json({ message: 'Impressora registrada/atualizada com sucesso' });
    });
});

  // GET /impresora
  app.get("/impressora", token.ValidateJWT, (req, res) => {
    const id_est = req.id_estabelecimento; // Vem do Token!
    const sql = "SELECT * FROM impressora WHERE id_estabelecimento = ?";
    
    db.query(sql, [id_est], (err, result) => {
        if (err) return res.status(500).send(err);
        res.status(200).json(result);
    });
});

// PUT /impressora - Atualiza especificamente a impressora do dono do Token
app.put("/impressora", token.ValidateJWT, (req, res) => {
    const id_est = req.id_estabelecimento; // Vem do Token!
    const { tipo, ip } = req.body;

    // Tenta atualizar. Se não existir, você pode fazer um INSERT (Upsert)
    const sql = `INSERT INTO impressora (id_estabelecimento, tipo, ip) 
                 VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE tipo = ?, ip = ?`;

    db.query(sql, [id_est, tipo, ip, tipo, ip], (err, result) => {
        if (err) return res.status(500).send(err);
        res.status(200).json({ message: "Impressora atualizada" });
    });
});

  app.get('/horario', (req, res) => {
      const now = new Date();

      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');

      const dataServidor = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;

      res.json({ data: dataServidor });
  });


  app.post('/pedidos', token.ValidateJWT, async (req, res) => {
    const p = req.body;
    const idEstab = p.id_estabelecimento || req.id_estabelecimento;
    const vlTotal = Math.max(0, Number(p.vl_total) || 0);

    try {
        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const dtPedidoBrasilia = agora.toISOString().slice(0, 19).replace('T', ' ');

        const result = await executeQuery(
            `INSERT INTO pedido 
            (id_usuario, id_estabelecimento, nome_cliente, vl_subtotal, vl_entrega, forma_pagamento, vl_total, vl_falta, numero_mesa, numero_pessoas, status, dt_pedido, endereco_entrega, observacao, dinheiro, troco, local_consumo)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                p.id_usuario || req.id_usuario,
                idEstab,
                p.nome_cliente || '-',
                p.vl_subtotal || 0,
                p.vl_entrega || 0,
                p.forma_pagamento || null,
                vlTotal,
                vlTotal,
                p.numero_mesa || null,
                p.numero_pessoas || null,
                'A',
                dtPedidoBrasilia,
                p.endereco_entrega || null,
                p.observacao || null,
                p.dinheiro || 0,
                p.troco || 0,
                p.local_consumo || null
            ]
        );

        const idPedido = result.insertId;

        // 1. Grava os itens do pedido
        if (Array.isArray(p.itens) && p.itens.length > 0) {
            const itens = p.itens.map(i => [
                idPedido, i.id_produto, i.qtd, i.vl_unitario, i.vl_total, i.observacao || null
            ]);

            await executeQuery(
                `INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?`,
                [itens]
            );
        }

        // 2. Opcional: se já vierem pagamentos parciais juntos, grava tudo na divisao_pagamento e recalcula vl_falta
        let saldo = { vl_total: vlTotal, vl_pago: 0, vl_falta: vlTotal };
        if (Array.isArray(p.pagamentos) && p.pagamentos.length > 0) {
            const pagamentosValidos = p.pagamentos
                .filter(pg => Number(pg.valor_pago) > 0 && pg.forma_pagamento)
                .map(pg => [
                    idPedido,
                    pg.id_usuario || p.id_usuario || req.id_usuario || null,
                    Number(Number(pg.valor_pago).toFixed(2)),
                    String(pg.forma_pagamento).trim(),
                    pg.observacao ? String(pg.observacao).trim() : null,
                    dtPedidoBrasilia
                ]);

            if (pagamentosValidos.length > 0) {
                await executeQuery(
                    `INSERT INTO divisao_pagamento (id_pedido, id_usuario, valor_pago, forma_pagamento, observacao, dt_pagamento) VALUES ?`,
                    [pagamentosValidos]
                );
                saldo = await recalcularSaldoPedido(idPedido, idEstab) || saldo;
            }
        }

        return res.status(201).json({
            id_pedido: idPedido,
            vl_total: saldo.vl_total,
            vl_pago: saldo.vl_pago,
            vl_falta: saldo.vl_falta,
            message: "Pedido salvo com sucesso"
        });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/pedidos/:id/itens', token.ValidateJWT, async (req, res) => {
    const id_pedido = parseInt(req.params.id, 10);
    const { itens, id_estabelecimento } = req.body;
    const idEstab = id_estabelecimento || req.id_estabelecimento;

    if (!id_pedido || !Array.isArray(itens) || !itens.length || !idEstab) {
        return res.status(400).json({ error: 'Dados incompletos para adicionar itens.' });
    }

    try {
        const valores = itens.map(i => [
            id_pedido, i.id_produto, i.qtd, i.vl_unitario, i.vl_total, i.observacao || null
        ]);

        await executeQuery(
            `INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?`,
            [valores]
        );

        const totalItensNovos = itens.reduce((acc, i) => acc + (Number(i.vl_total) || 0), 0);

        await executeQuery(
            `UPDATE pedido SET vl_total = vl_total + ? WHERE id_pedido = ? AND id_estabelecimento = ?`,
            [totalItensNovos, id_pedido, idEstab]
        );

        const saldo = await recalcularSaldoPedido(id_pedido, idEstab);

        const rowsPedido = await executeQuery(
            "SELECT nome_cliente, vl_total, vl_falta, local_consumo FROM pedido WHERE id_pedido = ? AND id_estabelecimento = ?",
            [id_pedido, idEstab]
        );

        if (rowsPedido.length === 0) {
            return res.status(404).json({ error: 'Pedido não localizado.' });
        }

        return res.status(201).json({
            message: 'Itens adicionados com sucesso',
            novo_total: rowsPedido[0].vl_total,
            vl_falta: saldo ? saldo.vl_falta : rowsPedido[0].vl_falta,
            local: rowsPedido[0].local_consumo
        });

    } catch (err) {
        console.error("Erro ao adicionar itens:", err);
        return res.status(500).json({ message: 'Erro interno', error: err.message });
    }
});

// Cache em memória de pedidos públicos recém-criados (chave de idempotência -> Promise do id_pedido).
// Se o mesmo checkout chegar duas vezes (duplo clique, retry de rede), a 2ª chamada
// recebe o MESMO pedido em vez de criar outro.
const pedidosPublicosRecentes = new Map();
const TTL_IDEMPOTENCIA_MS = 10 * 60 * 1000;

app.post('/pedidos/publico', async (req, res) => {
    const p = req.body;

    // 🛑 Trava de segurança: Bloqueia carrinhos vazios, sem itens ou com valor zero
    if (!p.itens || p.itens.length === 0 || !p.vl_total || Number(p.vl_total) <= 0) {
        return res.status(400).json({ error: 'Pedido inválido: O carrinho está vazio ou o valor total é zero.' });
    }

    if (!p.slug) {
        return res.status(400).json({ error: 'Slug do estabelecimento é obrigatório' });
    }

    if (!p.nome_cliente) {
        return res.status(400).json({ error: 'Nome do cliente é obrigatório' });
    }

    const chave = p.idempotency_key ? `${p.slug}:${p.idempotency_key}` : null;

    // Já existe (ou está sendo criado) um pedido com essa chave? Devolve o mesmo.
    if (chave && pedidosPublicosRecentes.has(chave)) {
        try {
            const idExistente = await pedidosPublicosRecentes.get(chave);
            console.log(`♻️ Pedido duplicado ignorado (chave ${p.idempotency_key}) -> devolvendo #${idExistente}`);
            return res.status(200).json({
                id_pedido: idExistente,
                message: 'Pedido já registrado.',
                duplicado: true
            });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    const criarPedido = (async () => {
        // 1. Busca o id_estabelecimento pelo slug
        const estabelecimento = await new Promise((resolve, reject) => {
            db.query(
                'SELECT id_estabelecimento FROM estabelecimento WHERE slug = ?',
                [p.slug],
                (err, result) => {
                    if (err) return reject(err);
                    if (result.length === 0) return reject(new Error('Estabelecimento não encontrado para o slug: ' + p.slug));
                    resolve(result[0]);
                }
            );
        });

        const id_estabelecimento = estabelecimento.id_estabelecimento;

        // 2. Data/hora
        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const dtPedidoBrasilia = agora.toISOString().slice(0, 19).replace('T', ' ');

        const session_id = p.session_id || null;
        const mp_payment_id = p.mp_payment_id ? String(p.mp_payment_id) : null;

        // 3. INSERT do Pedido (agora grava mp_payment_id, necessário pro estorno do Pix)
        const result = await new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO pedido 
                (id_usuario, id_estabelecimento, nome_cliente, vl_subtotal, vl_entrega, 
                 forma_pagamento, vl_total, status, dt_pedido, endereco_entrega, 
                 rota, observacao, local_consumo, dinheiro, troco, session_id,
                 mp_payment_id, mp_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    null,
                    id_estabelecimento,
                    p.nome_cliente,
                    p.vl_subtotal || 0,
                    p.vl_entrega || 0,
                    p.forma_pagamento || 'A combinar',
                    p.vl_total || 0,
                    'A',
                    dtPedidoBrasilia,
                    p.endereco_entrega || null,
                    p.rota || null,
                    p.observacao || null,
                    p.local_consumo || 'DELIVERY',
                    p.dinheiro || 0,
                    p.troco || 0,
                    session_id,
                    mp_payment_id,
                    mp_payment_id ? 'pending' : null
                ],
                (err, res) => err ? reject(err) : resolve(res)
            );
        });

        const idPedido = result.insertId;

        // 4. Itens
        if (p.itens && p.itens.length > 0) {
            const itens = p.itens.map(i => [
                idPedido,
                i.id_produto,
                i.qtd,
                i.vl_unitario,
                i.vl_total,
                i.observacao || null
            ]);

            await new Promise((resolve, reject) => {
                db.query(
                    'INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?',
                    [itens],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }

        return idPedido;
    })();

    // Registra ANTES de aguardar: uma 2ª requisição simultânea já cai no cache acima
    if (chave) {
        pedidosPublicosRecentes.set(chave, criarPedido);
        setTimeout(() => pedidosPublicosRecentes.delete(chave), TTL_IDEMPOTENCIA_MS);
    }

    try {
        const idPedido = await criarPedido;
        return res.status(201).json({
            id_pedido: idPedido,
            message: 'Pedido realizado com sucesso!'
        });
    } catch (e) {
        if (chave) pedidosPublicosRecentes.delete(chave); // falhou: libera nova tentativa
        console.error('Erro no /pedidos/publico:', e);
        return res.status(500).json({ error: e.message });
    }
});


const atualizarStatusPedido = async (req, res) => {
    const { id_pedido } = req.params;
    let { status } = req.body;
    const id_estabelecimento = req.id_estabelecimento;

    if (!status) {
        return res.status(400).json({ error: "O campo status é obrigatório." });
    }

    status = String(status).toUpperCase();

    try {
        // 0. Busca o pedido ATUAL + o token do Mercado Pago da loja dona dele
        const pedidoArr = await executeQuery(
            `SELECT p.status, p.mp_payment_id, p.forma_pagamento, p.vl_total, e.mp_access_token
               FROM pedido p
               INNER JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
              WHERE p.id_pedido = ? AND p.id_estabelecimento = ?`,
            [id_pedido, id_estabelecimento]
        );

        if (pedidoArr.length === 0) {
            return res.status(404).json({ error: "Pedido não encontrado." });
        }

        const pedido = pedidoArr[0];
        const statusAnterior = pedido.status;

        // Requisição repetida (clique duplo no Delphi): não refaz estorno nem baixa de estoque
        if (statusAnterior === status) {
            console.log(`ℹ️ Pedido ${id_pedido} já estava com status ${status} — ignorando repetição.`);
            return res.json({ sucesso: true, message: "Status já estava atualizado." });
        }

        // 1. CANCELADO: devolve o dinheiro do Pix (se pago) ou cancela a cobrança (se pendente)
        let mpStatusNovo = null;
        if (status === 'C') {
            const ehPix = pedido.forma_pagamento && pedido.forma_pagamento.toUpperCase().includes("PIX");

            if (pedido.mp_payment_id && Number(pedido.vl_total) > 0 && ehPix) {
                // Pega o token da loja gravado no banco ou o .env como plano B
                const tokenMP = pedido.mp_access_token || process.env.MP_ACCESS_TOKEN;
                const headersMP = { 'Authorization': `Bearer ${tokenMP}` };

                try {
                    const consulta = await axios.get(
                        `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}`,
                        { headers: headersMP }
                    );
                    const statusMP = consulta.data.status;

                    if (statusMP === 'approved') {
                        await axios.post(
                            `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}/refunds`,
                            {},
                            { headers: { ...headersMP, 'X-Idempotency-Key': `refund-pedido-${id_pedido}` } }
                        );
                        mpStatusNovo = 'refunded';
                        console.log(`✅ Pix do pedido ${id_pedido} estornado com sucesso usando a conta da loja!`);
                    } else if (statusMP === 'pending' || statusMP === 'in_process') {
                        await axios.put(
                            `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}`,
                            { status: 'cancelled' },
                            { headers: headersMP }
                        );
                        mpStatusNovo = 'cancelled';
                        console.log(`🚫 Cobrança Pix do pedido ${id_pedido} cancelada no Mercado Pago.`);
                    } else {
                        console.log(`ℹ️ Pedido ${id_pedido}: pagamento MP está '${statusMP}', nada a estornar.`);
                    }
                } catch (mpErr) {
                    console.error(`❌ Erro na API do Mercado Pago (pedido ${id_pedido}):`, mpErr.response?.data || mpErr.message);
                }
            }
        }

        // 2. Atualiza o status no banco
        if (mpStatusNovo) {
            await executeQuery(
                "UPDATE pedido SET status = ?, mp_status = ? WHERE id_pedido = ? AND id_estabelecimento = ?",
                [status, mpStatusNovo, id_pedido, id_estabelecimento]
            );
        } else {
            await executeQuery(
                "UPDATE pedido SET status = ? WHERE id_pedido = ? AND id_estabelecimento = ?",
                [status, id_pedido, id_estabelecimento]
            );
        }

        // 3. Finalizado ('F') e ainda NÃO estava finalizado: dá baixa no estoque
        if (status === 'F' && statusAnterior !== 'F') {
            try {
                const sqlItens = `
                    SELECT pi.id_produto, pi.qtd AS qtd_item, p.unidade_medida
                    FROM pedido_item pi
                    INNER JOIN pedido pe ON pe.id_pedido = pi.id_pedido
                    INNER JOIN produto p ON p.id_produto = pi.id_produto
                    WHERE pi.id_pedido = ? AND pe.id_estabelecimento = ?
                `;
                const itens = await executeQuery(sqlItens, [id_pedido, id_estabelecimento]);

                for (const item of itens) {
                    await executeQuery(
                        `UPDATE produto SET qtd = qtd - ? WHERE id_produto = ? AND id_estabelecimento = ?`,
                        [item.qtd_item, item.id_produto, id_estabelecimento]
                    );
                }

                const sqlInsumos = `
                    SELECT i.id_produto, i.id_insumo, i.qtd_consumida, pi.qtd AS qtd_item
                    FROM pedido_item pi
                    INNER JOIN produto_ficha_tecnica i ON i.id_produto = pi.id_produto
                    INNER JOIN pedido pe ON pe.id_pedido = pi.id_pedido
                    WHERE pi.id_pedido = ? AND pe.id_estabelecimento = ?
                `;
                const insumos = await executeQuery(sqlInsumos, [id_pedido, id_estabelecimento]);

                for (const insumo of insumos) {
                    const totalConsumido = insumo.qtd_item * insumo.qtd_consumida;
                    await executeQuery(
                        `UPDATE insumo SET qtd_atual = qtd_atual - ? WHERE id_insumo = ? AND id_estabelecimento = ?`,
                        [totalConsumido, insumo.id_insumo, id_estabelecimento]
                    );
                }
            } catch (stockError) {
                console.error("[Baixa de estoque] ERRO ao dar baixa:", stockError.message);
            }
        }

        return res.json({ sucesso: true, message: "Status do pedido atualizado com sucesso!" });

    } catch (error) {
        console.error("Erro ao atualizar status do pedido:", error);
        return res.status(500).json({ error: "Erro ao atualizar status do pedido." });
    }
};

// O Delphi usa PUT; POST mantido por compatibilidade. Mesmo handler nos dois.
app.post('/pedidos/status/:id_pedido', token.ValidateJWT, atualizarStatusPedido);

app.put('/pedidos/status/:id_pedido', token.ValidateJWT, atualizarStatusPedido);


app.put('/produtos/ficha/:id_ficha', token.ValidateJWT, async (req, res) => {
    const { id_ficha } = req.params;
    const id_estabelecimento = req.id_estabelecimento;
    const { qtd_consumida } = req.body;

    const qtd = parseFloat(qtd_consumida);

    if (
        qtd_consumida == null ||
        isNaN(qtd) ||
        qtd <= 0
    ) {
        return res.status(400).json({
            erro: "Informe uma quantidade consumida válida (maior que zero)"
        });
    }

    try {
        /*
         * Primeiro descobrimos qual produto pertence
         * a esta ficha.
         */
        const ficha = await executeQuery(
            `
            SELECT T.id_produto
            FROM produto_ficha_tecnica T
            INNER JOIN produto P
                ON P.id_produto = T.id_produto
            WHERE T.id_ficha = ?
              AND P.id_estabelecimento = ?
            `,
            [
                id_ficha,
                id_estabelecimento
            ]
        );

        if (ficha.length === 0) {
            return res.status(404).json({
                erro: "Ficha técnica não encontrada"
            });
        }

        const id_produto = ficha[0].id_produto;

        /*
         * Atualiza a quantidade consumida.
         */
        const result = await executeQuery(
            `
            UPDATE produto_ficha_tecnica T
            INNER JOIN produto P
                ON P.id_produto = T.id_produto
            SET T.qtd_consumida = ?
            WHERE T.id_ficha = ?
              AND P.id_estabelecimento = ?
            `,
            [
                Number(qtd.toFixed(3)),
                id_ficha,
                id_estabelecimento
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(403).json({
                erro: "Item não encontrado ou permissão negada"
            });
        }

        /*
         * Recalcula o estoque do produto.
         */
        const estoqueReal =
            await recalcularEstoqueProduto(
                id_produto,
                id_estabelecimento
            );

        return res.json({
            sucesso: true,
            estoque_calculado: estoqueReal,
            mensagem: "Quantidade atualizada com sucesso!"
        });

    } catch (err) {
        console.error(
            "❌ Erro ao atualizar ficha:",
            err
        );

        return res.status(500).json({
            erro: "Erro ao atualizar ficha técnica"
        });
    }
});

// --- NOVAS ROTAS DE INSUMOS ---

// Atualizar um Insumo existente (quantidade, preço, etc.)
app.put('/insumos/:id_insumo', token.ValidateJWT, (req, res) => {
  const { id_insumo } = req.params;
  const id_estabelecimento = req.id_estabelecimento;
  const { nome, unidade_medida, qtd_atual, qtd_minima, custo_unitario } = req.body;

  const UNIDADES_VALIDAS = ["UN", "KG", "G", "L", "ML"];
  const unidadeSegura = UNIDADES_VALIDAS.includes(unidade_medida) ? unidade_medida : "UN";

  const sql = `
    UPDATE insumo 
    SET nome = ?, unidade_medida = ?, qtd_atual = ?, qtd_minima = ?, custo_unitario = ?
    WHERE id_insumo = ? AND id_estabelecimento = ?
  `;

  db.query(sql, [nome, unidadeSegura, qtd_atual, qtd_minima, custo_unitario, id_insumo, id_estabelecimento], (err, result) => {
    if (err) {
      console.error("Erro ao atualizar insumo:", err);
      return res.status(500).json({ erro: "Erro ao atualizar insumo" });
    }
    if (result.affectedRows === 0) {
      return res.status(403).json({ erro: "Insumo não encontrado ou permissão negada" });
    }
    res.json({ sucesso: true, mensagem: "Insumo atualizado com sucesso!" });
  });
});

// Deletar um Insumo
app.delete('/insumos/:id_insumo', token.ValidateJWT, (req, res) => {
  const { id_insumo } = req.params;
  const id_estabelecimento = req.id_estabelecimento;

  const sql = "DELETE FROM insumo WHERE id_insumo = ? AND id_estabelecimento = ?";

  db.query(sql, [id_insumo, id_estabelecimento], (err, result) => {
    if (err) {
      console.error("Erro ao deletar insumo:", err);
      return res.status(500).json({ erro: "Erro ao deletar insumo. Verifique se ele está vinculado a algum produto." });
    }
    if (result.affectedRows === 0) {
      return res.status(403).json({ erro: "Insumo não encontrado ou permissão negada" });
    }
    res.json({ sucesso: true, mensagem: "Insumo removido com sucesso!" });
  });
});

app.get("/cardapio_digital/:id", function (request, response) {
    const slug = request.params.id;
    
    let sqlEstab = "SELECT id_estabelecimento, horario_abertura, horario_fechamento, fuso_horario_cidade, latitude, longitude, taxa_base, preco_km FROM estabelecimento WHERE slug = ?";
    
    db.query(sqlEstab, [slug], function (err, estab) {
        if (err || estab.length === 0) return response.status(404).json({ error: "Estabelecimento não encontrado" });
        
        const { id_estabelecimento, horario_abertura, horario_fechamento, fuso_horario_cidade, latitude, longitude, taxa_base, preco_km } = estab[0];

        const dataAgora = new Date();
        const utcMilisegundos = dataAgora.getTime() + (dataAgora.getTimezoneOffset() * 60000);
        const dataHoraLocal = new Date(utcMilisegundos + (3600000 * fuso_horario_cidade));
        const horaAtualFormatada = dataHoraLocal.toTimeString().split(' ')[0];

        // ✅ Corrigido: suporta turnos que cruzam a meia-noite (ex: 12:00 às 03:30)
        let estabelecimentoAberto;
        if (horario_abertura <= horario_fechamento) {
            estabelecimentoAberto = horaAtualFormatada >= horario_abertura && horaAtualFormatada <= horario_fechamento;
        } else {
            estabelecimentoAberto = horaAtualFormatada >= horario_abertura || horaAtualFormatada <= horario_fechamento;
        }

        let ssql = `
            SELECT p.*, c.descricao AS categoria 
            FROM produto p
            INNER JOIN produto_categoria c ON c.id_categoria = p.id_categoria
            WHERE p.id_estabelecimento = ? AND (c.ativo IS NULL OR c.ativo != 'N')
            GROUP BY p.id_produto ORDER BY c.ordem, p.nome
        `;

        db.query(ssql, [id_estabelecimento], function (err, result) {
            if (err) return response.status(500).json({ error: err.message });
            
            const produtos = result.map(p => ({ ...p, preco: parseFloat(p.preco) }));
            
            return response.status(200).json({
                esta_aberto: estabelecimentoAberto,
                latitude: latitude !== null ? parseFloat(latitude) : null,
                longitude: longitude !== null ? parseFloat(longitude) : null,
                taxa_base: taxa_base !== null ? parseFloat(taxa_base) : null,
                preco_km: preco_km !== null ? parseFloat(preco_km) : null,
                configuracoes: { 
                    abertura: horario_abertura, 
                    fechamento: horario_fechamento 
                },
                lista_produtos: produtos
            });
        });
    });
});

app.get("/categorias_digital/:id", function (request, response) {
    const slug = request.params.id;
    db.query("SELECT id_estabelecimento FROM estabelecimento WHERE slug = ?", [slug], function (err, estab) {
        if (err || estab.length === 0) return response.status(404).json({ error: "Não encontrado" });
        const id_estab = estab[0].id_estabelecimento;

        let ssql = `
            SELECT id_categoria, descricao AS categoria, url_icone 
            FROM produto_categoria 
            WHERE id_estabelecimento = ? 
              AND (ativo IS NULL OR ativo != 'N')
            ORDER BY ordem
        `;
        db.query(ssql, [id_estab], function (err, result) {
            if (err) return response.status(500).json({ error: err.message });
            return response.status(200).json(result);
        });
    });
});

// ESSE É NOVO — endpoint separado para as opções
// ESSE É NOVO — endpoint separado para as opções
app.get("/opcoes_digital/:id_produto", function (req, res) {
    const id_produto = req.params.id_produto; // ← essa linha estava faltando

    const ssql = `
        SELECT 
            o.id_opcao,
            o.descricao,
            o.ind_obrigatorio,
            o.qtd_max_escolha,
            o.ordem AS ordem_grupo,
            i.id_item,
            i.nome_item,
            i.vl_item,
            i.ordem AS ordem_item
        FROM produto_opcao o
        LEFT JOIN produto_opcao_item i ON i.id_opcao = o.id_opcao
        WHERE o.id_produto = ? AND o.ind_ativo = 'S'
        ORDER BY o.ordem, i.ordem
    `;

    db.query(ssql, [id_produto], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const grupos = [];
        rows.forEach(row => {
            let grupo = grupos.find(g => g.id_opcao === row.id_opcao);
            if (!grupo) {
                grupo = {
                    id_opcao: row.id_opcao,
                    descricao: row.descricao,
                    ind_obrigatorio: row.ind_obrigatorio,
                    qtd_max_escolha: row.qtd_max_escolha,
                    itens: []
                };
                grupos.push(grupo);
            }
            if (row.id_item) {
                grupo.itens.push({
                    id_item: row.id_item,
                    nome_item: row.nome_item,
                    vl_item: parseFloat(row.vl_item),
                    ordem: row.ordem_item
                });
            }
        });

        return res.status(200).json(grupos);
    });
});

// Listar categorias de despesa
app.get("/despesas/categorias", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento;
    const ssql = "SELECT id_categoria, descricao FROM despesa_categoria ORDER BY descricao";

    db.query(ssql, function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(200).json(result);
    });
});

// Cadastrar nova categoria de despesa
app.post("/despesas/categorias", token.ValidateJWT, function (req, res) {
    const { descricao } = req.body;
    const ssql = "INSERT INTO despesa_categoria (descricao) VALUES (?)";

    db.query(ssql, [descricao], function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(201).json({ id_categoria: result.insertId });
    });
});

// Listar Despesas com Filtro de Data e Status
app.get("/despesas", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento;
    const { dt_inicio, dt_fim, status } = req.query;

    let params = [id_estabelecimento];
    let ssql = `
        SELECT d.*, c.descricao as categoria_nome 
        FROM despesa d
        LEFT JOIN despesa_categoria c ON (c.id_categoria = d.id_categoria)
        WHERE d.id_estabelecimento = ? `;

    if (dt_inicio && dt_fim) {
        ssql += " AND d.data_vencimento BETWEEN ? AND ? ";
        params.push(dt_inicio, dt_fim);
    }

    if (status) {
        ssql += " AND d.status = ? ";
        params.push(status);
    }

    ssql += " ORDER BY d.data_vencimento ASC";

    db.query(ssql, params, function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(200).json(result);
    });
});

// Cadastrar Despesa
app.post("/despesas", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento;
    const { descricao, valor, data_vencimento, status, id_categoria, id_usuario } = req.body;

    const ssql = `
        INSERT INTO despesa (descricao, valor, data_vencimento, status, id_categoria, id_usuario, id_estabelecimento)
        VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const params = [descricao, valor, data_vencimento, status || 'A', id_categoria, id_usuario, id_estabelecimento];

    db.query(ssql, params, function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(201).json({ id_despesa: result.insertId, message: "Despesa lançada!" });
    });
});

// Baixar/Pagar Despesa (Alterar Status)
app.put("/despesas/:id/pagar", token.ValidateJWT, function (req, res) {
    const id_despesa = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;
    const data_hoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const ssql = `
        UPDATE despesa 
        SET status = 'P', data_pagamento = ? 
        WHERE id_despesa = ? AND id_estabelecimento = ?`;

    db.query(ssql, [data_hoje, id_despesa, id_estabelecimento], function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(403).json({ error: "Acesso negado ou registro não existe" });
        
        return res.status(200).json({ message: "Conta baixada com sucesso!" });
    });
});

// Excluir Despesa
app.delete("/despesas/:id", token.ValidateJWT, function (req, res) {
    const id_despesa = req.params.id;
    const id_estabelecimento = req.id_estabelecimento;

    const ssql = "DELETE FROM despesa WHERE id_despesa = ? AND id_estabelecimento = ?";

    db.query(ssql, [id_despesa, id_estabelecimento], function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(200).json({ message: "Removido!" });
    });
});

app.get("/financeiro/resumo", token.ValidateJWT, function (req, res) {
    const id_est = req.id_estabelecimento;
    const { mes, ano } = req.query; // Ex: ?mes=03&ano=2026

    const ssql = `
        SELECT 
            (SELECT SUM(vl_total) FROM pedido WHERE id_estabelecimento = ? AND MONTH(dt_pedido) = ? AND YEAR(dt_pedido) = ? AND status <> 'C') as total_vendas,
            (SELECT SUM(valor) FROM despesa WHERE id_estabelecimento = ? AND MONTH(data_vencimento) = ? AND YEAR(data_vencimento) = ? AND status = 'P') as total_despesas_pagas
    `;

    db.query(ssql, [id_est, mes, ano, id_est, mes, ano], function (err, result) {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(200).json(result[0]);
    });
});

// --- COLA ESSA FUNÇÃO AQUI (Faltou ela) ---
function executeQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
}

// Taxa da plataforma 99Burger (application_fee do Mercado Pago)
// Até R$ 10,00 => 1% | Acima de R$ 10,00 => 2%
// O Mercado Pago cobra a taxa dele do lojista, separado desta.
function calcularTaxaPlataforma(valor) {
    const percentual = valor > 10 ? 0.02 : 0.01;
    return Math.round((valor * percentual + Number.EPSILON) * 100) / 100;
}

app.post("/pix/gerar", async (req, res) => {
    try {
        const { id_pedido, slug, id_estabelecimento, transaction_amount, description, payer } = req.body;

        // 1. Busca dinamicamente o token da loja no banco pelo slug ou id
        let tokenMP = null;
        if (slug || id_estabelecimento) {
            const estab = await executeQuery(
                "SELECT mp_access_token FROM estabelecimento WHERE slug = ? OR id_estabelecimento = ? LIMIT 1",
                [slug || '', id_estabelecimento || 0]
            );
            if (estab.length > 0 && estab[0].mp_access_token) {
                tokenMP = estab[0].mp_access_token;
            }
        }

        // 2. Se a loja ainda não tiver token no banco, usa o .env como plano B
        if (!tokenMP) {
            tokenMP = process.env.MP_ACCESS_TOKEN;
        }

        if (!tokenMP) {
            return res.status(400).json({ 
                error: "Estabelecimento sem credencial do Mercado Pago configurada." 
            });
        }

        // 3. Trata os dados do pagador
        const nomeCompleto = (payer?.first_name || 'Cliente').trim();
        const partesNome = nomeCompleto.split(" ");
        const primeironome = partesNome[0] || 'Cliente';
        const sobrenome = partesNome.slice(1).join(" ") || ' ';

        const payerData = {
            email: payer?.email || 'cliente@99burger.com',
            first_name: primeironome,
            last_name: sobrenome
        };

        const cpfInformado = payer?.cpf || payer?.identification?.number;
        if (cpfInformado) {
            const cpfLimpo = String(cpfInformado).replace(/\D/g, "");
            if (cpfLimpo.length === 11) {
                payerData.identification = {
                    type: 'CPF',
                    number: cpfLimpo
                };
            }
        }

        // 4. Monta o pagamento e calcula a taxa da plataforma
        const valor = Number(transaction_amount);
        if (!valor || valor <= 0) {
            return res.status(400).json({ error: "Valor do pedido inválido." });
        }

        const pagamentoBody = {
            transaction_amount: valor,
            description: description || `Pedido #${id_pedido}`,
            payment_method_id: 'pix',
            payer: payerData
        };

        // application_fee só funciona com o token OAuth da loja (conta diferente da sua).
        // Se caiu no plano B (.env = sua própria conta), não cobra taxa.
        const usandoTokenDaPlataforma = tokenMP === process.env.MP_ACCESS_TOKEN;
        if (!usandoTokenDaPlataforma) {
            const taxa = calcularTaxaPlataforma(valor);
            if (taxa > 0) {
                pagamentoBody.application_fee = taxa;
                console.log(`[PIX] Pedido ${id_pedido}: valor ${valor.toFixed(2)} | taxa plataforma ${taxa.toFixed(2)}`);
            }
        }

        // 5. Cria o Pix no Mercado Pago com a chave específica da lanchonete
        const responseMP = await axios.post(
            'https://api.mercadopago.com/v1/payments',
            pagamentoBody,
            {
                headers: {
                    'Authorization': `Bearer ${tokenMP}`,
                    'X-Idempotency-Key': `pedido_${id_pedido}_${Date.now()}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const paymentData = responseMP.data;
        const mp_payment_id = paymentData.id;
        const mp_qr_code = paymentData.point_of_interaction.transaction_data.qr_code;
        const mp_qr_code_base64 = paymentData.point_of_interaction.transaction_data.qr_code_base64;
        const mp_status = paymentData.status;

        // 6. Salva os dados do Pix gerado no pedido
        const sqlUpdate = "UPDATE pedido SET mp_payment_id = ?, mp_qr_code = ?, mp_status = ? WHERE id_pedido = ?";
        if (id_pedido) {
            db.query(sqlUpdate, [mp_payment_id, mp_qr_code, mp_status, id_pedido]);
        }

        return res.status(200).json({
            id_pedido,
            mp_payment_id,
            mp_qr_code,
            mp_qr_code_base64,
            mp_status
        });

    } catch (error) {
        console.error("Erro no Mercado Pago:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: "Erro ao gerar PIX no Mercado Pago.",
            detalhes: error.response?.data || error.message 
        });
    }
});

// 2. ROTA PARA CONSULTAR STATUS DO PIX DIRETAMENTE NO MERCADO PAGO
app.get("/pix/status/:payment_id", async function (req, res) {
    const payment_id = req.params.payment_id;

    if (!payment_id || payment_id === "null" || payment_id === "undefined") {
        return res.status(400).json({ error: "ID de pagamento inválido." });
    }

    try {
        // 1. Busca o pedido e o token da loja
        let tokenMP = null;
        const rows = await executeQuery(
            `SELECT p.id_pedido, p.id_estabelecimento, p.nome_cliente, p.vl_total,
                    p.forma_pagamento, p.local_consumo, p.endereco_entrega,
                    e.mp_access_token 
             FROM pedido p 
             INNER JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento 
             WHERE p.mp_payment_id = ? LIMIT 1`,
            [payment_id]
        );

        if (rows.length > 0 && rows[0].mp_access_token) {
            tokenMP = rows[0].mp_access_token;
        }

        if (!tokenMP) {
            tokenMP = process.env.MP_ACCESS_TOKEN;
        }

        // 2. Consulta no Mercado Pago
        const responseMP = await axios.get(
            `https://mercadopago.com{payment_id}`,
            {
                headers: {
                    'Authorization': `Bearer ${tokenMP}`
                }
            }
        );

        const mp_status = responseMP.data.status;

        // 3. Se aprovou no Mercado Pago, atualiza o pedido e garante a notificação para o Delphi
        if (mp_status === 'approved' && rows.length > 0) {
            const ped = rows[0];

            await executeQuery(
                "UPDATE pedido SET mp_status = 'approved' WHERE id_pedido = ?",
                [ped.id_pedido]
            );

            // Verifica se já existe notificação para não duplicar
            const notifExistente = await executeQuery(
                "SELECT id_notificacao FROM notificacoes WHERE id_pedido = ? AND tipo = 'CARDAPIO_DIGITAL' LIMIT 1",
                [ped.id_pedido]
            );

            if (notifExistente.length === 0) {
                const msg = `NOVO PEDIDO #${ped.id_pedido} (PIX PAGO)\nCliente: ${ped.nome_cliente}\nTotal: R$ ${Number(ped.vl_total).toFixed(2)}\nTipo: ${ped.local_consumo}`;
                await executeQuery(
                    `INSERT INTO notificacoes (id_usuario, mensagem, status, dt_criacao, id_estabelecimento, tipo, id_pedido)
                     VALUES (0, ?, 'A', NOW(), ?, 'CARDAPIO_DIGITAL', ?)`,
                    [msg, ped.id_estabelecimento, ped.id_pedido]
                );
            }
        }

        return res.status(200).json({
            mp_payment_id: payment_id,
            status: mp_status,
            pago: mp_status === 'approved'
        });

    } catch (error) {
        console.error("Erro ao consultar Pix no Mercado Pago:", error.response?.data || error.message);
        return res.status(500).json({ error: "Erro ao consultar status no Mercado Pago." });
    }
});



app.post("/pix/reembolsar", async function (req, res) {
    const { id_pedido } = req.body;

    // 1. Busca os dados do pedido junto com o token da loja dona dele
    const sqlSelect = `
        SELECT p.mp_payment_id, p.status, p.forma_pagamento, e.mp_access_token 
        FROM pedido p
        INNER JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
        WHERE p.id_pedido = ?`;
    
    db.query(sqlSelect, [id_pedido], async (err, result) => {
        if (err || result.length === 0) {
            return res.status(404).json({ error: "Pedido não localizado." });
        }

        const pedido = result[0];

        if (!pedido.mp_payment_id || !pedido.forma_pagamento.includes("PIX")) {
            return res.status(400).json({ error: "Este pedido não possui um pagamento Pix online associado para estornar." });
        }

        // Pega o token da loja ou o do .env como fallback
        const tokenMP = pedido.mp_access_token || process.env.MP_ACCESS_TOKEN;

        try {
            // 2. Chama a API de estorno do Mercado Pago com a chave da loja
            const responseMP = await axios.post(
                `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}/refunds`,
                {}, 
                {
                    headers: {
                        'Authorization': `Bearer ${tokenMP}`,
                        'X-Idempotency-Key': `refund-pedido-${id_pedido}`
                    }
                }
            );

            // 3. Atualiza o status do pedido no banco para Cancelado (C)
            const sqlUpdate = "UPDATE pedido SET status = 'C' WHERE id_pedido = ?";
            db.query(sqlUpdate, [id_pedido]);

            return res.status(200).json({
                sucesso: true,
                mensagem: "Pix reembolsado com sucesso para o cliente!",
                detalhes: responseMP.data
            });

        } catch (error) {
            console.error("Erro ao estornar Pix no Mercado Pago:", error.response?.data || error.message);
            return res.status(500).json({ 
                error: "Erro ao processar o reembolso no Mercado Pago.",
                detalhe: error.response?.data || error.message 
            });
        }
    });
});


async function recalcularEstoqueProduto(id_produto, id_estabelecimento) {
    const sql = `
        SELECT T.qtd_consumida, I.qtd_atual, P.unidade_medida
        FROM produto_ficha_tecnica T
        JOIN insumo I ON T.id_insumo = I.id_insumo
        JOIN produto P ON P.id_produto = T.id_produto
        WHERE T.id_produto = ? AND P.id_estabelecimento = ?
    `;

    const rows = await executeQuery(sql, [id_produto, id_estabelecimento]);
    if (rows.length === 0) {
        await executeQuery("UPDATE produto SET qtd = 0 WHERE id_produto = ?", [id_produto]);
        return 0;
    }

    const capacidades = rows.map(item => {
        const estoque = parseFloat(item.qtd_atual) || 0;
        const consome = parseFloat(item.qtd_consumida) || 0;
        return consome > 0 ? estoque / consome : 999999;
    });

    let estoqueReal = Math.min(...capacidades);
    estoqueReal = rows[0].unidade_medida === 'UN' ? Math.floor(estoqueReal) : parseFloat(estoqueReal.toFixed(3));

    await executeQuery("UPDATE produto SET qtd = ? WHERE id_produto = ?", [estoqueReal, id_produto]);
    return estoqueReal;
}

// =====================================================================
// ROTAS DE CONFIGURAÇÃO DE TAXAS E ZONAS DO MOTOBOY
// =====================================================================

const FATOR_ROTA = 1.0; // distância em linha reta x ruas reais. Ex: 1.25 para compensar curvas

function haversineMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

async function getMotoristaDoToken(req) {
    const r = await executeQuery(
        "SELECT * FROM motorista WHERE id_usuario = ? LIMIT 1", [req.id_usuario]
    );
    return r[0] || null;
}

function validarZona(b) {
    const lat = num(b.latitude), lng = num(b.longitude);
    const raio = parseInt(b.raio_metros, 10), valor = num(b.valor);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180)
        return "Coordenadas inválidas.";
    if (!Number.isInteger(raio) || raio < 100 || raio > 30000)
        return "Raio deve estar entre 100 m e 30 km.";
    if (valor === null || isNaN(valor) || valor < 1)
        return "Valor mínimo da zona é R$ 1,00.";
    return null;
}

// Regra única de cálculo (usada pelo cardápio)
function calcularFrete(m, zonas, estab, lat, lng) {
    const distKm = (haversineMetros(Number(estab.latitude), Number(estab.longitude), lat, lng) / 1000) * FATOR_ROTA;

    const porKm = (v) => round2(distKm * Number(v || 0));

    if (m.usa_zonas) {
        const hit = zonas
            .filter(z => haversineMetros(Number(z.latitude), Number(z.longitude), lat, lng) <= z.raio_metros)
            .sort((a, b) => a.raio_metros - b.raio_metros || a.valor - b.valor)[0];
        if (hit) return { valor: round2(Number(hit.valor)), origem: "zona", zona: hit.nome_zona || `Zona #${hit.id_zona}`, distancia_km: round2(distKm) };
        const v = m.fallback_modo === "KM" ? porKm(m.fallback_valor) : round2(Number(m.fallback_valor || 0));
        return { valor: v, origem: m.fallback_modo === "KM" ? "fallback_km" : "fallback_fixo", zona: null, distancia_km: round2(distKm) };
    }
    if (m.modo_cobranca === "FIXO")
        return { valor: round2(Number(m.valor_fixo || 0)), origem: "fixo", zona: null, distancia_km: round2(distKm) };
    return { valor: porKm(m.valor_km), origem: "km", zona: null, distancia_km: round2(distKm) };
}

// ---------- GET configuração + zonas (tela do motoboy) ----------
app.get("/motoboy/config", token.ValidateJWT, async function (req, res) {
    try {
        const m = await getMotoristaDoToken(req);
        if (!m) return res.status(404).json({ error: "Motorista não encontrado." });

        const estab = await executeQuery(
            "SELECT nome, latitude, longitude FROM estabelecimento WHERE id_estabelecimento = ?",
            [req.id_estabelecimento]
        );
        const zonas = await executeQuery(
            "SELECT id_zona, nome_zona, latitude, longitude, raio_metros, valor, ativo FROM motorista_rota_zona WHERE id_motorista = ? AND ativo = 1 ORDER BY id_zona",
            [m.id_motorista]
        );
        return res.status(200).json({
            config: {
                modo_cobranca: m.modo_cobranca, valor_km: m.valor_km, valor_fixo: m.valor_fixo,
                usa_zonas: !!m.usa_zonas, fallback_modo: m.fallback_modo, fallback_valor: m.fallback_valor
            },
            estabelecimento: estab[0] || null,
            zonas
        });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---------- PUT configuração ----------
app.put("/motoboy/config", token.ValidateJWT, async function (req, res) {
    try {
        const m = await getMotoristaDoToken(req);
        if (!m) return res.status(404).json({ error: "Motorista não encontrado." });

        const { modo_cobranca, valor_km, valor_fixo, usa_zonas, fallback_modo, fallback_valor } = req.body;
        if (!["KM", "FIXO"].includes(modo_cobranca)) return res.status(400).json({ error: "modo_cobranca inválido." });
        if (!["KM", "FIXO"].includes(fallback_modo)) return res.status(400).json({ error: "fallback_modo inválido." });

        if (usa_zonas) {
            if (num(fallback_valor) === null || num(fallback_valor) <= 0)
                return res.status(400).json({ error: "Informe o valor de contingência (fora das zonas)." });
            const qtd = await executeQuery("SELECT COUNT(*) AS n FROM motorista_rota_zona WHERE id_motorista = ? AND ativo = 1", [m.id_motorista]);
            if (qtd[0].n === 0) return res.status(400).json({ error: "Cadastre ao menos uma zona ou desative o modo por zonas." });
        } else if (modo_cobranca === "KM" && !(num(valor_km) > 0)) {
            return res.status(400).json({ error: "Informe o valor por km." });
        } else if (modo_cobranca === "FIXO" && !(num(valor_fixo) >= 1)) {
            return res.status(400).json({ error: "Valor fixo mínimo é R$ 1,00." });
        }

        await executeQuery(
            `UPDATE motorista SET modo_cobranca = ?, valor_km = ?, valor_fixo = ?, usa_zonas = ?,
             fallback_modo = ?, fallback_valor = ? WHERE id_motorista = ?`,
            [modo_cobranca, num(valor_km), num(valor_fixo), usa_zonas ? 1 : 0, fallback_modo, num(fallback_valor), m.id_motorista]
        );
        return res.status(200).json({ message: "Configuração salva com sucesso!" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---------- POST zona ----------
app.post("/motoboy/zonas", token.ValidateJWT, async function (req, res) {
    try {
        const m = await getMotoristaDoToken(req);
        if (!m) return res.status(404).json({ error: "Motorista não encontrado." });
        const erro = validarZona(req.body);
        if (erro) return res.status(400).json({ error: erro });

        const { nome_zona, latitude, longitude, raio_metros, valor } = req.body;
        const r = await executeQuery(
            `INSERT INTO motorista_rota_zona (id_motorista, nome_zona, latitude, longitude, raio_metros, valor)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [m.id_motorista, (nome_zona || "").trim().slice(0, 60) || null, latitude, longitude, parseInt(raio_metros, 10), valor]
        );
        return res.status(201).json({ id_zona: r.insertId, message: "Zona adicionada!" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---------- PUT zona ----------
app.put("/motoboy/zonas/:id", token.ValidateJWT, async function (req, res) {
    try {
        const m = await getMotoristaDoToken(req);
        if (!m) return res.status(404).json({ error: "Motorista não encontrado." });
        const erro = validarZona(req.body);
        if (erro) return res.status(400).json({ error: erro });

        const { nome_zona, latitude, longitude, raio_metros, valor } = req.body;
        const r = await executeQuery(
            `UPDATE motorista_rota_zona SET nome_zona = ?, latitude = ?, longitude = ?, raio_metros = ?, valor = ?
             WHERE id_zona = ? AND id_motorista = ?`,
            [(nome_zona || "").trim().slice(0, 60) || null, latitude, longitude, parseInt(raio_metros, 10), valor, req.params.id, m.id_motorista]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: "Zona não encontrada." });
        return res.status(200).json({ message: "Zona atualizada!" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---------- DELETE zona ----------
app.delete("/motoboy/zonas/:id", token.ValidateJWT, async function (req, res) {
    try {
        const m = await getMotoristaDoToken(req);
        if (!m) return res.status(404).json({ error: "Motorista não encontrado." });
        const r = await executeQuery(
            "DELETE FROM motorista_rota_zona WHERE id_zona = ? AND id_motorista = ?",
            [req.params.id, m.id_motorista]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: "Zona não encontrada." });
        return res.status(200).json({ message: "Zona removida!" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---------- PÚBLICO: frete para o cardápio digital ----------
// GET /cardapio_digital/:slug/frete?lat=-23.81&lng=-47.72
app.get("/cardapio_digital/:slug/frete", async function (req, res) {
    try {
        const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
        if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat e lng obrigatórios." });

        const est = await executeQuery(
            "SELECT id_estabelecimento, latitude, longitude, taxa_base, preco_km FROM estabelecimento WHERE slug = ?",
            [req.params.slug]
        );
        if (est.length === 0) return res.status(404).json({ error: "Estabelecimento não encontrado." });
        const estab = est[0];

        // motoboy ativo: online primeiro; senão o mais recente
        const mots = await executeQuery(
            `SELECT * FROM motorista WHERE id_estabelecimento = ?
             ORDER BY (status_trabalho = 'online') DESC, id_motorista DESC LIMIT 1`,
            [estab.id_estabelecimento]
        );
        const m = mots[0];
        const motoboyConfigurado = m && (m.usa_zonas || (m.modo_cobranca === "KM" ? num(m.valor_km) > 0 : num(m.valor_fixo) >= 0 && m.valor_fixo !== null));

        if (!motoboyConfigurado) {
            // compatibilidade: regra antiga do estabelecimento (taxa_base + preco_km)
            const km = (haversineMetros(Number(estab.latitude), Number(estab.longitude), lat, lng) / 1000) * FATOR_ROTA;
            const v = round2(Number(estab.taxa_base || 0) + km * Number(estab.preco_km || 0));
            return res.status(200).json({ valor: v, origem: "estabelecimento", zona: null, distancia_km: round2(km) });
        }

        const zonas = m.usa_zonas
            ? await executeQuery("SELECT * FROM motorista_rota_zona WHERE id_motorista = ? AND ativo = 1", [m.id_motorista])
            : [];
        return res.status(200).json(calcularFrete(m, zonas, estab, lat, lng));
    } catch (e) { return res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`API 99Burger rodando na porta ${port}`);
});






