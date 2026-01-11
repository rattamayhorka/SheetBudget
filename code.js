/**
 * BÚNKER: CONTROL DE ENVÍOS Y GASTOS (VERSIÓN DEFINITIVA)
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Búnker: Gestión de Gastos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


function getData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName("configuracion");
    const saldosSheet = ss.getSheetByName("saldos_actuales");
    const movsSheet = ss.getSheetByName("movimientos");
    const tarjetasSheet = ss.getSheetByName("Tarjetas_de_credito");
    
    const hoy = new Date();
    const diaActual = hoy.getDate();
    const esQ1 = diaActual <= 15;

    // 1. BUSCAR ENVÍO SANTANDER
    const movsData = movsSheet.getDataRange().getValues();
    let envioSantanderRealizado = false;
    for (let i = movsData.length - 1; i >= 1; i--) {
      let f = new Date(movsData[i][0]);
      if (f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear()) {
        if ((f.getDate() <= 15) === esQ1 && movsData[i][1].toString() === "PAQUETE SANTANDER") {
          envioSantanderRealizado = true;
          break;
        }
      }
    }

    // 2. PROCESAR TARJETAS DE CRÉDITO (A prueba de errores)
    let tarjetasStatus = [];
    if (tarjetasSheet) {
      const tData = tarjetasSheet.getDataRange().getValues();
      for (let i = 1; i < tData.length; i++) {
        let nombreT = tData[i][0];
        let limiteStr = tData[i][2]; // Columna C: Fecha límite
        let limiteDia = parseInt(limiteStr);

        if (!nombreT || isNaN(limiteDia)) continue;

        let fechaVenc = new Date(hoy.getFullYear(), hoy.getMonth(), limiteDia);
        if (diaActual > limiteDia) fechaVenc.setMonth(fechaVenc.getMonth() + 1);

        let diff = Math.ceil((fechaVenc - hoy) / (86400000));
        
        tarjetasStatus.push({
          nombre: nombreT,
          vence: limiteDia,
          diasFaltan: diff,
          tocaPagar: true,
          color: diff <= 3 ? "danger" : (diff <= 7 ? "warning" : "success")
        });
      }
    }

    // 3. PROCESAR CONFIGURACIÓN Y SALDOS
    const configData = configSheet.getDataRange().getValues();
    const saldosData = saldosSheet.getDataRange().getValues();
    let flujoCrudo = [];
    let totalSuscripcionesMeta = 0;

    for (let i = 1; i < configData.length; i++) {
      let nombre = configData[i][1] ? configData[i][1].toString().trim() : "";
      if (!nombre) continue;

      let tipo = configData[i][7] ? configData[i][7].toString().trim() : "";
      let meta = Number(configData[i][8]) || 0;
      let tarjeta = configData[i][4].toString().trim();
      let categoria = configData[i][3].toString().trim();

      if (tipo === "Suscripcion") {
        totalSuscripcionesMeta += meta;
        continue;
      }

      let actual = 0;
      for(let j=1; j<saldosData.length; j++){
        if(saldosData[j][0].toString().trim() == tarjeta && saldosData[j][1].toString().trim() == categoria){
          actual = Number(saldosData[j][2]) || 0;
          break;
        }
      }

      flujoCrudo.push({
        nombre: nombre, meta: meta, actual: actual, tipo: tipo,
        tarjeta: tarjeta, categoria: categoria, prioridad: Number(configData[i][0]) || 99
      });
    }

    // 4. AGRUPAR Y RETORNAR
    const agrupar = (lista) => {
      let grupos = [];
      let mapa = {};
      lista.forEach(item => {
        if (!mapa[item.tarjeta]) {
          mapa[item.tarjeta] = { nombreTarjeta: item.tarjeta, items: [] };
          grupos.push(mapa[item.tarjeta]);
        }
        mapa[item.tarjeta].items.push(item);
      });
      return grupos;
    };

    return {
      santander: { monto: totalSuscripcionesMeta, enviado: envioSantanderRealizado },
      tarjetasStatus: tarjetasStatus,
      fijosAgrupados: agrupar(flujoCrudo.filter(r => r.tipo === "Fijo")),
      flujoAgrupados: agrupar(flujoCrudo.filter(r => r.tipo !== "Fijo")),
      resumen: { 
        debesApartar: (envioSantanderRealizado ? 0 : totalSuscripcionesMeta).toFixed(2), 
        qna: esQ1 ? "1ra Quincena" : "2da Quincena" 
      },
      config: {
        rubros: [...new Set(configData.slice(1).map(r => r[1]))].filter(Boolean).sort(),
        tarjetas: [...new Set(configData.slice(1).map(r => r[4]))].filter(Boolean).sort(),
        opcionesSaldos: saldosData.slice(1).map(r => ({ tarjeta: r[0], categoria: r[1] }))
      }
    };
  } catch (e) {
    return { error: e.toString() };
  }
}



// Nueva función de registro único
function registrarPaqueteSantander(monto) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const movSheet = ss.getSheetByName("movimientos");
  movSheet.appendRow([new Date(), "PAQUETE SANTANDER", monto, "Santander", "Envío quincenal de suscripciones"]);
  return "OK";
}


// REGISTRAR ENVÍO (Botón Derecho)
function registrarPago(rubro, monto, tarjeta, categoria) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movSheet = ss.getSheetByName("movimientos");
    // Solo registra el movimiento. No necesitamos tocar la hoja de saldos para suscripciones.
    movSheet.appendRow([new Date(), "ENVÍO: " + rubro, monto, tarjeta, "Traspaso de suscripción realizado"]);
    return "OK";
  } catch (e) { return "Error"; }
}

// ACTUALIZAR SALDO (Botón +)
function actualizarSaldoDirecto(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetSaldos = ss.getSheetByName("saldos_actuales");
    const sheetMovs = ss.getSheetByName("movimientos");
    const data = sheetSaldos.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim() === datos.tarjeta.trim() && 
          data[i][1].toString().trim() === datos.categoria.trim()) {
        sheetSaldos.getRange(i + 1, 3).setValue(datos.nuevoSaldo);
        sheetMovs.appendRow([new Date(), "🔄 AJUSTE", datos.nuevoSaldo, datos.tarjeta, datos.categoria]);
        return "OK";
      }
    }
    return "No encontrado";
  } catch (e) { return "Error"; }

}

function registrarGasto(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movSheet = ss.getSheetByName("movimientos");
    const saldosSheet = ss.getSheetByName("saldos_actuales");
    movSheet.appendRow([new Date(), datos.rubro, datos.monto, datos.tarjeta, datos.descripcion]);
    const sData = saldosSheet.getDataRange().getValues();
    for (let i = 1; i < sData.length; i++) {
      if (sData[i][0].toString().trim() === datos.tarjeta.trim() && sData[i][1].toString().trim() === datos.rubro.trim()) {
        let act = Number(sData[i][2]) || 0;
        saldosSheet.getRange(i + 1, 3).setValue(act - datos.monto);
        break;
      }
    }
    return "OK";
  } catch (e) { return "Error"; }
}