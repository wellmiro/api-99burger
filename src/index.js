require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require("express");
const cors = require("cors");
const db = require("./config/database");

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

app.post("/login", function (req, res) {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: "Email e senha obrigatórios" });

    // SELECT agora com JOIN para buscar a logo da tabela estabelecimento
    const ssql = `
        SELECT u.id_usuario, u.nome, u.email, u.senha, u.tipo, u.status, 
               u.id_estabelecimento, u.dt_cadastro, e.logo as url_logo 
        FROM usuario u
        INNER JOIN estabelecimento e ON (e.id_estabelecimento = u.id_estabelecimento)
        WHERE u.email = ?`;
    
    db.query(ssql, [email], function (err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco" });
        
        if (result.length > 0) {
            const usuario = result[0];
            
            if (senha === usuario.senha) {
                // Gerando o Token (Mantido exatamente como estava)
                const token = jwt.sign({ 
                    id_usuario: usuario.id_usuario,
                    id_estabelecimento: usuario.id_estabelecimento 
                }, process.env.JWT_SECRET, { expiresIn: '24h' });

                // Retornando o JSON completo para o Delphi + o campo url_logo
                return res.status(200).json({
                    id_usuario: usuario.id_usuario,
                    nome: usuario.nome,
                    email: usuario.email,
                    tipo: usuario.tipo, 
                    status: usuario.status,
                    id_estabelecimento: usuario.id_estabelecimento,
                    dt_cadastro: usuario.dt_cadastro,
                    url_logo: usuario.url_logo, // <--- NOVO CAMPO ADICIONADO
                    token: token
                }); 
            } else {
                return res.status(401).json({ error: "Senha incorreta" });
            }
        } else {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }
    }); 
}); // <--- Fecha o app.post

