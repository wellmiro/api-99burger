
  require('dotenv').config();
  console.log('CWD:', process.cwd());
  console.log('JWT_SECRET:', process.env.JWT_SECRET);

  const jwt = require('jsonwebtoken');
  const express = require("express");
  const cors = require("cors");
  const db = require("./config/database");
  const fetch = require('node-fetch');
  const res = require("express/lib/response");
  const axios = require('axios'); // ✅ adicione isso

  const app = express();

  const PRINTER_SERVICE_URL = 'https://strong-dragons-leave.loca.lt';

  // Middleware JSON
  app.use(express.json());

  // Middleware CORS
  app.use(cors());

  /*
      Verbos HTTP:
      --------------------------
      GET -> Retornar dados
      POST -> Cadastrar dados
      PUT -> Editar dados
      PATCH -> Editar dados
      DELETE -> Excluir dados
  */

  /*
      Status Code:
      --------------------------
      200 -> Retornar OK
      201 -> Inserido com sucesso
      400 -> Erro (cliente)
      401 -> Não autorizado
      404 -> Não encontrado
      500 -> Erro (servidor)
  */

  // ✅ libera o acesso às pastas de atualização
  app.use('/update/desktop', express.static('C:/99burger/desktop'));
  app.use('/update/mobile', express.static('C:/99burger/mobile'));

  app.get("/versao", function (request, response) {
      const ssql = `
          SELECT 
              plataforma,
              numero_versao
          FROM versao
      `;

      db.query(ssql, function (err, result) {
          if (err) {
              console.error("Erro ao buscar versões:", err);
              return response.status(500).send(err);
          } else {
              const versoes = {};
              result.forEach(v => versoes[v.plataforma] = v.numero_versao);
              return response.status(200).json(versoes);
          }
      });
  });

  app.put("/versao/:plataforma", function (req, res) {
  const { plataforma } = req.params;
  const { versao } = req.body;

  if (!plataforma || !versao) {
    return res.status(400).json({ erro: "É necessário informar a plataforma e a versão." });
  }

  if (plataforma !== "desktop" && plataforma !== "mobile") {
    return res.status(400).json({ erro: "Plataforma inválida. Use 'desktop' ou 'mobile'." });
  }

  const ssql = `
    UPDATE versao 
    SET numero_versao = ?, data_atualizacao = NOW() 
    WHERE plataforma = ?
  `;

  db.query(ssql, [versao, plataforma], function (err, result) {
    if (err) {
      console.error("Erro ao atualizar versão:", err);
      return res.status(500).json({ erro: "Erro ao atualizar versão.", detalhes: err });
    }

    return res.status(200).json({
      plataforma,
      versao,
      mensagem: `Versão ${plataforma} atualizada com sucesso para ${versao}`,
    });
  });
});


  // Rotas
  // GET: listar produtos do cardápio com qtd_min e qtd_max
  app.get("/produtos/cardapio", function (request, response) {
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
  app.put("/produtos/:id", function (req, res) {
    const id_produto = req.params.id;
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria } = req.body;

    // Garantir que preco >= 0
    preco = preco != null ? Math.max(0, parseFloat(preco)) : 0;

    // Garantir campos obrigatórios
    if (!nome || id_categoria == null) {
      return res.status(400).json({ error: "Campos obrigatórios: nome, preco, id_categoria" });
    }

    // Conversão segura dos números
    qtd = qtd != null ? parseInt(qtd) : 0;
    qtd_max = qtd_max != null ? parseInt(qtd_max) : 0;
    qtd_min = qtd_min != null ? parseInt(qtd_min) : 0;
    descricao = descricao || "";
    url_foto = url_foto || "";

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
      WHERE id_produto = ?
    `;

    const params = [nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria, id_produto];

    db.query(ssql, params, function (err, result) {
      if (err) {
        console.error("Erro ao atualizar produto:", err);
        return res.status(500).json({ error: "Erro ao atualizar produto" });
      }
      return res.status(200).json({ message: "Produto atualizado com sucesso", result });
    });
  });


  // Endpoint para cadastrar produto
  app.post("/produtos", function (req, res) {
    let { nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria } = req.body;

    // Garantir que preco >= 0
    preco = preco != null ? Math.max(0, parseFloat(preco)) : 0;

    // Garantir campos obrigatórios
    if (!nome || id_categoria == null) {
      return res.status(400).json({ error: "Campos obrigatórios: nome, preco, id_categoria" });
    }

    qtd = qtd != null ? parseInt(qtd) : 0;
    qtd_max = qtd_max != null ? parseInt(qtd_max) : 0;
    qtd_min = qtd_min != null ? parseInt(qtd_min) : 0;
    descricao = descricao || "";
    url_foto = url_foto || "";

    const ssql = `
      INSERT INTO produto 
        (nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [nome, preco, descricao, url_foto, qtd, qtd_max, qtd_min, id_categoria];

    db.query(ssql, params, function (err, result) {
      if (err) {
        console.error("Erro ao cadastrar produto:", err);
        return res.status(500).json({ error: "Erro ao cadastrar produto" });
      }
      return res.status(201).json({ message: "Produto cadastrado com sucesso", result });
    });
  });


  // Deletar um produto pelo id
  app.delete("/produtos/:id", function (req, res) {
      const id_produto = req.params.id;

      if (!id_produto) {
          return res.status(400).json({ error: "ID do produto é obrigatório" });
      }

      const sqlDelete = `
          DELETE FROM produto
          WHERE id_produto = ?
      `;

      db.query(sqlDelete, [id_produto], function (err, result) {
          if (err) {
              console.error("Erro ao deletar produto:", err);
              return res.status(500).json({ error: "Erro ao deletar produto" });
          }

          if (result.affectedRows === 0) {
              return res.status(404).json({ error: "Produto não encontrado" });
          }

          return res.status(200).json({ message: "Produto deletado com sucesso" });
      });
  });


  app.get("/produtos/cardapio/opcoes/:id_produto", function (req, res) {
      const id_produto = parseInt(req.params.id_produto, 10);

      if (!id_produto) 
          return res.status(400).json({ error: "ID do produto inválido." });

      const ssql = `
          SELECT 
              o.id_opcao,
              o.id_produto,
              o.descricao,
              o.ind_obrigatorio,
              o.qtd_max_escolha,
              o.ind_ativo,
              o.ordem,
              i.id_item,
              i.nome_item,
              i.descricao AS descricao_item,
              i.vl_item
          FROM produto_opcao o
          LEFT JOIN produto_opcao_item i 
              ON i.id_opcao = o.id_opcao
          WHERE o.id_produto = ?
          ORDER BY o.ordem, i.ordem
      `;

      db.query(ssql, [id_produto], function (err, result) {
          if (err) {
              console.error(err);
              return res.status(500).json({ error: err.message });
          }

          // Aqui já mapeamos direto pro formato esperado
          const linhas = result.map(row => ({
              id_opcao: row.id_opcao,
              id_produto: row.id_produto,
              descricao: row.descricao,
              ind_obrigatorio: row.ind_obrigatorio,
              qtd_max_escolha: row.qtd_max_escolha,
              ind_ativo: row.ind_ativo,
              ordem: row.ordem,
              id_item: row.id_item,
              nome_item: row.nome_item,
              descricao_item: row.descricao_item || "",
              vl_item: row.vl_item ? parseFloat(row.vl_item) : 0
          }));

          res.status(200).json(linhas);
      });
  });

  // app.post("/produtos/opcoes") - REVISADO PARA CRIAR GRUPO OU ADICIONAR ITEM
  app.post("/produtos/opcoes", function (req, res) {
      const { 
          id_opcao, // <-- Campo crucial que o front-end envia para "adicionar item"
          id_produto, 
          descricao, 
          ind_obrigatorio = 'N',
          qtd_max_escolha = 1, 
          ind_ativo = 'S', 
          ordem = 1, 
          itens = [] 
      } = req.body;

      // --- LÓGICA 1: ADICIONAR ITEM A UM GRUPO EXISTENTE ---
      if (id_opcao) {
          // Validação
          if (!id_opcao || !id_produto || !itens || itens.length === 0) {
              return res.status(400).json({ 
                  error: "Dados incompletos para adicionar item: id_opcao, id_produto e pelo menos um item são obrigatórios." 
              });
          }

          // Monta os inserts dos novos itens para o id_opcao existente
          const sqlItem = `
              INSERT INTO produto_opcao_item 
                  (id_opcao, nome_item, descricao, vl_item, ordem)
              VALUES ?
          `;

          const valores = itens.map((item, index) => [
              id_opcao, // Usa o ID do grupo existente
              item.nome_item,
              item.descricao_item || "",
              item.vl_item || 0,
              index + 1 // Ordem automática (Pode precisar de uma lógica mais robusta se a ordem for importante)
          ]);

          db.query(sqlItem, [valores], function (err) {
              if (err) {
                  console.error(err);
                  return res.status(500).json({ 
                      error: "Erro ao adicionar item ao grupo existente.", 
                      details: err.message 
                  });
              }

              res.status(201).json({ 
                  message: "Item(s) adicionado(s) ao grupo com sucesso!", 
                  id_opcao 
              });
          });
          return; // Termina a execução aqui, pois o item foi adicionado
      }

      // --- LÓGICA 2: CRIAR NOVO GRUPO (OPÇÃO) ---
      
      // Validação básica para criação de grupo
      if (!id_produto || !descricao) {
          return res.status(400).json({ error: "Campos obrigatórios para criar grupo: id_produto e descricao" });
      }

      // SQL para inserir na tabela produto_opcao
      const sqlOpcao = `
          INSERT INTO produto_opcao 
              (id_produto, descricao, ind_obrigatorio, qtd_max_escolha, ind_ativo, ordem)
          VALUES (?, ?, ?, ?, ?, ?)
      `;

      db.query(sqlOpcao, [id_produto, descricao, ind_obrigatorio, qtd_max_escolha, ind_ativo, ordem], function (err, result) {
          if (err) {
              console.error(err);
              return res.status(500).json({ error: "Erro ao inserir grupo de opção", details: err.message });
          }

          const new_id_opcao = result.insertId; // pega o id gerado do novo grupo

          // Se não tiver itens, só retorna sucesso
          if (!itens || itens.length === 0) {
              return res.status(201).json({ message: "Grupo criado com sucesso!", id_opcao: new_id_opcao });
          }

          // Monta os inserts dos itens para o novo grupo
          const sqlItem = `
              INSERT INTO produto_opcao_item 
                  (id_opcao, nome_item, descricao, vl_item, ordem)
              VALUES ?
          `;

          const valores = itens.map((item, index) => [
              new_id_opcao, // Usa o novo ID gerado
              item.nome_item,
              item.descricao_item || "",
              item.vl_item || 0,
              index + 1
          ]);

          db.query(sqlItem, [valores], function (err2) {
              if (err2) {
                  console.error(err2);
                  return res.status(500).json({ 
                      error: "Erro ao inserir itens do grupo", 
                      details: err2.message 
                  });
              }

              res.status(201).json({ 
                  message: "Grupo e itens criados com sucesso!", 
                  id_opcao: new_id_opcao 
              });
          });
      });
  });

  // DELETE - excluir grupo de produto
  app.delete("/produtos/opcoes/:id_opcao", function (req, res) {
      const id_opcao = parseInt(req.params.id_opcao, 10);

      if (!id_opcao) {
          return res.status(400).json({ error: "ID do grupo inválido." });
      }

      // Primeiro excluímos os itens relacionados
      const sqlExcluirItens = "DELETE FROM produto_opcao_item WHERE id_opcao = ?";
      db.query(sqlExcluirItens, [id_opcao], function (err, resultItens) {
          if (err) {
              console.error(err);
              return res.status(500).json({ error: err.message });
          }

          // Depois excluímos o próprio grupo
          const sqlExcluirGrupo = "DELETE FROM produto_opcao WHERE id_opcao = ?";
          db.query(sqlExcluirGrupo, [id_opcao], function (err, resultGrupo) {
              if (err) {
                  console.error(err);
                  return res.status(500).json({ error: err.message });
              }

              res.status(200).json({ message: "Grupo e itens excluídos com sucesso!" });
          });
      });
  });

  app.get("/pedidos", function (request, response) {
      let ssql = "select p.id_pedido, p.status, date_format(p.dt_pedido, '%d/%m/%Y %H:%i:%s') as dt_pedido, ";
      ssql += "p.vl_subtotal, p.vl_entrega, p.forma_pagamento, p.vl_total, ";
      ssql += "p.numero_mesa, p.numero_pessoas, "; // 👈 Adiciona aqui
      ssql += "count(i.id_item) as qtd_item, p.nome_cliente ";
      ssql += "from pedido p ";
      ssql += "join pedido_item i on i.id_pedido = p.id_pedido ";
      ssql += "group by p.id_pedido, p.status, p.forma_pagamento, p.dt_pedido, ";
      ssql += "p.vl_subtotal, p.vl_entrega, p.vl_total, p.nome_cliente, ";
      ssql += "p.numero_mesa, p.numero_pessoas "; // 👈 Adiciona também no GROUP BY
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


  app.get("/pedidos/resumo", function (request, response) {
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
              u.nome AS nome_login,  -- 🔁 corrigido aqui
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

  app.put("/usuarios/:id_usuario", function (request, response) {
      const id_usuario = request.params.id_usuario;
      const { nome, email, senha, tipo } = request.body;

      // Primeiro, busca a senha atual caso não seja enviada
      const getSenhaSQL = `SELECT senha FROM usuario WHERE id_usuario = ?`;
      db.query(getSenhaSQL, [id_usuario], function (err, result) {
          if (err) return response.status(500).send(err);
          if (result.length === 0) return response.status(404).json({ message: "Usuário não encontrado" });

          const senhaAtual = result[0].senha;
          const novaSenha = (senha && senha.trim() !== "") ? senha : senhaAtual;

          // Atualiza os campos
          const updateSQL = `
              UPDATE usuario
              SET nome = ?, email = ?, senha = ?, tipo = ?
              WHERE id_usuario = ?
          `;

          db.query(updateSQL, [nome, email, novaSenha, tipo, id_usuario], function (err2) {
              if (err2) return response.status(500).send(err2);

              return response.status(200).json({ message: "Usuário atualizado com sucesso" });
          });
      });
  });


  app.get("/pedidos/itens_lista", function (request, response) {
      let ssql = `
          SELECT 
              p.id_pedido,
              p.numero_mesa,
              p.nome_cliente,
              p.numero_pessoas,         -- Adicionado aqui
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


  app.get('/categorias', (request, response) => {
      let ssql = "SELECT id_categoria, descricao, ordem, url_icone ";
      ssql += "FROM produto_categoria ";
      ssql += "ORDER BY ordem";

      db.query(ssql, function (err, result) {
          if (err) {
              return response.status(500).send(err);
          } else {
              let categorias = result.map((cat) => {
                  return {
                      id_categoria: cat.id_categoria,
                      descricao: cat.descricao,
                      ordem: cat.ordem,
                      url_icone: cat.url_icone
                  };
              });

              return response.status(200).json(categorias);
          }
      });
  });

  // POST /categorias - Cadastrar nova categoria
  app.post('/categorias', (req, res) => {
      const { descricao, ordem, url_icone } = req.body;

      // Validação básica
      if (!descricao || ordem == null || !url_icone) {
          return res.status(400).json({ error: 'Campos obrigatórios faltando: descricao, ordem, url_icone' });
      }

      const ssql = 'INSERT INTO produto_categoria (descricao, ordem, url_icone) VALUES (?, ?, ?)';
      db.query(ssql, [descricao, ordem, url_icone], (err, result) => {
          if (err) {
              return res.status(500).json({ error: err.message });
          } else {
              return res.status(201).json({
                  id_categoria: result.insertId,
                  descricao,
                  ordem,
                  url_icone,
                  message: 'Categoria cadastrada com sucesso'
              });
          }
      });
  });

  // PUT /categorias/:id - Atualizar categoria
  app.put('/categorias/:id', (req, res) => {
      const { id } = req.params;
      const { descricao, ordem, url_icone } = req.body;

      // Validação básica
      if (!descricao || ordem == null || !url_icone) {
          return res.status(400).json({ error: 'Campos obrigatórios faltando: descricao, ordem, url_icone' });
      }

      const ssql = 'UPDATE produto_categoria SET descricao = ?, ordem = ?, url_icone = ? WHERE id_categoria = ?';
      db.query(ssql, [descricao, ordem, url_icone, id], (err, result) => {
          if (err) {
              return res.status(500).json({ error: err.message });
          }
          if (result.affectedRows === 0) {
              return res.status(404).json({ error: 'Categoria não encontrada' });
          }
          return res.status(200).json({
              id_categoria: id,
              descricao,
              ordem,
              url_icone,
              message: 'Categoria atualizada com sucesso'
          });
      });
  });

  // DELETE /categorias/:id - Apagar categoria
  app.delete('/categorias/:id', (req, res) => {
      const { id } = req.params;

      const ssql = 'DELETE FROM produto_categoria WHERE id_categoria = ?';
      db.query(ssql, [id], (err, result) => {
          if (err) {
              return res.status(500).json({ error: err.message });
          }
          if (result.affectedRows === 0) {
              return res.status(404).json({ error: 'Categoria não encontrada' });
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

  app.get("/usuarios/:id_usuario", (req, res) => {
      const id_usuario = req.params.id_usuario;

      const sql = 'SELECT id_usuario, nome, email, status, dt_cadastro FROM usuario WHERE id_usuario = ?';
      db.query(sql, [id_usuario], (err, result) => {
          if (err) return res.status(500).json({ error: 'Erro no banco' });
          if (result.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
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
      const { nome, email, senha } = req.body;
      if (!nome || !email || !senha) return res.status(400).json({ error: 'Campos obrigatórios faltando' });

      const sql = 'INSERT INTO usuario (nome, email, senha, dt_cadastro, status) VALUES (?, ?, ?, NOW(), "A")';
      db.query(sql, [nome, email, senha], (err, result) => {
          if (err) return res.status(500).json({ error: 'Erro ao cadastrar usuário' });
          res.status(201).json({ id_usuario: result.insertId, nome, email, status: 'A' });
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
app.get("/notificacoes", function (request, response) {
    // O segredo está nas ASPAS SIMPLES ao redor do A: 'A'
    let ssql = "SELECT * FROM notificacoes WHERE status = 'A' "; 

    db.query(ssql, function (err, result) {
        if (err) {
            return response.status(500).json({ error: err.message });
        } else {
            return response.status(200).json(result);
        }
    });
});


  // Marca todas as notificações de um usuário como lidas
  app.put('/notificacoes/:id_usuario', (req, res) => {
    const id_usuario = parseInt(req.params.id_usuario, 10);

    if (!id_usuario) {
      return res.status(400).json({ error: 'id_usuario é obrigatório' });
    }

    const sql = `
      UPDATE notificacoes
      SET status = 'L'
      WHERE id_usuario = ? AND status = 'N'
    `;

    db.query(sql, [id_usuario], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      return res.json({ 
        message: 'Notificações marcadas como lidas', 
        atualizadas: results.affectedRows 
      });
    });
  });


  app.post('/pedidos/:id/atualizar_impressao', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { numero_impressoes_desejadas, numero_impressoes_realizadas } = req.body;

    if (!id || numero_impressoes_desejadas == null || numero_impressoes_realizadas == null)
      return res.status(400).json({ error: 'Campos obrigatórios' });

    db.query(
      `UPDATE pedido SET numero_impressoes_desejadas=?, numero_impressoes_realizadas=? WHERE id_pedido=?`,
      [numero_impressoes_desejadas, numero_impressoes_realizadas, id],
      (err) => err ? res.status(500).json({ error: err.message }) : res.json({ message: 'Atualizado' })
    );
  });

  // Adicionar ou atualizar impressora
  app.post('/impressora', (req, res) => {
    const { tipo, ip } = req.body;

    if (!tipo || !ip) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const insertSQL = 'INSERT INTO impressora (ip, tipo) VALUES (?, ?)';
    db.query(insertSQL, [ip, tipo], (err) => {
      if (err) return res.status(500).json({ error: err.message });

      return res.json({ message: 'Impressora registrada' });
    });
  });

  // GET /impresora
  app.get('/impressora', (req, res) => {
    const selectSQL = 'SELECT id_impressora, tipo, ip FROM impressora';
    
    db.query(selectSQL, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      return res.json(results);
    });
  });

  // PUT /impresora
  // PUT /impresora
  // PUT /impresora
  app.put('/impressora', (req, res) => {
    const { tipo, ip } = req.body;

    if (!tipo || !ip) {
      return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    const updateSQL = 'UPDATE impressora SET tipo = ?, ip = ? LIMIT 1';
    db.query(updateSQL, [tipo, ip], (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // retorna só o IP atualizado
      const selectSQL = 'SELECT ip FROM impressora LIMIT 1';
      db.query(selectSQL, (err2, results) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (results.length === 0) return res.status(404).json({ error: 'Impressora não encontrada' });

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

  app.listen(3000, '0.0.0.0', function () {
      console.log("Servidor executando na porta 3000");
  });
