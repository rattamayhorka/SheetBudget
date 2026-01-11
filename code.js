/**
 * BÚNKER: CASCADA DE PRIORIDAD - SERVER SIDE
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
    
    const configData = configSheet.getDataRange().getValues();
    const saldosData = saldosSheet.getDataRange().getValues();
    
    const hoy = new Date();
    const diaActual = hoy.getDate();
    const esQ1 = diaActual <= 15;

    // 1. OBTENER LISTAS PARA SELECTS (Basado en configuración)
    let listaRubros = [];
    let listaTarjetasConfig = [];
    for (let i = 1; i < configData.length; i++) {
      if (configData[i][1]) listaRubros.push(configData[i][1]); // Columna RUBRO
      if (configData[i][4]) listaTarjetasConfig.push(configData[i][4]); // Columna TARJETA DESTINADA
    }
    // Limpiar duplicados de tarjetas
    listaTarjetasConfig = [...new Set(listaTarjetasConfig)];

    // 2. MAPA DE SALDOS (Llave: Tarjeta + Categoría)
    let saldosActuales = {};
    for (let i = 1; i < saldosData.length; i++) {
      let tarjetaS = saldosData[i][0].toString().trim();
      let categoriaS = saldosData[i][1].toString().trim();
      let saldoS = Number(saldosData[i][2]) || 0;
      if (tarjetaS && categoriaS) {
        saldosActuales[tarjetaS + categoriaS] = saldoS;
      }
    }

    let flujoCrudo = [];
    let alertas = [];

    // 3. PROCESAR CONFIGURACIÓN Y PRIORIDADES
    for (let i = 1; i < configData.length; i++) {
      let prioridad = Number(configData[i][0]); // Columna A
      let nombre = configData[i][1];
      if (!nombre) continue;

      let categoria = configData[i][3].toString().trim();
      let tarjeta = configData[i][4].toString().trim();
      let tipo = configData[i][7];
      let montoQuincenalSugerido = Number(configData[i][8]) || 0;
      let diaPago = parseInt(configData[i][6]) || 0;

      let saldoEnSobre = saldosActuales[tarjeta + categoria] || 0;
      let metaReferencia = montoQuincenalSugerido;
      let faltante = Math.max(0, metaReferencia - saldoEnSobre);

      // Alertas
      if (diaPago > 0) {
        let dias = diaPago - diaActual;
        if (dias >= 0 && dias <= 3) alertas.push({ msg: `Pagar ${nombre} en ${dias} días`, tipo: 'warning' });
        else if (dias < 0 && Math.abs(dias) < 5) alertas.push({ msg: `${nombre} VENCIDO`, tipo: 'danger' });
      }

      flujoCrudo.push({
        prioridad: prioridad,
        nombre: nombre,
        meta: metaReferencia,
        actual: saldoEnSobre,
        faltante: faltante,
        tarjeta: tarjeta,
        tipo: tipo,
        categoria: categoria
      });
    }

    // 4. ORDENAR POR PRIORIDAD (COLUMNA A)
    flujoCrudo.sort((a, b) => a.prioridad - b.prioridad);

    // 5. PROCESAMIENTO DE INDICADORES
    let totalObligatorioFaltante = 0;
    let listaProcesada = flujoCrudo.map(r => {
      if (r.tipo === "Fijo") totalObligatorioFaltante += r.faltante;
      
      let pct = 0;
      let colorFinal = 'danger';
      if (r.actual > 0 && r.meta === 0) {
        pct = 100; colorFinal = 'success';
      } else if (r.meta > 0) {
        pct = (r.actual / r.meta) * 100;
        colorFinal = pct >= 100 ? 'success' : (pct > 0 ? 'warning' : 'danger');
      }

      return {
        ...r,
        progreso: r.actual.toFixed(2),
        porcentaje: Math.min(pct, 100).toFixed(0),
        color: colorFinal
      };
    });

    // 6. AGRUPACIÓN RESPETANDO PRIORIDAD
    const agruparPorPrioridad = (lista) => {
      let grupos = [];
      let mapaGrupos = {};

      lista.forEach(item => {
        let t = item.tarjeta;
        if (!mapaGrupos[t]) {
          mapaGrupos[t] = { nombreTarjeta: t, prioridadMinima: item.prioridad, items: [] };
          grupos.push(mapaGrupos[t]);
        }
        mapaGrupos[t].items.push(item);
        // Aseguramos que el grupo se ordene por la prioridad más baja de sus items
        if (item.prioridad < mapaGrupos[t].prioridadMinima) {
          mapaGrupos[t].prioridadMinima = item.prioridad;
        }
      });

      // Ordenar los grupos finales por la prioridad de la columna A
      return grupos.sort((a, b) => a.prioridadMinima - b.prioridadMinima);
    };

    return {
      fijosAgrupados: agruparPorPrioridad(listaProcesada.filter(r => r.tipo === "Fijo")),
      flujoAgrupados: agruparPorPrioridad(listaProcesada.filter(r => r.tipo !== "Fijo")),
      alertas: alertas,
      resumen: {
        debesApartar: totalObligatorioFaltante.toFixed(2),
        qna: esQ1 ? "1ra Quincena" : "2da Quincena"
      },
      config: {
        rubros: listaRubros.sort(),
        tarjetas: listaTarjetasConfig.sort()
      }
    };

  } catch (e) { return { error: e.toString() }; }
}

// 1 - REGISTRAR GASTO EN MOVIMIENTOS
function registrarGasto(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movSheet = ss.getSheetByName("movimientos");
    
    // Nueva fila: FECHA, RUBRO, MONTO, TARJETA DESTINADA, DESCRIPCION
    movSheet.appendRow([
      new Date(), 
      datos.rubro, 
      datos.monto, 
      datos.tarjeta, 
      datos.descripcion
    ]);
    
    return "OK";
  } catch (e) {
    return "Error: " + e.toString();
  }
}
// 2 - ACTUALIZAR SALDO DIRECTO EN SALDOS_ACTUALES (FILTRO DOBLE)
function actualizarSaldoDirecto(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const saldosSheet = ss.getSheetByName("saldos_actuales");
    const saldosData = saldosSheet.getDataRange().getValues();
    
    let encontrado = false;
    for (let i = 1; i < saldosData.length; i++) {
      // Coincidencia por TARJETA (Columna A) Y CATEGORÍA (Columna B)
      if (saldosData[i][0].toString().trim() === datos.tarjeta.trim() && 
          saldosData[i][1].toString().trim() === datos.categoria.trim()) {
        
        saldosSheet.getRange(i + 1, 3).setValue(datos.nuevoSaldo); // Columna C (Saldo)
        encontrado = true;
        break; 
      }
    }
    
    return encontrado ? "OK" : "No se encontró la combinación de Tarjeta y Categoría";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

// Mantenemos registrarPago para la funcionalidad de la derecha (Fijos)
function registrarPago(rubro, monto, tarjeta, categoria) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const movSheet = ss.getSheetByName("movimientos");
  const saldosSheet = ss.getSheetByName("saldos_actuales");
  movSheet.appendRow([new Date(), rubro, monto, tarjeta, categoria]);
  
  const saldosData = saldosSheet.getDataRange().getValues();
  for (let i = 1; i < saldosData.length; i++) {
    if (saldosData[i][0].toString().trim() === tarjeta && 
        saldosData[i][1].toString().trim() === categoria) {
      let nuevoSaldo = (Number(saldosData[i][2]) || 0) - monto;
      saldosSheet.getRange(i + 1, 3).setValue(nuevoSaldo);
      break;
    }
  }
  return "OK";
}

function registrarGastoLibre(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movSheet = ss.getSheetByName("movimientos");
    
    // Insertar: Fecha (A), Rubro (B), Tarjeta (C), Monto (D), Descripción (E)
    movSheet.appendRow([
      new Date(), 
      datos.rubro, 
      datos.tarjeta,
      datos.monto, 
      datos.descripcion
    ]);
    
    return "OK";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

function registrarIngreso(datos) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movSheet = ss.getSheetByName("movimientos");
    
    // Insertar: Fecha, Rubro (Ingreso), Tarjeta, Monto, Descripción
    movSheet.appendRow([
      new Date(), 
      "INGRESO: " + datos.rubro, 
      datos.tarjeta,
      datos.monto, 
      datos.descripcion
    ]);
    
    return "OK";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

