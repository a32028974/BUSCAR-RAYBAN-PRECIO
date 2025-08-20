/** URL del Apps Script (cambiá si usás otra) */
const API = 'https://script.google.com/macros/s/AKfycbye3RORWk2HZFBdKayrKXKMM1jACMg14YZPIhxXNVo-yuLMlYpIsQAuCIWh2IlZLRF2ZA/exec';

/** Encabezados oficiales del Sheet */
const HEADERS_CANON = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE','CRISTAL',
  'FAMILIA','PRECIO PUBLICO','FECHA INGRESO','FECHA DE VENTA','VENDEDOR',
  'COSTO','CODIGO DE BARRAS','OBSERVACIONES','FÁBRICA'
];

/** Orden visual en la tabla (12 columnas que mostramos) */
const DISPLAY_ORDER = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE',
  'CRISTAL','FAMILIA','PRECIO PUBLICO','FECHA DE VENTA','VENDEDOR','FECHA INGRESO'
];

/** Fallback por índice (si no hay ?debug=headers)
 *  FIX: PRECIO PUBLICO (6) y CRISTAL (8)
 */
const DEFAULT_IDX = {
  'N ANTEOJO':0,'MARCA':1,'MODELO':2,'COLOR':3,'ARMAZON':4,'CALIBRE':5,
  'PRECIO PUBLICO':6,'FAMILIA':7,'CRISTAL':8,
  'FECHA INGRESO':9,'FECHA DE VENTA':10,'VENDEDOR':11
};

let stockLocal = [];  // arrays (viejo) u objetos (nuevo)
let ordenAsc = true;

// Mapeos
let IDX = {};   // nombre -> índice (para arrays)
let REAL = {};  // nombre -> clave real (para objetos)

// -------- Normalización / sinónimos ----------
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                   .replace(/\s+/g,' ').trim().toUpperCase();
const digits = v => String(v ?? '').replace(/\D+/g,'');
const SYN = {
  'N ANTEOJO':['N° ANTEOJO','Nº ANTEOJO','N ANT','N° ANT'],
  'ARMAZON':['ARMAZÓN'],
  'PRECIO PUBLICO':['PRECIO PÚBLICO','PRECIO'],
  'FÁBRICA':['FABRICA']
};

// --------- Headers dinámicos ----------
async function buildHeaderMaps(){
  try {
    const r = await fetch(API+'?debug=headers');
    const j = await r.json();
    const headers = (j && j.headers) || [];
    if (!Array.isArray(headers) || headers.length === 0) throw new Error('sin headers');

    const mapPos = {}, mapReal = {};
    headers.forEach((h,i)=>{ mapPos[norm(h)] = i; mapReal[norm(h)] = String(h); });

    const findIdx = (wanted) => {
      const n = norm(wanted);
      if (mapPos[n] != null) return mapPos[n];
      const alts = SYN[wanted] || [];
      for (const a of alts){ const n2 = norm(a); if (mapPos[n2] != null) return mapPos[n2]; }
      return null;
    };
    const findReal = (wanted) => {
      const n = norm(wanted);
      if (mapReal[n] != null) return mapReal[n];
      const alts = SYN[wanted] || [];
      for (const a of alts){ const n2 = norm(a); if (mapReal[n2] != null) return mapReal[n2]; }
      return wanted;
    };

    IDX = {}; REAL = {};
    HEADERS_CANON.forEach(name=>{
      const idx = findIdx(name);
      if (idx != null) IDX[name] = idx;
      REAL[name] = findReal(name);
    });

  } catch(_) {
    // fallback seguro
    IDX = {...DEFAULT_IDX};
    REAL = HEADERS_CANON.reduce((o,k)=> (o[k]=k,o),{});
  }
  localStorage.setItem('idxHeaders', JSON.stringify(IDX));
  localStorage.setItem('realHeaders', JSON.stringify(REAL));
}

