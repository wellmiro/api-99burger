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

app.post('/usuarios', (req, res) => {
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
        if (err) return res.status(500).json({ error: err.message });

        if (rows.length === 0) {
            return res.status(404).json({ message: "Nenhum dado encontrado." });
        }

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
    let ssql = "select p.id_pedido, p.status, date_format(p.dt_pedido, '%d/%m/%Y %H:%i:%s') as dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.forma_pagamento, p.vl_total, ";
    ssql += "p.numero_mesa, p.numero_pessoas, ";
    ssql += "count(i.id_item) as qtd_item, p.nome_cliente ";
    ssql += "from pedido p ";
    ssql += "join pedido_item i on i.id_pedido = p.id_pedido ";
    ssql += "group by p.id_pedido, p.status, p.forma_pagamento, p.dt_pedido, ";
    ssql += "p.vl_subtotal, p.vl_entrega, p.vl_total, p.nome_cliente, ";
    ssql += "p.numero_mesa, p.numero_pessoas ";
    ssql += "order by p.id_pedido desc ";

    db.query(ssql, function (err, result) {
        if (err) {
            return response.status(500).send(err);
        } else {
            return response.status(200).json(result);
        }
    });
});


  app.get("/pedidos/itens", function (request, response) {

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
          ORDER BY p.dt_pedido
      `;

      db.query(ssql, function (err, result) {
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

              // Adicionar os itens em cada pedido, agora com categoria
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
              p.endereco_entrega,
              u.nome AS nome_login,
              p.rota,
              p.vl_total
          FROM pedido p
          JOIN usuario u ON u.id_usuario = p.id_usuario
          ORDER BY p.dt_pedido
      `;

      db.query(ssql, function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              return response.status(200).json(result);
          }
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
  app.delete("/pedidos/:id_pedido", function (request, response) {
      const idPedido = request.params.id_pedido;

      // 1) Deleta os itens do pedido primeiro
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

              return response.status(200).json({ message: "Pedido deletado com sucesso", id_pedido: idPedido });
          });
      });
  });

  app.put("/pedidos/numero_pessoas/:id_pedido", function (request, response) {

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

  app.put("/pedidos/forma_pagamento/:id_pedido", function (request, response) {

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


  // Endpoint para atualizar o endereço de entrega
  app.put("/pedidos/endereco/:id_pedido", function (request, response) {

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


app.post('/pedidos/:id/atualizar_impressao', token.ValidateJWT, (req, res) => {
    const id_pedido = req.params.id;
    const id_estabelecimento = req.id_estabelecimento; // Segurança!
    const { numero_impressoes_desejadas, numero_impressoes_realizadas } = req.body;

    // O WHERE agora checa o ID do pedido E se ele pertence ao estabelecimento do Token
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
  app.get('/impressora', token.ValidateJWT, (req, res) => {
    const id_estabelecimento = req.id_estabelecimento;
    const selectSQL = 'SELECT id_impressora, tipo, ip FROM impressora WHERE id_estabelecimento = ?';
    
    db.query(selectSQL, [id_estabelecimento], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        return res.json(results);
    });
});

// PUT /impressora - Atualiza especificamente a impressora do dono do Token
app.put('/impressora', token.ValidateJWT, (req, res) => {
    const id_estabelecimento = req.id_estabelecimento;
    const { tipo, ip } = req.body;

    if (!tipo || !ip) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    // Filtra pelo id_estabelecimento vindo do JWT para segurança
    const updateSQL = 'UPDATE impressora SET tipo = ?, ip = ? WHERE id_estabelecimento = ?';
    
    db.query(updateSQL, [tipo, ip, id_estabelecimento], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Nenhuma impressora encontrada para este estabelecimento' });
        }

        // Busca o IP atualizado para confirmar
        const selectSQL = 'SELECT ip FROM impressora WHERE id_estabelecimento = ?';
        db.query(selectSQL, [id_estabelecimento], (err2, results) => {
            if (err2) return res.status(500).json({ error: err2.message });
            
            return res.json({
                message: 'Impressora atualizada',
                ip: results[0].ip
            });
        });
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


  app.post('/pedidos', async (req, res) => {
  const p = req.body;
  if (!p.id_usuario || !p.itens?.length) 
    return res.status(400).json({ error: 'Dados faltando' });

  try {
    const nomeCliente = p.nome_cliente?.trim() || '-';
    const enderecoEntrega = p.endereco_entrega || null;
    const dinheiro = p.dinheiro || 0;
    const troco = p.troco || 0;

    // Calcula hora de Brasília subtraindo 3 horas do NOW() do servidor
    const agora = new Date();
    agora.setHours(agora.getHours() - 3);
    const dtPedidoBrasilia = agora.toISOString().slice(0, 19).replace('T', ' ');

    // Inserção do pedido
    const result = await new Promise((r, j) =>
      db.query(
        `INSERT INTO pedido 
        (id_usuario, nome_cliente, vl_subtotal, vl_entrega, forma_pagamento, vl_total, numero_mesa, numero_pessoas, status, dt_pedido, endereco_entrega, dinheiro, troco)
        VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?, ?)`,
        [
          p.id_usuario,
          nomeCliente,
          p.vl_subtotal || 0,
          p.vl_entrega || 0,
          p.forma_pagamento || null,
          p.vl_total || 0,
          p.numero_mesa || null,
          p.numero_pessoas || null,
          'A',
          dtPedidoBrasilia,
          enderecoEntrega,
          dinheiro,
          troco
        ],
        (err, res) => err ? j(err) : r(res)
      )
    );

    const idPedido = result.insertId;

    // Inserção dos itens do pedido
    const itens = p.itens.map(i => [
      idPedido,
      i.id_produto,
      i.qtd,
      i.vl_unitario,
      i.vl_total,
      i.observacao || null
    ]);

    await new Promise((r, j) =>
      db.query(
        `INSERT INTO pedido_item (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) VALUES ?`,
        [itens],
        err => err ? j(err) : r()
      )
    );

    // Envio para impressora (se houver)
    const bodyImpressao = {
      id_pedido: idPedido,
      nome_cliente: nomeCliente,
      vl_total: p.vl_total,
      itens: p.itens.map(i => ({
        nome_produto: i.nome_produto,
        qtd: i.qtd,
        vl_unitario: i.vl_unitario,
        vl_total: i.vl_total,
        observacao: i.observacao || null
      })),
      endereco_entrega: enderecoEntrega,
      dinheiro,
      troco
    };

    try {
      await axios.post(`${PRINTER_SERVICE_URL}/imprimir`, bodyImpressao, { timeout: 10000 });
    } catch (e) { /* ignora erro de impressão */ }

    // Retorna apenas id_pedido e mensagem
    res.status(201).json({ id_pedido: idPedido, message: "Pedido cadastrado com sucesso" });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.post('/pedidos/:id/itens', async (req, res) => {
    const id_pedido = parseInt(req.params.id, 10);
    const itens = req.body.itens;

    if (!id_pedido || !Array.isArray(itens) || !itens.length) {
      return res.status(400).json({ error: 'ID do pedido e itens são obrigatórios' });
    }

    try {
      // Inserir itens no banco
      const valores = itens.map(i => [
        id_pedido,
        i.id_produto,
        i.qtd,
        i.vl_unitario,
        i.vl_total,
        i.observacao || null
      ]);

      await new Promise((resolve, reject) => {
        const sqlInserir = `INSERT INTO pedido_item 
          (id_pedido, id_produto, qtd, vl_unitario, vl_total, observacao) 
          VALUES ?`;
        db.query(sqlInserir, [valores], (err, result) => err ? reject(err) : resolve(result));
      });

      // Soma apenas os itens adicionados neste POST
      const totalItensNovos = itens.reduce((acc, i) => acc + (i.vl_total || 0), 0);

      // Atualiza o vl_total do pedido
      await new Promise((resolve, reject) => {
        const sqlAtualizaTotal = `
          UPDATE pedido
          SET vl_total = vl_total + ?
          WHERE id_pedido = ?;
        `;
        db.query(sqlAtualizaTotal, [totalItensNovos, id_pedido], (err) => err ? reject(err) : resolve());
      });

      // Buscar dados atualizados do pedido
      const pedido = await new Promise((resolve, reject) => {
        db.query(
          "SELECT nome_cliente, vl_total FROM pedido WHERE id_pedido = ?",
          [id_pedido],
          (err, result) => err ? reject(err) : resolve(result[0])
        );
      });

      // Montar corpo para impressão apenas dos itens adicionados
      const bodyImpressaoItens = {
        nome_cliente: pedido.nome_cliente || "-",
        itens: await Promise.all(itens.map(async i => {
          const produto = await new Promise((resolve, reject) => {
            db.query(
              "SELECT nome FROM produto WHERE id_produto = ?",
              [i.id_produto],
              (err, result) => err ? reject(err) : resolve(result[0])
            );
          });

          return {
            nome_produto: produto ? produto.nome : `Produto ${i.id_produto}`,
            qtd: i.qtd,
            vl_unitario: i.vl_unitario,
            vl_total: i.vl_total,
            observacao: i.observacao || null
          };
        }))
      };

      // 🔹 Chamar endpoint de impressão de itens no printer service usando IP fixo
      try {
        console.log('Corpo enviado para impressão:', JSON.stringify(bodyImpressaoItens, null, 2));
        await axios.post(`${PRINTER_SERVICE_URL}/imprimir/itens`, bodyImpressaoItens);
        console.log(`🖨 Itens recém-adicionados do pedido ${id_pedido} enviados para impressão`);
      } catch (printErr) {
        console.error('Erro ao imprimir itens:', printErr.message);
      }

      res.status(201).json({
        message: 'Itens adicionados com sucesso, total atualizado e itens enviados para impressão',
        total_itens_novos: totalItensNovos
      });

    } catch (err) {
      console.error('Erro ao adicionar itens:', err);
      res.status(500).json({ message: 'Erro ao adicionar itens', error: err.message });
    }
  });


app.put("/pedidos/status/:id_pedido", (req, res) => {
  const id_pedido = req.params.id_pedido;
  const novoStatus = req.body.status; // a letra nova do status, ex: "F" ou "A"

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
          // Atualiza estoque do produto
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


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`API 99Burger rodando na porta ${port}`);
});