app.post('/usuarios', token.ValidateJWT, (req, res) => {
    const { nome, email, senha, tipo } = req.body;
    const ssql = "INSERT INTO usuario (nome, email, senha, tipo, status) VALUES (?, ?, ?, ?, 'S')";
    db.query(ssql, [nome, email, senha, tipo || 'A'], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.status(201).json({ id_usuario: result.insertId });
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
            qtd: p.qtd,
            qtd_max: p.qtd_max,
            qtd_min: p.qtd_min,
            categoria: p.categoria,
            id_categoria: p.id_categoria
        }));

        return response.status(200).json(produtos);
    });
});


  app.get("/produtos", function (request, response) {
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
              c.descricao AS categoria,
              c.id_categoria
          FROM produto p
          JOIN produto_categoria c ON c.id_categoria = p.id_categoria
          ORDER BY c.ordem
      `;

      db.query(ssql, function (err, result) {
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
                  qtd: p.qtd,
                  qtd_max: p.qtd_max,
                  qtd_min: p.qtd_min,
                  categoria: p.categoria,
                  id_categoria: p.id_categoria
              }));
              return response.status(200).json(produtos);
          }
      });
  });


  // Atualizar produto
  app.put("/produtos/:id", token.ValidateJWT, function (req, res) {
    const id_produto = req.params.id;
    const id_estabelecimento = req.id_estabelecimento; // Vem do Token decodificado
    
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria } = req.body;

    // Garantir que preco >= 0
    preco = preco != null ? Math.max(0, parseFloat(preco)) : 0;

    // Garantir campos obrigatórios
    if (!nome || id_categoria == null) {
      return res.status(400).json({ error: "Campos obrigatórios: nome, preco, id_categoria" });
    }

    // Conversão segura
    qtd = qtd != null ? parseInt(qtd) : 0;
    qtd_max = qtd_max != null ? parseInt(qtd_max) : 0;
    qtd_min = qtd_min != null ? parseInt(qtd_min) : 0;
    descricao = descricao || "";
    url_foto = url_foto || "";

    // SQL com trava de segurança: id_produto + id_estabelecimento
    const ssql = `
      UPDATE produto
      SET 
        nome = ?,
        preco = ?,
        descricao = ?,
        url_foto = ?,
        qtd = ?,
        qtd_max = ?,
        qtd_min = ?,
        id_categoria = ?
      WHERE id_produto = ? AND id_estabelecimento = ?
    `;

    const params = [nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, id_produto, id_estabelecimento];

    db.query(ssql, params, function (err, result) {
      if (err) {
        console.error("Erro ao atualizar produto:", err);
        return res.status(500).json({ error: "Erro ao atualizar produto" });
      }

      // Se affectedRows for 0, significa que o produto não existe OU não pertence a essa empresa
      if (result.affectedRows === 0) {
        return res.status(403).json({ error: "Produto não encontrado ou acesso negado" });
      }

      return res.status(200).json({ message: "Produto atualizado com sucesso" });
    });
});


  // Endpoint para cadastrar produto
  app.post("/produtos", token.ValidateJWT, function (req, res) {
    const id_estabelecimento = req.id_estabelecimento; // Vem do Token decodificado
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria } = req.body;

    // Correção: parseFloat (tinha um erro de digitação no seu)
    preco = preco != null ? Math.max(0, parseFloat(preco)) : 0;

    if (!nome || id_categoria == null) {
        return res.status(400).json({ error: "Campos obrigatórios: nome, preco, id_categoria" });
    }

    // Conversão segura e tratamento de nulos
    qtd = qtd != null ? parseInt(qtd) : 0;
    qtd_max = qtd_max != null ? parseInt(qtd_max) : 20; // Valor padrão se vier vazio
    qtd_min = qtd_min != null ? parseInt(qtd_min) : 0;
    descricao = descricao || "";
    url_foto = url_foto || "";

    const ssql = `
        INSERT INTO produto 
            (nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, id_estabelecimento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, id_estabelecimento];

    db.query(ssql, params, function (err, result) {
        if (err) {
            console.error("Erro ao cadastrar produto:", err);
            return res.status(500).json({ error: "Erro ao cadastrar produto" });
        }
        return res.status(201).json({ 
            message: "Produto cadastrado com sucesso", 
            id_produto: result.insertId 
        });
    });
});


  // Deletar um produto pelo id
 app.delete("/produtos/:id", token.ValidateJWT, function (req, res) {
    const id_produto = req.params.id;
    const id_estabelecimento = req.id_estabelecimento; // Segurança!

    if (!id_produto) {
        return res.status(400).json({ error: "ID do produto é obrigatório" });
    }

    // Só deleta se o ID do produto bater E pertencer à empresa logada
    const sqlDelete = `
        DELETE FROM produto
        WHERE id_produto = ? AND id_estabelecimento = ?
    `;

    db.query(sqlDelete, [id_produto, id_estabelecimento], function (err, result) {
        if (err) {
            console.error("Erro ao deletar produto:", err);
            return res.status(500).json({ error: "Erro ao deletar produto" });
        }

        // Se ninguém foi deletado, ou o ID não existe ou o produto é de outro dono
        if (result.affectedRows === 0) {
            return res.status(403).json({ error: "Produto não encontrado ou acesso negado" });
        }

        return res.status(200).json({ message: "Produto deletado com sucesso" });
    });
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

 app.get("/pedidos", token.ValidateJWT, function (request, response) {
    // O ID vem do Token decodificado pelo middleware
    const id_est = request.id_estabelecimento; 

    let ssql = "select p.id_pedido, p.status, date_format(p.dt_pedido, '%d/%m/%Y %H:%i:%s') as dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.forma_pagamento, p.vl_total, ";
    ssql += "p.numero_mesa, p.numero_pessoas, p.local_consumo, "; // <-- ADICIONADO AQUI
    ssql += "count(i.id_item) as qtd_item, p.nome_cliente ";
    ssql += "from pedido p ";
    ssql += "join pedido_item i on i.id_pedido = p.id_pedido ";
    
    // Filtro pelo estabelecimento vindo do Token
    ssql += "where p.id_estabelecimento = ? "; 
    
    ssql += "group by p.id_pedido, p.status, p.forma_pagamento, p.dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.vl_total, p.nome_cliente, ";
    ssql += "p.numero_mesa, p.numero_pessoas, p.local_consumo "; // <-- ADICIONADO AO GROUP BY
    ssql += "order by p.id_pedido desc ";

    db.query(ssql, [id_est], function (err, result) {
        if (err) {
            return response.status(500).send(err);
        } else {
            return response.status(200).json(result);
        }
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
          JOIN usuario u ON u.id_usuario = p.id_usuario
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

app.get('/pedidos/historico/:slug', (req, res) => {
    const slug = req.params.slug;

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
        WHERE e.slug = ? 
        ORDER BY p.id_pedido DESC
    `;

    db.query(ssql, [slug], (err, result) => {
        if (err) {
            console.error('Erro ao buscar lista:', err);
            return res.status(500).json({ error: 'Erro interno' });
        }
        res.status(200).json(result);
    });
});

app.get('/pedidos/acompanhar/:id_pedido', (req, res) => {
    const idPedido = parseInt(req.params.id_pedido, 10);
 
    if (!idPedido || isNaN(idPedido)) {
        return res.status(400).json({ error: 'ID do pedido inválido' });
    }
 
    const ssql = `
        SELECT 
            p.id_pedido,
            p.nome_cliente,
            p.status,
            DATE_FORMAT(p.dt_pedido, '%d/%m/%Y %H:%i') AS dt_pedido,
            p.vl_subtotal,
            p.vl_entrega,
            p.vl_total,
            p.endereco_entrega,
            p.forma_pagamento,
            p.local_consumo
        FROM pedido p
        WHERE p.id_pedido = ?
    `;
 
    db.query(ssql, [idPedido], (err, result) => {
        if (err) {
            console.error('Erro ao buscar pedido:', err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
 
        if (result.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado' });
        }
 
        const pedido = result[0];
 
        // Busca os itens do pedido
        const ssqlItens = `
            SELECT 
                i.id_item,
                pr.nome AS nome_produto,
                pr.url_foto,
                i.qtd,
                i.vl_unitario,
                i.vl_total,
                i.observacao
            FROM pedido_item i
            JOIN produto pr ON pr.id_produto = i.id_produto
            WHERE i.id_pedido = ?
        `;
 
        db.query(ssqlItens, [idPedido], (err2, itens) => {
            if (err2) {
                console.error('Erro ao buscar itens:', err2);
                return res.status(500).json({ error: 'Erro ao buscar itens do pedido' });
            }
 
            return res.status(200).json({
                ...pedido,
                itens: itens
            });
        });
    });
});

  app.put('/usuarios/:id', token.ValidateJWT, (req, res) => {
    const { nome, email, tipo, senha } = req.body;
    const { id } = req.params;
    const id_estabelecimento = req.id_estabelecimento;

    // Campos que são OBRIGATÓRIOS (sem eles o banco chora)
    if (!nome || !email || !tipo) {
        return res.status(400).json({ error: 'Nome, E-mail e Tipo são obrigatórios!' });
    }

    let sql;
    let params;

    // Se a senha NÃO for vazia, atualiza ela também
    if (senha && senha.trim() !== '') {
        sql = `UPDATE usuario SET nome=?, email=?, senha=?, tipo=? 
               WHERE id_usuario = ? AND id_estabelecimento = ?`;
        params = [nome, email, tipo, senha, id, id_estabelecimento];
    end } else {
        // Se a senha for vazia, o SQL NÃO possui o campo senha. 
        // Assim, a senha antiga continua lá bonitinha.
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
          response.json(results);
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



  // DELETE /pedidos/:id_pedido
  app.delete("/pedidos/:id_pedido", token.ValidateJWT, function (request, response) {
      const idPedido = request.params.id_pedido;

      // 1) Deleta os itens do pedido primeiro (Garante integridade referencial)
      let sqlItens = "DELETE FROM pedido_item WHERE id_pedido = ?";
      db.query(sqlItens, [idPedido], function (err, result) {
          if (err) {
              return response.status(500).json({ error: err.message });
          }

          // 2) Deleta o pedido
          let sqlPedido = "DELETE FROM pedido WHERE id_pedido = ?";
          db.query(sqlPedido, [idPedido], function (err2, result2) {
              if (err2) {
                  return response.status(500).json({ error: err2.message });
              }

              return response.status(200).json({ 
                  message: "Pedido deletado com sucesso", 
                  id_pedido: idPedido 
              });
          });
      });
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

  app.post('/login', (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const sql = `
      SELECT id_usuario, nome, email, tipo, status, dt_cadastro, id_estabelecimento
      FROM usuario
      WHERE email = ? AND senha = ?
      LIMIT 1
    `;

    db.query(sql, [email, senha], (err, results) => {
      if (err) {
        console.error('Erro no DB /login:', err);
        return res.status(500).json({ error: 'Erro no banco' });
      }

      if (!results || results.length === 0) {
        return res.status(401).json({ error: 'Usuário ou senha inválidos' });
      }

      const usuario = results[0];

      // Criar token JWT
      // É uma boa prática incluir o id_estabelecimento no payload do token!
      const token = jwt.sign(
        {
          id_usuario: usuario.id_usuario,
          nome: usuario.nome,
          tipo: usuario.tipo,
          id_estabelecimento: usuario.id_estabelecimento // ⬅️ ADICIONADO AO JWT
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Retorno "flat"
      return res.status(200).json({
        id_usuario: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
        status: usuario.status,
        dt_cadastro: usuario.dt_cadastro,
        id_estabelecimento: usuario.id_estabelecimento, // ⬅️ ADICIONADO AO RETORNO JSON
        token: token
      });
    });
  } catch (e) {
    console.error('Erro /login try/catch:', e);
    return res.status(500).json({ error: 'Erro interno' });
  }
});



  // Retorna todas as notificações não lidas de um usuário
// 1. Retorna todas as notificações ativas ('A') do estabelecimento logado
app.get("/notificacoes", token.ValidateJWT, function (request, response) {
    const id_estabelecimento = request.id_estabelecimento; // Pega do Token

    // Mantivemos o status = 'A' como no teu original
    let ssql = "SELECT * FROM notificacoes WHERE status = 'A' AND id_estabelecimento = ? "; 

    db.query(ssql, [id_estabelecimento], function (err, result) {
        if (err) {
            return response.status(500).json({ error: err.message });
        } else {
            return response.status(200).json(result);
        }
    });
});

// 2. Marca todas as notificações do usuário logado como lidas ('L')
// Removi o :id_usuario da URL pois pegamos direto do Token por segurança
app.put('/notificacoes/:id_usuario', token.ValidateJWT, (req, res) => {
    const id_usuario_url = parseInt(req.params.id_usuario, 10);
    const id_estabelecimento = req.id_estabelecimento; // Pega do Token

    // O SQL agora protege para que o usuário só limpe as notificações 
    // do seu próprio ID e do seu próprio estabelecimento
    const sql = `
      UPDATE notificacoes
      SET status = 'L'
      WHERE id_usuario = ? AND id_estabelecimento = ? AND status = 'A'
    `;

    db.query(sql, [id_usuario_url, id_estabelecimento], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      return res.json({ 
        message: 'Notificações marcadas como lidas', 
        atualizadas: results.affectedRows 
      });
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

    // Removemos a obrigatoriedade. Se não vier, o sistema segue o fluxo.
    // Opcional: Você pode definir um padrão caso queira: const localConsumo = p.local_consumo || 'LOCAL';

    try {
        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const dtPedidoBrasilia = agora.toISOString().slice(0, 19).replace('T', ' ');

        const result = await new Promise((r, j) =>
            db.query(
                `INSERT INTO pedido 
                (id_usuario, id_estabelecimento, nome_cliente, vl_subtotal, vl_entrega, forma_pagamento, vl_total, numero_mesa, numero_pessoas, status, dt_pedido, endereco_entrega, observacao, dinheiro, troco, local_consumo)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    p.id_usuario, 
                    p.id_estabelecimento, 
                    p.nome_cliente || '-', 
                    p.vl_subtotal || 0,
                    p.vl_entrega || 0, 
                    p.forma_pagamento || null, 
                    p.vl_total || 0,
                    p.numero_mesa || null, 
                    p.numero_pessoas || null, 
                    'A',
                    dtPedidoBrasilia, 
                    p.endereco_entrega || null, 
                    p.observacao || null, 
                    p.dinheiro || 0, 
                    p.troco || 0, 
                    p.local_consumo || null // Se não vier, grava nulo ou o padrão do banco
                ],
                (err, res) => err ? j(err) : r(res)
            )
        );

        const idPedido = result.insertId;

        // Inserção dos itens (mantenha a lógica abaixo conforme seu código original)
        if (p.itens && p.itens.length > 0) {
            const itens = p.itens.map(i => [
                idPedido, i.id_produto, i.qtd, i.vl_unitario, i.vl_total, i.observacao || null
            ]);

            await new Promise((r, j) =>
                db.query(
                    `INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?`,
                    [itens],
                    err => err ? j(err) : r()
                )
            );
        }

        // Retornamos o id_pedido para que o Delphi possa usar se precisar
        res.status(201).json({ id_pedido: idPedido, message: "Pedido salvo com sucesso" });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/pedidos/:id/itens', token.ValidateJWT, async (req, res) => {
    const id_pedido = parseInt(req.params.id, 10);
    const { itens, id_estabelecimento } = req.body;

    // Validação básica apenas do que é necessário para a operação
    if (!id_pedido || !Array.isArray(itens) || !itens.length || !id_estabelecimento) {
        return res.status(400).json({ error: 'Dados incompletos para adicionar itens.' });
    }

    try {
        const valores = itens.map(i => [
            id_pedido, i.id_produto, i.qtd, i.vl_unitario, i.vl_total, i.observacao || null
        ]);

        // 1. Inserir os novos itens na tabela de itens
        await new Promise((resolve, reject) => {
            const sqlInserir = `INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?`;
            db.query(sqlInserir, [valores], (err, result) => err ? reject(err) : resolve(result));
        });

        // Somar o total dos novos itens
        const totalItensNovos = itens.reduce((acc, i) => acc + (Number(i.vl_total) || 0), 0);

        // 2. Atualizar o valor total na tabela pedido
        await new Promise((resolve, reject) => {
            const sqlAtualizaTotal = `
                UPDATE pedido
                SET vl_total = vl_total + ?
                WHERE id_pedido = ? AND id_estabelecimento = ?;
            `;
            db.query(sqlAtualizaTotal, [totalItensNovos, id_pedido, id_estabelecimento], (err) => err ? reject(err) : resolve());
        });

        // 3. Buscar dados atuais para retorno (sem travas de obrigatoriedade)
        const pedido = await new Promise((resolve, reject) => {
            db.query(
                "SELECT nome_cliente, vl_total, local_consumo FROM pedido WHERE id_pedido = ? AND id_estabelecimento = ?",
                [id_pedido, id_estabelecimento],
                (err, result) => err ? reject(err) : resolve(result[0])
            );
        });

        if (!pedido) {
            return res.status(404).json({ error: 'Pedido não localizado.' });
        }

        // Retorna o sucesso para o Delphi seguir com a vida (e com a impressão local)
        res.status(201).json({ 
            message: 'Itens adicionados com sucesso', 
            novo_total: pedido.vl_total,
            local: pedido.local_consumo 
        });

    } catch (err) {
        console.error("Erro ao adicionar itens:", err);
        res.status(500).json({ message: 'Erro interno', error: err.message });
    }
});

app.post('/pedidos/publico', async (req, res) => {
    const p = req.body;

    // Validação básica
    if (!p.slug) {
        return res.status(400).json({ error: 'Slug do estabelecimento é obrigatório' });
    }

    if (!p.nome_cliente || !p.itens || p.itens.length === 0) {
        return res.status(400).json({ error: 'Nome do cliente e itens são obrigatórios' });
    }

    try {
        // 1. Busca o id_estabelecimento pelo slug (igual o endpoint do cardápio digital faz)
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

        // 2. Calcula data/hora de Brasília (UTC-3), mesmo padrão do endpoint /pedidos
        const agora = new Date();
        agora.setHours(agora.getHours() - 3);
        const dtPedidoBrasilia = agora.toISOString().slice(0, 19).replace('T', ' ');

        // 3. Insere o pedido com TODAS as colunas necessárias
        const result = await new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO pedido 
                (id_usuario, id_estabelecimento, nome_cliente, vl_subtotal, vl_entrega, 
                 forma_pagamento, vl_total, status, dt_pedido, endereco_entrega, 
                 rota, observacao, local_consumo, dinheiro, troco)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    null,                           // id_usuario: NULL (pedido público, sem login)
                    id_estabelecimento,             // vem do slug
                    p.nome_cliente,
                    p.vl_subtotal || 0,
                    p.vl_entrega || 0,
                    p.forma_pagamento || 'A combinar',
                    p.vl_total || 0,
                    'A',                            // status: Aberto
                    dtPedidoBrasilia,
                    p.endereco_entrega || null,
                    p.rota || null,                 // link do Google Maps
                    p.observacao || null,
                    p.local_consumo || 'DELIVERY',
                    p.dinheiro || 0,
                    p.troco || 0
                ],
                (err, res) => err ? reject(err) : resolve(res)
            );
        });

        const idPedido = result.insertId;

        // 4. Insere os itens (com observacao)
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

        // 5. Sucesso!
        res.status(201).json({
            id_pedido: idPedido,
            message: 'Pedido realizado com sucesso!'
        });

    } catch (e) {
        console.error('Erro no /pedidos/publico:', e);
        res.status(500).json({ error: e.message });
    }
});


