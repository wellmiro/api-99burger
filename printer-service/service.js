// printer-service/service.js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
app.use(express.json());
app.use(cors());

const CUPOM_PATH = path.join(__dirname, "cupom.txt");

// Função utilitária para pegar data/hora formatada
function getDataHora() {
  const agora = new Date();
  return agora.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

// Função para criar cupom de PEDIDO completo
// Função para criar cupom de PEDIDO completo
function criarCupomPedido(pedido) {
  let texto = "";

  // cabeçalho com número do pedido
  texto += `PEDIDO Nº ${pedido.id_pedido || "-"}\n`;

  // data e hora
  texto += `Data/Hora: ${getDataHora()}\n\n`;

  // cliente
  texto += `Cliente: ${pedido.nome_cliente || "-"}\n`;

  // endereço (aparece só se tiver valor)
  if (pedido.endereco_entrega && pedido.endereco_entrega.trim() !== "") {
    texto += `Endereço: ${pedido.endereco_entrega.trim()}\n\n`;
  } else {
    texto += "\n";
  }

  // itens
  texto += "Itens:\n";

  let subtotal = 0;

  pedido.itens.forEach((item) => {
    const qtd = `(${item.qtd})`.padEnd(4);
    const nome =
      (item.nome_produto || item.nome || `Produto ${item.id_produto}`).padEnd(
        18
      );
    const valor = `R$ ${Number(
      item.vl_total || item.qtd * item.vl_unitario || 0
    )
      .toFixed(2)
      .padStart(6)}`;

    texto += `${qtd}${nome}${valor}\n`;

    if (item.observacao && item.observacao.trim() !== "") {
      texto += `  ${item.observacao.trim()}\n`;
    }

    subtotal += Number(
      item.vl_total || item.qtd * item.vl_unitario || 0
    );
  });

  texto += "------------------------------\n";

  let entrega = Number(pedido.vl_entrega || 0);
  let total = Number(pedido.vl_total || subtotal + entrega);

  texto += `SUBTOTAL:`.padEnd(22) + `R$ ${subtotal.toFixed(2).padStart(6)}\n`;
  texto += `TAXA ENTREGA:`.padEnd(20) + `+ R$ ${entrega.toFixed(2).padStart(6)}\n`;
  texto += `TOTAL:`.padEnd(22) + `R$ ${total.toFixed(2).padStart(6)}\n`;
  texto += "------------------------------\n";

  // forma de pagamento + dinheiro + troco
  if (pedido.forma_pagamento) {
    texto += `Pagamento: ${String(pedido.forma_pagamento).trim()}`;
    if (pedido.dinheiro && Number(pedido.dinheiro) > 0) {
      texto += ` / R$ ${Number(pedido.dinheiro).toFixed(2).padStart(6)}\n`;
    } else {
      texto += `\n`;
    }
  }

  if (pedido.troco && Number(pedido.troco) > 0) {
    texto += `Troco:`.padEnd(22) + `R$ ${Number(pedido.troco)
      .toFixed(2)
      .padStart(6)}\n`;
  }

  fs.writeFileSync(CUPOM_PATH, texto, { encoding: "utf8" });
  console.log(`Arquivo ${CUPOM_PATH} criado/atualizado.`);
}



// Função para criar cupom apenas com os itens
function criarCupomItens(pedido) {
  let texto = "ITENS DO PEDIDO\n";

  // data e hora
  texto += `Data/Hora: ${getDataHora()}\n\n`;

  let subtotal = 0;

  pedido.itens.forEach(item => {
    const qtd = `(${item.qtd})`.padEnd(5, " ");
    const nome = (item.nome_produto || item.nome || `Produto ${item.id_produto}`).padEnd(20, " ");
    const valor = `R$ ${Number(item.vl_total || (item.qtd * item.vl_unitario) || 0).toFixed(2)}`;
    texto += `${qtd}${nome}${valor}\n`;

    if (item.observacao && item.observacao.trim() !== "") {
      texto += `  ${item.observacao.trim()}\n`;
    }

    subtotal += Number(item.vl_total || (item.qtd * item.vl_unitario) || 0);
  });

  texto += "-----------------------\n";
  texto += `TOTAL ITENS:`.padEnd(15) + `R$ ${subtotal.toFixed(2)}\n`;

  fs.writeFileSync(CUPOM_PATH, texto, { encoding: "utf8" });
  console.log(`Arquivo ${CUPOM_PATH} com itens criado/atualizado.`);
}

// Imprimir no Notepad e fechar automaticamente
function imprimirCupom() {
  return new Promise((resolve, reject) => {
    exec(`notepad /p "${CUPOM_PATH}"`, (err) => {
      if (err) {
        console.error("Erro ao imprimir:", err);
        return reject(err);
      }
      console.log("Cupom enviado para impressora e Notepad fechado.");
      resolve();
    });
  });
}

// POST /imprimir → pedido completo
app.post("/imprimir", async (req, res) => {
  try {
    const pedido = req.body;

    if (!pedido || !Array.isArray(pedido.itens) || !pedido.itens.length) {
      return res.status(400).json({ error: "Pedido ou itens inválidos" });
    }

    criarCupomPedido(pedido);
    await imprimirCupom();

    res.status(200).json({ message: "Pedido completo enviado para impressão" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao imprimir pedido", details: err.message });
  }
});

// POST /imprimir/itens → somente itens
app.post("/imprimir/itens", async (req, res) => {
  try {
    const pedido = req.body;

    if (!pedido || !Array.isArray(pedido.itens) || !pedido.itens.length) {
      return res.status(400).json({ error: "Itens do pedido inválidos" });
    }

    criarCupomItens(pedido);
    await imprimirCupom();

    res.status(200).json({ message: "Itens do pedido enviados para impressão" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao imprimir itens", details: err.message });
  }
});

// Porta do serviço
const PORT = 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Printer service rodando na porta ${PORT}`);
});