async function ensureMaps(){
  if (!Object.keys(IDX).length || !Object.keys(REAL).length){
    const c1 = localStorage.getItem('idxHeaders');
    const c2 = localStorage.getItem('realHeaders');
    if (c1) { try { IDX = JSON.parse(c1); } catch{} }
    if (c2) { try { REAL = JSON.parse(c2); } catch{} }
  }
  if (!Object.keys(IDX).length || !Object.keys(REAL).length){
    await buildHeaderMaps();
  }
}

// --------- Utils ----------
function parseFechaFlexible(v){
  if (!v) return '';
  const d = new Date(v);
  if (!isNaN(d)){
    const dd=String(d.getDate()).padStart(2,'0');
    const mm=String(d.getMonth()+1).padStart(2,'0');
    const yy=d.getFullYear();
    return `${dd}-${mm}-${yy}`;
  }
  if (typeof v==='string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)){
    const [dd,mm,yy]=v.split('/');
    const full = yy.length===2 ? ('20'+yy) : yy;
    return `${dd.padStart(2,'0')}-${mm.padStart(2,'0')}-${full}`;
  }
  return String(v);
}

// --- Aprendizaje del orden con tu fila “etiquetada” ---
function learnFromSampleRow(row){
  IDX['N ANTEOJO']=0; IDX['MARCA']=1; IDX['MODELO']=2; IDX['COLOR']=3; IDX['ARMAZON']=4; IDX['CALIBRE']=5;
  for (let i=6;i<row.length;i++){
    const v = String(row[i] ?? '').toLowerCase().trim();
    if (v === 'color cristal' || v === 'cristal') IDX['CRISTAL'] = i;
    else if (v === 'familia') IDX['FAMILIA'] = i;
    else if (v === 'precio publico' || v === 'precio público' || v === 'precio') IDX['PRECIO PUBLICO'] = i;
    else if (v === 'fecha de venta') IDX['FECHA DE VENTA'] = i;
    else if (v === 'fecha de ingreso') IDX['FECHA INGRESO'] = i;
    else if (v === 'vendedor') IDX['VENDEDOR'] = i;
  }
  localStorage.setItem('idxHeaders', JSON.stringify(IDX));
}
function applyLearnIfLabeled(rows){
  if (!Array.isArray(rows) || !rows.length) return;
  const arrays = Array.isArray(rows[0]);
  const missing = ['CRISTAL','FAMILIA','PRECIO PUBLICO','FECHA DE VENTA','FECHA INGRESO','VENDEDOR']
                  .some(k => typeof IDX[k] !== 'number');
  if (arrays && missing){ learnFromSampleRow(rows[0]); }
}

// Heurística CRISTAL vs PRECIO si quedaron invertidos
function numLike(v){ const n = Number(String(v).replace(/[^0-9.-]/g,'')); return !isNaN(n) && String(v).trim()!==''; }
function maybeFixCristalPrecio(rows){
  if (!Array.isArray(rows) || !rows.length) return;
  const iC = IDX['CRISTAL'], iP = IDX['PRECIO PUBLICO'];
  if (typeof iC!=='number' || typeof iP!=='number') return;
  const sample = rows.slice(0, Math.min(rows.length,20));
  const cristalNum = sample.filter(r=>numLike(r[iC])).length;
  const precioNum  = sample.filter(r=>numLike(r[iP])).length;
  if (cristalNum > precioNum) {
    [IDX['CRISTAL'], IDX['PRECIO PUBLICO']] = [IDX['PRECIO PUBLICO'], IDX['CRISTAL']];
    localStorage.setItem('idxHeaders', JSON.stringify(IDX));
  }
}