app.put("/pedidos/status/:id_pedido", token.ValidateJWT, (req, res) => {
  const id_pedido = req.params.id_pedido;
  const novoStatus = req.body.status; // ex: "F" (Finalizado), "P" (Produção), etc.

  if (!novoStatus) {
    return res.status(400).json({ erro: "É necessário informar o novo status" });
  }

  // Atualiza o status do pedido
  const sqlAtualizaStatus = "UPDATE pedido SET status = ? WHERE id_pedido = ?";
  db.query(sqlAtualizaStatus, [novoStatus, id_pedido], (err, result) => {
    if (err) {
      console.error("Erro ao atualizar status:", err);
      return res.status(500).json({ erro: "Falha ao atualizar status", fatal: true });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: "Pedido não encontrado" });
    }

    // Se o status for finalizado ("F"), baixa o estoque
    if (novoStatus === "F") {
      const sqlItens = "SELECT id_produto, qtd as quantidade FROM pedido_item WHERE id_pedido = ?";
      db.query(sqlItens, [id_pedido], (err2, itens) => {
        if (err2) {
          console.error("Erro ao buscar itens do pedido:", err2);
          return res.status(500).json({ erro: "Falha ao processar itens do pedido", fatal: true });
        }

        itens.forEach(item => {
          // Atualiza estoque do produto (usando GREATEST para não ficar negativo)
          const sqlAtualizaProduto = `
            UPDATE produto
            SET qtd = GREATEST(qtd - ?, 0)
            WHERE id_produto = ?
          `;
          db.query(sqlAtualizaProduto, [item.quantidade, item.id_produto], (err3, result3) => {
            if (err3) {
              console.error("Erro ao atualizar estoque do produto:", err3);
            }
          });
        });

        res.json({ sucesso: true, mensagem: "Status atualizado e estoque ajustado", id_pedido });
      });
    } else {
      res.json({ sucesso: true, mensagem: "Status atualizado com sucesso", id_pedido });
    }
  });
});

