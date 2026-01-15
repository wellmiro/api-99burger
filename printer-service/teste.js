const printer = require('printer');

console.log("Impressoras disponíveis:");
printer.getPrinters().forEach(p => console.log(p.name));