// --------- API ----------
async function actualizarStock(){
  document.getElementById('spinner').style.display = 'block';
  try{
    await ensureMaps();

    const res = await fetch(API+'?todos=true');
    const data = await res.json().catch(()=>null);
    const rows = (data && Array.isArray(data.rows)) ? data.rows
               : (Array.isArray(data) ? data : null);

    if (!rows){
      Swal.fire("⚠ No se pudo actualizar el stock");
      return;
    }

    stockLocal = rows;
    if (Array.isArray(stockLocal[0])) {
      applyLearnIfLabeled(stockLocal);
      maybeFixCristalPrecio(stockLocal);
    }

    localStorage.setItem('stock', JSON.stringify(rows));

    const fecha = (data && data.updatedAt) || new Date().toLocaleString();
    localStorage.setItem('ultimaActualizacion', fecha);
    document.getElementById('ultimaActualizacion').textContent = 'Base de datos actualizada: ' + fecha;

    Swal.fire({icon:'success',title:'Stock actualizado',showConfirmButton:false,timer:1000});
  }catch(e){
    console.error(e);
    Swal.fire("❌ Error al actualizar el stock");
  }finally{
    document.getElementById('spinner').style.display = 'none';
  }
}

// --------- Render ----------
function renderResultados(rows){
  const tbody = document.getElementById('contenido');
  tbody.innerHTML = '';

  const arrays = Array.isArray(rows[0]);
  const idxMostrar = arrays ? DISPLAY_ORDER.map(n => IDX[n]).filter(i => i != null) : null;
  const idxVenta   = arrays ? IDX['FECHA DE VENTA'] : null;
  const idxIngreso = arrays ? IDX['FECHA INGRESO'] : null;
  const realKeys   = !arrays ? DISPLAY_ORDER.map(n => REAL[n] || n) : null;

  rows.forEach(row=>{
    const tr = document.createElement('tr');

    let id = arrays ? row[IDX['N ANTEOJO'] ?? 0] : row[REAL['N ANTEOJO'] || 'N ANTEOJO'];

    const tdCheck = document.createElement('td');
    const check = document.createElement('input');
    check.type='checkbox'; check.checked=true; check.dataset.id=String(id??'');
    tdCheck.appendChild(check); tr.appendChild(tdCheck);

    if (arrays){
      idxMostrar.forEach(i=>{
        const td=document.createElement('td');
        let val = (row[i] != null && row[i] !== '') ? row[i] : '-';
        if (i===idxVenta || i===idxIngreso) val = parseFechaFlexible(val) || '-';
        td.textContent = val; tr.appendChild(td);
      });
    } else {
      realKeys.forEach(key=>{
        const td=document.createElement('td');
        let val = row[key];
        const isFecha = (key===(REAL['FECHA DE VENTA']||'FECHA DE VENTA') ||
                         key===(REAL['FECHA INGRESO']||'FECHA INGRESO'));
        td.textContent = (val==null||val==='') ? '-' : (isFecha ? parseFechaFlexible(val) : String(val));
        tr.appendChild(td);
      });
    }

    tbody.appendChild(tr);
  });

  document.getElementById('resultado').style.display = 'block';
}

// --------- Ordenar ----------
function ordenarPor(indiceVisual){
  const tbody = document.getElementById('contenido');
  const filas = Array.from(tbody.querySelectorAll('tr'));
  filas.sort((a,b)=>{
    const A=a.children[indiceVisual+1].textContent.trim();
    const B=b.children[indiceVisual+1].textContent.trim();
    const nA=Number(A.replace(/[^0-9.-]/g,'')), nB=Number(B.replace(/[^0-9.-]/g,''));
    if(!isNaN(nA)&&!isNaN(nB)) return ordenAsc ? nA-nB : nB-nA;
    return ordenAsc ? A.localeCompare(B) : B.localeCompare(A);
  });
  ordenAsc=!ordenAsc; filas.forEach(f=>tbody.appendChild(f));
}