// Endpoint para o Cardápio Digital (Aberto ao público via SLUG)
app.get("/cardapio_digital/:id", function (request, response) {
    
    // O :id aqui agora será o SLUG (ex: cardapio-kadds-burguers)
    const slug = request.params.id;

    // SQL que busca os produtos filtrando pelo SLUG do estabelecimento
    let ssql = `
        SELECT 
            p.id_produto,
            p.nome,
            p.descricao,
            p.url_foto,
            p.preco,
            c.descricao AS categoria,
            c.id_categoria,
            e.nome as nome_estabelecimento,
            e.logo as url_logo
        FROM produto p
        JOIN produto_categoria c ON c.id_categoria = p.id_categoria
        JOIN estabelecimento e ON e.id_estabelecimento = p.id_estabelecimento
        WHERE e.slug = ? 
        ORDER BY c.ordem
    `;

    db.query(ssql, [slug], function (err, result) {
        if (err) {
            console.error("Erro ao buscar cardápio:", err);
            return response.status(500).json({ error: "Erro ao buscar cardápio" });
        }

        if (result.length === 0) {
            return response.status(404).json({ error: "Cardápio não encontrado" });
        }

        // Formatação dos dados para o React
        const produtos = result.map(p => ({
            id_produto: p.id_produto,
            nome: p.nome,
            descricao: p.descricao,
            url_foto: p.url_foto,
            preco: parseFloat(p.preco),
            categoria: p.categoria,
            id_categoria: p.id_categoria,
            nome_estabelecimento: p.nome_estabelecimento,
            url_logo: p.url_logo
        }));

        return response.status(200).json(produtos);
    }); 
});// <--- FECHA O app.get

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


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`API 99Burger rodando na porta ${port}`);
});
// v2