// --------- Buscar ----------
async function buscarAnteojo(){
  const input=document.getElementById('codigo');
  const codigo=String(input.value||'').trim();
  const avanzada=document.getElementById('busquedaAvanzada').checked;
  const inicio=performance.now();

  document.getElementById('spinner').style.display='block';
  document.getElementById('tiempoBusqueda').textContent='';
  document.getElementById('cantidadResultados').textContent='';

  if(!codigo){
    Swal.fire("Ingresá un número o palabras clave");
    document.getElementById('spinner').style.display='none';
    return;
  }

  await ensureMaps();

  let resultados=[];
  const arrays = stockLocal.length && Array.isArray(stockLocal[0]);

  // 1) local por número
  if(!avanzada && /^\d+$/.test(codigo) && stockLocal.length){
    if (arrays){
      const iN = IDX['N ANTEOJO'] ?? 0;
      resultados = stockLocal.filter(r => Number(digits(r[iN])) === Number(codigo));
    } else {
      const kN = REAL['N ANTEOJO'] || 'N ANTEOJO';
      resultados = stockLocal.filter(r => Number(digits(r[kN])) === Number(codigo));
    }
  }

  // 2) backend moderno y legacy
  if(resultados.length===0){
    try{
      const r1 = await fetch(API+'?todos=true&n='+encodeURIComponent(codigo));
      const j1 = await r1.json();
      const rows1 = (j1 && Array.isArray(j1.rows)) ? j1.rows : (Array.isArray(j1) ? j1 : []);
      if (rows1.length) resultados = rows1;

      if (!rows1.length){
        const r2 = await fetch(API+'?codigo='+encodeURIComponent(codigo));
        const j2 = await r2.json().catch(()=>[]);
        if (Array.isArray(j2)) resultados = j2;
      }
    }catch(e){ console.error(e); }
  }

  if(resultados.length===0){
    document.getElementById('resultado').style.display='none';
    document.getElementById('cantidadResultados').textContent='No se encontraron resultados.';
    document.getElementById('spinner').style.display='none';
    return;
  }

  if (Array.isArray(resultados[0])) {
    applyLearnIfLabeled(resultados);
    maybeFixCristalPrecio(resultados);
  }

  renderResultados(resultados);
  document.getElementById('cantidadResultados').textContent=`🔎 Se encontraron ${resultados.length} resultado(s).`;
  document.getElementById('spinner').style.display='none';
  const tiempo=(performance.now()-inicio).toFixed(2);
  document.getElementById('tiempoBusqueda').textContent=`⏱ Tiempo de búsqueda: ${tiempo} ms`;
}

// --------- Limpiar & Init ----------
function limpiar(){
  document.getElementById('codigo').value='';
  document.getElementById('contenido').innerHTML='';
  document.getElementById('resultado').style.display='none';
  document.getElementById('spinner').style.display='none';
  document.getElementById('tiempoBusqueda').textContent='';
  document.getElementById('cantidadResultados').textContent='';
  document.getElementById('codigo').focus();
}

window.onload = async () => {
  await ensureMaps();
  document.getElementById('codigo').focus();

  const ultima = localStorage.getItem('ultimaActualizacion');
  if (ultima) document.getElementById('ultimaActualizacion').textContent = 'Base de datos actualizada: ' + ultima;

  const cache = localStorage.getItem('stock');
  if (cache) { try { stockLocal = JSON.parse(cache); } catch {} }

  document.getElementById('codigo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); buscarAnteojo(); }
  });
};

// Auto-actualización diaria (09:05)
setInterval(() => {
  const ahora=new Date();
  if(ahora.getHours()===9 && ahora.getMinutes()===5 && ahora.getSeconds()<10 && !sessionStorage.getItem('stockActualizadoHoy')){
    actualizarStock().then(()=>{
      const ts=new Date().toLocaleString();
      document.getElementById('ultimaActualizacion').textContent='🔄 Stock actualizado automáticamente: '+ts;
      sessionStorage.setItem('stockActualizadoHoy','true');
    });
  }
},10000);
