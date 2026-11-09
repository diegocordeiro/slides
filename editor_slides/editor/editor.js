/* Editor de slides — interface (JS puro, sem dependências).
   A renderização é feita pelo servidor (motor/render.py): o editor manda o JSON
   e recebe o HTML da prévia, então o que aparece aqui é o que será publicado. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const st = {
  c: null, dados: null, sel: 0, bloco: null, fechados: new Set(), colAtiva: {},
  hist: [], fut: [], ultimo: null, sujo: false, ver: null, temaVars: null, imagens: [],
  foco: null, imgSel: null, provedor: null, modelo: ''
};
let CAT = null, TEMAS = [], LLM = null, GIT = {};
const classeOrig = new WeakMap();

/* ------------------------------------------------------------ utilidades */
function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(f.nodeType ? f : document.createTextNode(f));
  return el;
}
function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = erro ? 'erro' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, erro ? 7000 : 3000);
}
async function api(url, corpo) {
  const r = await fetch(url, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  let j; try { j = await r.json(); } catch (e) { throw new Error('Resposta inválida do servidor (' + r.status + ')'); }
  if (!r.ok || j.erro) throw new Error(j.erro || ('Erro ' + r.status));
  return j;
}
function getP(obj, caminho) {
  return caminho.split('/').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setP(obj, caminho, valor) {
  const ks = caminho.split('/'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = valor;
}
function delP(obj, caminho) {
  const ks = caminho.split('/'); const pai = getP(obj, ks.slice(0, -1).join('/')); const k = ks[ks.length - 1];
  if (Array.isArray(pai)) pai.splice(+k, 1); else if (pai) delete pai[k];
}
const txt = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const clone = o => JSON.parse(JSON.stringify(o));
const legado = () => st.dados && st.dados.motor === 'legado';
const pastaAula = () => st.c ? st.c.replace(/\/?apresentacao\.json$/, '') : '';
const urlAula = p => '/r/' + pastaAula().split('/').map(encodeURIComponent).join('/') + '/' + p;
function debounce(fn, ms) { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.agora = (...a) => { clearTimeout(t); return fn(...a); }; return f; }

function tituloSlide(s) {
  if (!s) return '';
  if (s.layout === 'html') {
    const m = /class="slhd"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/.exec(s.html || '') || /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(s.html || '') || /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(s.html || '');
    const alt = /<img[^>]*\balt="([^"]+)"/.exec(s.html || '');
    return m ? txt(m[1]) : alt ? txt(alt[1]) : '(slide HTML)';
  }
  return txt(s.titulo) || (s.layout === 'imagem' && txt(s.alt)) || (CAT.layouts[s.layout] || {}).rotulo || s.layout;
}

/* ------------------------------------------------------------ histórico e salvamento */
const confirmarHist = debounce(() => {
  const agora = JSON.stringify(st.dados);
  if (agora !== st.ultimo) { st.hist.push(st.ultimo); if (st.hist.length > 120) st.hist.shift(); st.ultimo = agora; st.fut = []; }
  atualizarBotoes();
}, 500);
const agendarSalvar = debounce(() => salvar(true), 2000);
function marcar(rerender = true) {
  st.sujo = true; $('#salvo').textContent = 'alterações não salvas';
  confirmarHist(); agendarSalvar();
  if (rerender) agendarPrevia();
}
function desfazer() {
  confirmarHist.agora();
  if (!st.hist.length) return;
  st.fut.push(st.ultimo); st.ultimo = st.hist.pop(); st.dados = JSON.parse(st.ultimo);
  st.sel = Math.min(st.sel, st.dados.slides.length - 1); st.sujo = true; agendarSalvar(); renderTudo();
}
function refazer() {
  if (!st.fut.length) return;
  st.hist.push(st.ultimo); st.ultimo = st.fut.pop(); st.dados = JSON.parse(st.ultimo);
  st.sel = Math.min(st.sel, st.dados.slides.length - 1); st.sujo = true; agendarSalvar(); renderTudo();
}
async function salvar(auto) {
  if (!st.c || !st.dados) return;
  confirmarHist.agora();
  try {
    await api('/api/projeto', { c: st.c, dados: st.dados });
    st.sujo = false;
    $('#salvo').textContent = (auto ? 'salvo automaticamente ' : 'salvo ') + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { $('#salvo').textContent = 'erro ao salvar'; toast(e.message, true); }
}
function atualizarBotoes() {
  const tem = !!st.dados;
  $('#b-desfazer').disabled = !st.hist.length; $('#b-refazer').disabled = !st.fut.length;
  for (const id of ['#b-salvar', '#b-gerar', '#b-ver', '#b-pdf', '#b-celular', '#b-add']) $(id).disabled = !tem;
  $('#b-gerar').disabled = !tem || (legado() && st.dados.estado !== 'editor');
}

/* ------------------------------------------------------------ abrir / novo */
async function abrir(c) {
  if (st.sujo) await salvar(true);
  const r = await api('/api/projeto?c=' + encodeURIComponent(c));
  Object.assign(st, { c, dados: r.dados, ver: r.verificacao, temaVars: r.tema_vars, imagens: r.imagens, sel: 0, bloco: null,
    hist: [], fut: [], ultimo: JSON.stringify(r.dados), sujo: false, foco: null, imgSel: null });
  st.fechados.clear();
  try { localStorage.setItem('editor_slides:ultimo', c); } catch (e) { }
  $('#salvo').textContent = '';
  renderTudo();
}
async function dialogoAbrir() {
  const d = $('#d-abrir'), box = $('#abrir-lista');
  box.innerHTML = '<p class="muted">Carregando…</p>'; d.showModal();
  const r = await api('/api/projetos');
  box.innerHTML = '';
  const grupos = {};
  r.projetos.forEach(p => (grupos[p.grupo] = grupos[p.grupo] || []).push(p));
  for (const g of Object.keys(grupos).sort((a, b) => (a === 'Exemplos') - (b === 'Exemplos') || a.localeCompare(b))) {
    box.append(h('h4', {}, g));
    for (const p of grupos[g]) box.append(h('div', { class: 'proj', onclick: () => { d.close(); abrir(p.caminho).catch(e => toast(e.message, true)); } },
      h('span', {}, h('b', {}, p.titulo), h('br'), h('small', { class: 'muted' }, p.caminho + ' · ' + p.slides + ' slides')),
      h('span', { class: 'selo ' + p.estado }, p.estado === 'importada' ? 'importada' : (p.motor === 'legado' ? 'legado · editor' : 'editor'))));
  }
  if (r.importaveis.length) {
    box.append(h('h4', {}, 'Aulas ainda não importadas'));
    for (const a of r.importaveis) box.append(h('div', { class: 'proj' }, h('span', {}, h('b', {}, a.assunto), h('br'), h('small', { class: 'muted' }, a.rel + ' · ' + a.slides + ' slides')),
      h('button', { onclick: async () => { try { const j = await api('/api/importar', { rel: a.rel }); d.close(); toast('Importada sem alterar o original.'); abrir(j.c); } catch (e) { toast(e.message, true); } } }, 'Importar')));
  }
  if (!r.projetos.length && !r.importaveis.length) box.append(h('p', { class: 'vazio' }, 'Nenhuma aula encontrada.'));
}
async function dialogoNovo() {
  const d = $('#d-novo'), f = $('#f-novo');
  $('#novo-tema').innerHTML = ''; TEMAS.forEach(t => $('#novo-tema').append(h('option', { value: t.nome }, t.rotulo || t.nome)));
  $('#novo-tema').value = 'ifpi';
  try {
    const r = await api('/api/projetos'); const areas = new Set(), discs = new Set();
    r.projetos.concat(r.importaveis.map(a => ({ caminho: a.rel }))).forEach(p => { const ps = p.caminho.split('/'); if (ps.length > 3 && ps[0] !== 'editor_slides') { areas.add(ps[0]); discs.add(ps[1]); } });
    $('#dl-areas').innerHTML = [...areas].map(a => `<option value="${a}">`).join('');
    $('#dl-disc').innerHTML = [...discs].map(a => `<option value="${a}">`).join('');
  } catch (e) { }
  f.reset(); $('#novo-tema').value = 'ifpi'; d.showModal();
  f.onsubmit = async ev => {
    ev.preventDefault();
    try { const j = await api('/api/novo', Object.fromEntries(new FormData(f))); d.close(); await abrir(j.c); toast('Aula criada. Clique em Gerar para criar os arquivos HTML.'); }
    catch (e) { toast(e.message, true); }
  };
}

/* ------------------------------------------------------------ render geral */
function renderTudo() {
  const d = st.dados;
  $('#p-titulo').textContent = d ? txt((d.meta || {}).titulo) + '  —  ' + st.c : 'Nenhuma aula aberta';
  const est = $('#p-estado');
  est.textContent = d ? (d.estado === 'importada' ? 'importada' : d.motor === 'legado' ? 'assumida' : 'editor') : '';
  est.title = d ? (d.estado === 'importada' ? 'Aula importada: o HTML publicado continua sendo a versão oficial' : d.motor === 'legado' ? 'Aula importada e assumida pelo editor: Gerar/Publicar usam o JSON' : 'Aula criada no editor') : '';
  est.className = 'selo ' + (d ? d.estado : '');
  renderAviso(); renderLista(); renderPainel(); renderNotas(); atualizarBotoes();
  if (d) agendarPrevia.agora(); else $('#palco').srcdoc = '<p style="font:16px sans-serif;padding:40px;color:#666">Abra ou crie uma aula.</p>';
}
function renderAviso() {
  const a = $('#aviso'); a.innerHTML = ''; a.hidden = true; a.className = '';
  if (!st.dados || st.dados.estado !== 'importada') return;
  a.hidden = false;
  a.append(h('span', {}, h('b', {}, 'Aula importada. '), 'O HTML publicado continua sendo a versão oficial: Gerar e Publicar não o alteram. ',
    'Suas edições ficam guardadas no apresentacao.json. ', st.ver && st.ver.ok ? '✔ O JSON reproduz o publicado byte a byte.' : '⚠ ' + (st.ver ? st.ver.msg : '')),
    h('button', { class: 'primario', onclick: assumir }, 'Assumir esta aula pelo editor'));
}
async function assumir() {
  await salvar(true);
  try {
    let r = await api('/api/assumir', { c: st.c });
    if (!r.ok && r.precisa_confirmar) {
      if (!confirm(r.msg + '\n\nConfirmar?')) return;
      r = await api('/api/assumir', { c: st.c, confirmar: true });
    }
    toast('Aula assumida pelo editor. Agora Gerar/Publicar usam o JSON.');
    await abrir(st.c);
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------ lista de slides */
function renderLista() {
  const ol = $('#slides'); ol.innerHTML = '';
  if (!st.dados) return;
  st.dados.slides.forEach((s, i) => {
    const li = h('li', { class: i === st.sel ? 'on' : '', draggable: 'true', onclick: () => selecionar(i) },
      h('span', { class: 'n' }, i + 1),
      h('span', { class: 't', title: tituloSlide(s) }, h('small', {}, (CAT.layouts[s.layout] || {}).rotulo || s.layout), tituloSlide(s)),
      h('span', { class: 'ops' },
        h('button', { title: 'Duplicar', onclick: ev => { ev.stopPropagation(); duplicar(i); } }, '⧉'),
        h('button', { title: 'Excluir', class: 'perigo', onclick: ev => { ev.stopPropagation(); excluir(i); } }, '✕')));
    li.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/plain', i); li.classList.add('arrastando'); });
    li.addEventListener('dragend', () => li.classList.remove('arrastando'));
    li.addEventListener('dragover', ev => { ev.preventDefault(); li.classList.add('alvo'); });
    li.addEventListener('dragleave', () => li.classList.remove('alvo'));
    li.addEventListener('drop', ev => { ev.preventDefault(); li.classList.remove('alvo'); mover(+ev.dataTransfer.getData('text/plain'), i); });
    ol.append(li);
  });
  const on = ol.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function selecionar(i) {
  if (i === st.sel) return;
  st.sel = i; st.bloco = null; st.foco = null; st.imgSel = null;
  $$('#slides li').forEach((li, k) => li.classList.toggle('on', k === i));
  renderPainelSlide(); renderNotas(); mostrarSlide(i); renderIA();
}
function mover(de, para) {
  if (de === para || isNaN(de)) return;
  const s = st.dados.slides.splice(de, 1)[0];
  st.dados.slides.splice(para, 0, s); st.sel = para; marcar(); renderLista(); renderPainelSlide();
}
function duplicar(i) {
  const s = clone(st.dados.slides[i]);
  if (s.layout === 'html') { s.editado = true; if (s.id) s.id = s.id + '-copia'; }
  st.dados.slides.splice(i + 1, 0, s); st.sel = i + 1; marcar(); renderLista(); renderPainelSlide(); renderNotas();
}
function excluir(i) {
  if (st.dados.slides.length <= 1) return toast('A aula precisa de pelo menos um slide.', true);
  if (!confirm('Excluir o slide ' + (i + 1) + ' — ' + tituloSlide(st.dados.slides[i]) + '?')) return;
  st.dados.slides.splice(i, 1); st.sel = Math.min(st.sel, st.dados.slides.length - 1);
  marcar(); renderLista(); renderPainelSlide(); renderNotas();
}
function inserir(slide) {
  st.dados.slides.splice(st.sel + 1, 0, slide); st.sel = st.sel + 1; st.bloco = null;
  marcar(); renderLista(); renderPainelSlide(); renderNotas();
}

const MODELOS = {
  'Conteúdo — 1 coluna': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1fr', colunas: [[{ tipo: 'lista', itens: ['Primeiro ponto', 'Segundo ponto', 'Terceiro ponto'] }]], notas: '' }),
  'Conteúdo — 2 colunas': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1fr 1fr', colunas: [[{ tipo: 'card', titulo: 'Lado A', itens: ['Item', 'Item'] }], [{ tipo: 'card', variante: 'vd', titulo: 'Lado B', itens: ['Item', 'Item'] }]], notas: '' }),
  'Três cartões': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1fr 1fr 1fr', colunas: [1, 2, 3].map(n => [{ tipo: 'card', crescer: true, titulo: 'Cartão ' + n, html: '<p>Texto curto.</p>' }]), notas: '' }),
  'Imagem + texto': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1.2fr 1fr', colunas: [[{ tipo: 'figura', src: '', alt: '', legenda: '' }], [{ tipo: 'lista', itens: ['Ponto principal', 'Outro ponto'] }]], notas: '' }),
  'Tabela': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1fr', colunas: [[{ tipo: 'tabela', cabecalho: ['Coluna 1', 'Coluna 2', 'Coluna 3'], linhas: [['a', 'b', 'c'], ['d', 'e', 'f']] }]], notas: '' }),
  'Indicadores': () => ({ layout: 'conteudo', titulo: 'Novo slide', proporcao: '1fr', topo: [{ tipo: 'kpis', itens: [{ valor: '42', texto: 'legenda' }, { valor: '7', texto: 'legenda' }, { valor: '99%', texto: 'legenda' }] }], colunas: [[{ tipo: 'texto', html: '<p>Comentário sobre os números.</p>' }]], rodape: [{ tipo: 'faixa', html: 'Mensagem principal do slide.' }], notas: '' }),
  'Capa': () => ({ layout: 'capa', rotulo: 'Disciplina · Aula', titulo: 'Título da aula', subtitulos: ['Prof. Diego Cordeiro de Oliveira'], notas: '' }),
  'Seção / encerramento': () => ({ layout: 'secao', rotulo: 'Parte 2', titulo: 'Título da seção', texto: '', notas: '' }),
  'Imagem inteira': () => ({ layout: 'imagem', imagem: '', alt: '', notas: '' }),
  'HTML livre': () => ({ layout: 'html', editado: true, html: '<div class="sl">\n  <div class="slhd"><h2>Novo slide</h2></div>\n  <div class="slbd">\n    <p>Texto do slide.</p>\n  </div>\n</div>' }),
};
function menuAdicionar() {
  const m = $('#menu-add'); m.innerHTML = '';
  if (legado()) {
    m.append(h('button', { onclick: () => { m.hidden = true; duplicar(st.sel); } }, 'Duplicar o slide atual (mesmo estilo)'));
    m.append(h('button', { onclick: () => { m.hidden = true; abaAtiva('ia'); $('#ia-pedido') && $('#ia-pedido').focus(); } }, 'Novo slide no mesmo estilo, com IA…'));
    m.append(h('hr'));
    m.append(h('small', { class: 'muted', style: 'padding:4px 10px;display:block' }, 'Modelos do editor (usam as classes comuns do CSS da aula):'));
  } else {
    m.append(h('button', { onclick: () => { m.hidden = true; abaAtiva('ia'); $('#ia-pedido') && $('#ia-pedido').focus(); } }, '✦ Novo slide com IA…'));
    m.append(h('hr'));
  }
  for (const [nome, fn] of Object.entries(MODELOS)) m.append(h('button', { onclick: () => { m.hidden = true; inserir(fn()); } }, nome));
  m.hidden = !m.hidden;
}

/* ------------------------------------------------------------ prévia (palco) */
let previaSeq = 0;
const agendarPrevia = debounce(async () => {
  if (!st.dados) return;
  const seq = ++previaSeq;
  try {
    const r = await api('/api/previa', { c: st.c, dados: st.dados });
    if (seq !== previaSeq) return;
    const fr = $('#palco');
    fr.onload = () => prepararPalco();
    fr.removeAttribute('srcdoc'); fr.src = r.url;
  } catch (e) { toast('Prévia: ' + e.message, true); }
}, 250);

function escalarPalco() {
  const w = $('#palco-wrap'); const s = Math.min(w.clientWidth / 1280, w.clientHeight / 720, 1.5);
  $('#palco-escala').style.transform = 'scale(' + s + ')';
}
function docPalco() { return $('#palco').contentDocument; }

function prepararPalco() {
  const doc = docPalco(); if (!doc || !doc.body) return;
  $$('.sl', doc).forEach(el => classeOrig.set(el, el.getAttribute('class')));
  doc.addEventListener('click', cliquePalco, true);
  doc.addEventListener('keydown', atalhos);
  mostrarSlide(st.sel);
}
function slideAtivo() { const doc = docPalco(); return doc && doc.querySelector('[data-slide="' + st.sel + '"]'); }

function mostrarSlide(i) {
  const doc = docPalco(); if (!doc || !doc.body) return;
  $$('.sl', doc).forEach(el => { el.classList.remove('ac', 'ed-html'); el.removeAttribute('contenteditable'); });
  const el = doc.querySelector('[data-slide="' + i + '"]');
  if (!el) return;
  el.classList.add('ac');
  const sl = st.dados.slides[i];
  if (sl.layout === 'html') {
    el.classList.add('ed-html');
    el.setAttribute('contenteditable', 'true');
    el.oninput = () => { sl.html = serializar(el); sl.editado = true; marcar(false); sincPainelHtml(); };
    el.onblur = () => { renderLista(); };
  } else {
    $$('[data-e]', el).forEach(c => {
      if (c.dataset.e.endsWith('/notas')) return;
      c.setAttribute('contenteditable', 'true');
      c.oninput = () => { let v = c.innerHTML; if (v === '<br>') v = ''; setP(st.dados, c.dataset.e, v); marcar(false); };
      c.onfocus = () => { st.foco = { tipo: 'campo', caminho: c.dataset.e, el: c }; renderIAFoco(); };
      c.onblur = () => { renderLista(); if ($('#aba-slide').classList.contains('on')) renderPainelSlide(true); };
    });
  }
  if (st.bloco) { const b = el.querySelector('[data-b="' + st.bloco + '"]'); if (b) b.classList.add('ed-sel'); }
}
const agendarListaHtml = debounce(() => renderLista(), 600);
/* edição direta no palco → atualiza o editor do painel (se o painel não estiver em uso) */
const sincPainelHtml = debounce(() => { if (!$('#aba-slide').contains(document.activeElement)) renderPainelSlide(true); }, 500);
function serializar(el) {
  const c = el.cloneNode(true);
  c.removeAttribute('contenteditable'); c.removeAttribute('data-slide');
  const orig = classeOrig.get(el);
  if (orig === null || orig === undefined) c.removeAttribute('class'); else c.setAttribute('class', orig);
  $$('[contenteditable]', c).forEach(x => x.removeAttribute('contenteditable'));
  $$('.ed-sel', c).forEach(x => { x.classList.remove('ed-sel'); if (!x.getAttribute('class')) x.removeAttribute('class'); });
  return c.outerHTML;
}
function cliquePalco(ev) {
  const a = ev.target.closest('a'); if (a) ev.preventDefault();
  const sl = st.dados.slides[st.sel]; const slideEl = slideAtivo();
  const img = ev.target.closest('img');
  if (img && slideEl && slideEl.contains(img)) {
    st.imgSel = { el: img, caminho: img.dataset.img || null, src: img.getAttribute('src') };
    renderIAFoco();
    if (ev.detail >= 2 || ev.altKey) { trocarImagemPalco(img); return; }
  }
  if (sl && sl.layout === 'html') {
    const alvo = ev.target.closest('p,li,h1,h2,h3,h4,td,th,small,.sub,.rot,b,strong,span,div');
    if (alvo && alvo !== slideEl) { st.foco = { tipo: 'html-el', el: alvo }; renderIAFoco(); }
    return;
  }
  const b = ev.target.closest('[data-b]');
  if (b) selecionarBloco(b.dataset.b);
}
function trocarImagemPalco(img) {
  escolherImagem(src => {
    const sl = st.dados.slides[st.sel];
    if (img.dataset.img) { setP(st.dados, img.dataset.img, src || ''); marcar(); renderPainelSlide(); }
    else if (sl.layout === 'html') { img.setAttribute('src', src || ''); sl.html = serializar(slideAtivo()); sl.editado = true; marcar(); }
  });
}
function selecionarBloco(caminho) {
  st.bloco = caminho;
  const ks = caminho.split('/');
  for (let k = 3; k <= ks.length; k++) st.fechados.delete(ks.slice(0, k).join('/'));
  const re = /colunas\/(\d+)/g; let m;
  while ((m = re.exec(caminho))) st.colAtiva[caminho.slice(0, m.index + 7)] = +m[1];
  const doc = docPalco(); $$('.ed-sel', doc).forEach(x => x.classList.remove('ed-sel'));
  const el = doc.querySelector('[data-b="' + caminho + '"]'); if (el) el.classList.add('ed-sel');
  abaAtiva('slide'); renderPainelSlide();
  const alvo = $('.bloco.sel'); if (alvo) alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ------------------------------------------------------------ notas (roteiro) */
function notasHtml(s) {
  const t = document.createElement('template'); t.innerHTML = s.html || '';
  const nt = t.content.querySelector('.nt'); return nt ? nt.innerHTML.trim() : '';
}
function setNotasHtml(s, v) {
  const t = document.createElement('template'); t.innerHTML = s.html || '';
  const raiz = t.content.firstElementChild; if (!raiz) return;
  let nt = raiz.querySelector('.nt');
  if (!v) { if (nt) nt.remove(); } else { if (!nt) { nt = document.createElement('div'); nt.className = 'nt'; raiz.append(nt); } nt.innerHTML = v; }
  s.html = raiz.outerHTML; s.editado = true;
}
function renderNotas() {
  const box = $('#notas'); box.innerHTML = '';
  const s = st.dados && st.dados.slides[st.sel];
  if (!s) { box.append(h('p', { class: 'muted' }, 'Abra uma aula.')); return; }
  const salvarNotas = debounce(v => {
    if (s.layout === 'html') { setNotasHtml(s, v); marcar(); } else { s.notas = v; marcar(false); }
  }, 400);
  box.append(editorRico(s.layout === 'html' ? notasHtml(s) : (s.notas || ''), salvarNotas, { placeholder: 'O que dizer neste slide…' }));
}

/* ------------------------------------------------------------ painel: abas */
function abaAtiva(nome) {
  $$('.abas button').forEach(b => b.classList.toggle('on', b.dataset.aba === nome));
  $$('.aba').forEach(a => a.classList.toggle('on', a.id === 'aba-' + nome));
  if (nome === 'tema') renderTema(); if (nome === 'aula') renderAula(); if (nome === 'ia') renderIA();
}
function renderPainel() { renderPainelSlide(); renderAula(); renderTema(); renderIA(); }

/* ------------------------------------------------------------ editor de texto rico */
/* Campos HTML ganham uma barra de formatação (negrito, itálico, marca-texto, código,
   lista, link…) e um botão </> para ver/editar o HTML. Colar insere texto puro. */
function limparRico(html) {
  let v = (html || '').replace(/\u200b/g, '');
  v = v.replace(/<(b|strong|em|i|u|code)>\s*<\/\1>/gi, '').replace(/<span(?:\s+style="font-size:[^"]*")?>\s*<\/span>/gi, ''); // só tags vazias sem atributos
  return /^(\s|<br\s*\/?>|&nbsp;)*$/i.test(v) ? '' : v.trim();
}
function dentroDe(no, raiz, teste) {
  for (let n = no && (no.nodeType === 1 ? no : no.parentNode); n && n !== raiz; n = n.parentNode) if (teste(n)) return n;
  return null;
}
function envolver(area, tag, cls) {
  area.focus();
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0); if (!area.contains(r.commonAncestorContainer)) return;
  const casa = n => n.tagName === tag.toUpperCase() && (!cls || n.classList.contains(cls));
  const atual = dentroDe(r.commonAncestorContainer, area, casa);
  if (atual) { // desfaz
    const pai = atual.parentNode; while (atual.firstChild) pai.insertBefore(atual.firstChild, atual); pai.removeChild(atual);
  } else {
    if (r.collapsed) return toast('Selecione o trecho que quer formatar.');
    const el = document.createElement(tag); if (cls) el.className = cls;
    el.append(r.extractContents()); r.insertNode(el);
    sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); sel.addRange(nr);
  }
  area.dispatchEvent(new Event('input', { bubbles: true }));
}
/* Tamanho da fonte (como no Word): envolve o trecho em <span style="font-size:N em">.
   Usa "em" (relativo) para acompanhar o tema, o zoom A−/A+ da apresentação e o PDF. */
const TAMANHOS = [0.6, 0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const ehSpanTam = n => n.tagName === 'SPAN' && n.style && n.style.fontSize && /em$/.test(n.style.fontSize);
function tamanhoAtual(area) {
  const sel = getSelection(); if (!sel.rangeCount) return 1;
  let t = 1;
  for (let n = sel.getRangeAt(0).commonAncestorContainer; n && n !== area; n = n.parentNode)
    if (n.nodeType === 1 && ehSpanTam(n)) t *= parseFloat(n.style.fontSize) || 1;
  return Math.round(t * 100) / 100;
}
function aplicarTamanho(area, alvo) {
  area.focus();
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (!area.contains(r.commonAncestorContainer)) return;
  if (r.collapsed) return toast('Selecione o trecho cujo tamanho você quer mudar.');
  const atual = tamanhoAtual(area);
  let novo = alvo;
  if (alvo === 'mais') novo = TAMANHOS.find(x => x > atual + 0.001) || TAMANHOS[TAMANHOS.length - 1];
  if (alvo === 'menos') novo = [...TAMANHOS].reverse().find(x => x < atual - 0.001) || TAMANHOS[0];
  // span de tamanho que já envolve exatamente a seleção: só ajusta o valor
  const dono = dentroDe(r.commonAncestorContainer, area, ehSpanTam);
  if (dono && dono.textContent === r.toString()) {
    const fora = (atual / (parseFloat(dono.style.fontSize) || 1));
    const v = Math.round(novo / fora * 1000) / 1000;
    if (Math.abs(v - 1) < 0.001) { const pai = dono.parentNode; while (dono.firstChild) pai.insertBefore(dono.firstChild, dono); pai.removeChild(dono); }
    else { dono.style.fontSize = v + 'em'; const nr = document.createRange(); nr.selectNodeContents(dono); sel.removeAllRanges(); sel.addRange(nr); }
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return novo;
  }
  const frag = r.extractContents();
  frag.querySelectorAll && frag.querySelectorAll('span').forEach(x => { // remove tamanhos internos (não acumular)
    if (ehSpanTam(x)) { x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style'); if (!x.attributes.length) { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); } }
  });
  const v = Math.round(novo / (atual || 1) * 1000) / 1000; // relativo ao tamanho herdado
  let no;
  if (Math.abs(v - 1) < 0.001) { no = frag; }
  else { no = document.createElement('span'); no.style.fontSize = v + 'em'; no.append(frag); }
  const nr = document.createRange();
  if (no.nodeType === 1) { r.insertNode(no); nr.selectNodeContents(no); }
  else { // voltou a 100%: insere o conteúdo solto e reseleciona entre marcadores
    const ini = document.createTextNode(''), fim = document.createTextNode('');
    r.insertNode(fim); r.insertNode(no); r.insertNode(ini);
    nr.setStartAfter(ini); nr.setEndBefore(fim);
  }
  sel.removeAllRanges(); sel.addRange(nr);
  area.dispatchEvent(new Event('input', { bubbles: true }));
  return novo;
}

const desarmar = html => { let a, h = html || ''; do { a = h; h = h.replace(/(<[a-z][^>]*?\s)on([a-z]+)=/gi, '$1data-edon-$2='); } while (h !== a); return h; };
const rearmar = html => (html || '').replace(/data-edon-([a-z]+)=/gi, 'on$1=');
function editorRico(valor, aoMudar, op = {}) {
  const area = h('div', { class: 'rico-area' + (op.compacto ? ' compacto' : ''), contenteditable: 'true', spellcheck: 'true', 'data-placeholder': op.placeholder || '' });
  const relativo = u => u && !/^(https?:|data:|blob:|\/|#)/i.test(u);
  const ajustarImgs = () => { if (!op.baseImg) return; $$('img[src]', area).forEach(im => { const u = im.getAttribute('src'); if (relativo(u) && !im.hasAttribute('data-edsrc')) { im.setAttribute('data-edsrc', u); im.setAttribute('src', op.baseImg + u); } }); };
  const html = () => { // conteúdo da área com os caminhos de imagem originais
    if (!op.baseImg) return area.innerHTML;
    const c = area.cloneNode(true);
    $$('img[data-edsrc]', c).forEach(im => { im.setAttribute('src', im.getAttribute('data-edsrc')); im.removeAttribute('data-edsrc'); });
    return c.innerHTML;
  };
  area.innerHTML = desarmar(valor); ajustarImgs();
  const fonte = h('textarea', { class: 'rico-fonte mono', spellcheck: 'false', hidden: true });
  const emit = () => aoMudar(rearmar(limparRico(html())));
  area.addEventListener('input', emit);
  area.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  area.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && op.aoEnter && !dentroDe(getSelection().anchorNode, area, n => n.tagName === 'LI')) { e.preventDefault(); op.aoEnter(); return; }
    if (e.key === 'Enter' && (e.shiftKey || op.linha) && !op.aoEnter) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
  });
  fonte.addEventListener('input', () => { area.innerHTML = desarmar(fonte.value); ajustarImgs(); aoMudar(limparRico(fonte.value)); });
  const cmd = (c, v) => { area.focus(); document.execCommand(c, false, v); emit(); };
  const link = () => {
    area.focus();
    const a = dentroDe(getSelection().anchorNode, area, n => n.tagName === 'A');
    const url = prompt('Endereço do link (vazio remove):', a ? a.getAttribute('href') : 'https://');
    if (url === null) return;
    if (!url.trim()) { if (a) { const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(a); sel.removeAllRanges(); sel.addRange(r); } cmd('unlink'); return; }
    if (a) { a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); emit(); return; }
    if (getSelection().isCollapsed) return toast('Selecione o texto do link.');
    cmd('createLink', url);
    $$('a[href]', area).forEach(x => { if (!x.target) { x.target = '_blank'; x.rel = 'noopener'; } });
    emit();
  };
  const tam = h('select', { class: 'rico-tam', title: 'Tamanho da fonte do trecho selecionado (100% = tamanho normal do tema)', tabindex: '-1',
    onmousedown: () => { const sel = getSelection(); tam._r = sel.rangeCount && area.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0).cloneRange() : null; },
    onchange: () => {
      if (tam._r) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(tam._r); }
      aplicarTamanho(area, parseFloat(tam.value));
    } }, ...TAMANHOS.map(x => h('option', { value: String(x) }, Math.round(x * 100) + '%')));
  tam.value = '1';
  const sincTam = () => { const sel = getSelection(); if (sel.rangeCount && area.contains(sel.anchorNode)) tam.value = String(TAMANHOS.reduce((a, b) => Math.abs(b - tamanhoAtual(area)) < Math.abs(a - tamanhoAtual(area)) ? b : a)); };
  area.addEventListener('keyup', sincTam); area.addEventListener('mouseup', sincTam);
  area.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '>' || e.key === '.')) { e.preventDefault(); const t = aplicarTamanho(area, 'mais'); if (t) tam.value = String(t); }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '<' || e.key === ',')) { e.preventDefault(); const t = aplicarTamanho(area, 'menos'); if (t) tam.value = String(t); }
  });
  const limparTamanho = () => {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    $$('span', area).filter(x => ehSpanTam(x) && r.intersectsNode(x)).forEach(x => {
      x.style.fontSize = ''; if (!x.getAttribute('style')) x.removeAttribute('style');
      if (!x.attributes.length) { const pai = x.parentNode; while (x.firstChild) pai.insertBefore(x.firstChild, x); pai.removeChild(x); }
    });
    emit(); tam.value = '1';
  };
  const bt = (rot, titulo, fn, cls) => h('button', { type: 'button', class: cls || '', title: titulo, tabindex: '-1', onmousedown: e => e.preventDefault(), onclick: fn }, rot);
  const barra = h('div', { class: 'rico-barra' },
    bt(h('b', {}, 'N'), 'Negrito (Ctrl+B)', () => cmd('bold')),
    bt(h('i', {}, 'I'), 'Itálico (Ctrl+I)', () => cmd('italic')),
    bt(h('span', { class: 'mk-amostra' }, 'M'), 'Marca-texto', () => envolver(area, 'span', 'mk')),
    bt(h('code', {}, 'cód'), 'Código', () => envolver(area, 'code')),
    op.compacto ? null : bt('•', 'Lista com marcadores', () => cmd('insertUnorderedList')),
    op.compacto ? null : bt('1.', 'Lista numerada', () => cmd('insertOrderedList')),
    bt('↵', 'Quebra de linha (Shift+Enter)', () => cmd('insertLineBreak')),
    bt('🔗', 'Link (Ctrl+K)', link),
    bt('A−', 'Diminuir a fonte do trecho selecionado (Ctrl+Shift+<)', () => { const t = aplicarTamanho(area, 'menos'); if (t) tam.value = String(t); }),
    tam,
    bt('A+', 'Aumentar a fonte do trecho selecionado (Ctrl+Shift+>)', () => { const t = aplicarTamanho(area, 'mais'); if (t) tam.value = String(t); }),
    bt('⌫', 'Limpar formatação do trecho selecionado (inclui tamanho)', () => { cmd('removeFormat'); cmd('unlink'); limparTamanho(); }),
    h('span', { class: 'rico-esp' }),
    bt('</>', 'Ver / editar o HTML', e => {
      const ver = fonte.hidden; fonte.hidden = !ver; area.hidden = ver;
      e.currentTarget.classList.toggle('on', ver);
      if (ver) { fonte.value = rearmar(limparRico(html())); fonte.style.height = Math.max(60, area.offsetHeight + 10) + 'px'; fonte.focus(); } else area.focus();
    }, 'rico-html'));
  const raiz = h('div', { class: 'rico' + (op.compacto ? ' rico-compacto' : '') }, barra, area, fonte);
  if (op.inicioHtml && /<(table|div|section|iframe|svg|script|style)\b/i.test(valor || '')) { // HTML estrutural: começa no código
    fonte.hidden = false; area.hidden = true; fonte.value = valor || ''; fonte.style.height = '160px';
    const b = barra.querySelector('.rico-html'); if (b) b.classList.add('on');
  }
  return raiz;
}
function campoRotulo(rot, ...filhos) { return h('div', { class: 'campo' }, h('span', { class: 'rotulo' }, rot), ...filhos); }
const LISTAS_SIMPLES = ['linhas_classe', 'cabecalho_classe'];
// campos de texto que NÃO são HTML (atributos, nomes de arquivo, números)
const TEXTO_SIMPLES = ['alt', 'url', 'arquivo', 'cronometro_min', 'src', 'nome'];
function listaRica(itens, aoMudar, rot) {
  const box = h('div', { class: 'lista-rica' });
  const lista = (itens || []).slice();
  const salvar = () => aoMudar(lista.filter(x => x !== undefined));
  const redesenhar = (foco) => {
    box.innerHTML = '';
    lista.forEach((it, i) => {
      const ed = editorRico(it, v => { lista[i] = v; salvar(); }, {
        compacto: true, placeholder: 'Item ' + (i + 1),
        aoEnter: () => { lista.splice(i + 1, 0, ''); salvar(); redesenhar(i + 1); }
      });
      const mov = d => { const j = i + d; if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; salvar(); redesenhar(j); };
      box.append(h('div', { class: 'item-rico' }, h('span', { class: 'num-item' }, i + 1), ed,
        h('div', { class: 'ops-item' },
          h('button', { type: 'button', title: 'Subir', onclick: () => mov(-1) }, '↑'),
          h('button', { type: 'button', title: 'Descer', onclick: () => mov(1) }, '↓'),
          h('button', { type: 'button', class: 'perigo', title: 'Remover item', onclick: () => { lista.splice(i, 1); salvar(); redesenhar(); } }, '✕'))));
    });
    box.append(h('button', { type: 'button', class: 'add-item', onclick: () => { lista.push(''); salvar(); redesenhar(lista.length - 1); } }, '+ Adicionar item'));
    if (foco !== undefined) { const a = $$('.rico-area', box)[foco]; if (a) a.focus(); }
  };
  redesenhar();
  return campoRotulo(h('span', {}, rot, ' ', h('span', { class: 'muted' }, '— Enter cria um novo item; Shift+Enter quebra a linha')), box);
}

/* ------------------------------------------------------------ formulários genéricos */
function campoEl(c, base, onAlterar) {
  const caminho = base ? base + '/' + c.nome : c.nome; const v = getP(st.dados, caminho);
  const alterar = (val, rerender = true) => { setP(st.dados, caminho, val); marcar(rerender); if (onAlterar) onAlterar(); };
  const rot = c.rotulo || c.nome;
  switch (c.tipo) {
    case 'texto':
      if (!TEXTO_SIMPLES.includes(c.nome))
        return campoRotulo(rot, editorRico(v, val => alterar(val), { compacto: true, linha: true, placeholder: c.padrao || '' }));
      return h('label', {}, rot, h('input', { value: v || '', placeholder: c.padrao || '', oninput: e => alterar(e.target.value) }));
    case 'proporcao':
      return h('label', {}, rot, h('input', { value: v || '', placeholder: c.padrao || '', oninput: e => alterar(e.target.value) }));
    case 'html':
      return campoRotulo(rot, editorRico(v, val => alterar(val)));
    case 'codigo': {
      const dono = getP(st.dados, base);
      if (c.nome === 'html' && dono && dono.tipo === 'html') // bloco "HTML livre": visual + </>
        return campoRotulo(rot, editorRico(v, val => alterar(val), { placeholder: '<p>HTML</p>', inicioHtml: true }));
      return h('label', {}, rot, h('textarea', { class: 'mono', rows: 6, value: v || '', spellcheck: 'false', oninput: e => alterar(e.target.value) }));
    }
    case 'lista':
      if (LISTAS_SIMPLES.includes(c.nome))
        return h('label', {}, rot + ' (um por linha)', h('textarea', { rows: Math.min(8, Math.max(2, (v || []).length + 1)), value: (v || []).join('\n'),
          oninput: e => alterar(e.target.value.split('\n').map(x => x.trim())) }));
      return listaRica(v, val => alterar(val.filter(x => x !== '' || false)), rot);
    case 'selecao': {
      const sel = h('select', { onchange: e => alterar(e.target.value) });
      for (const [k, r] of Object.entries(c.opcoes)) sel.append(h('option', { value: k }, r));
      sel.value = v || Object.keys(c.opcoes)[0]; return h('label', {}, rot, sel);
    }
    case 'bool':
      return h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!v, onchange: e => alterar(e.target.checked) }), rot);
    case 'imagem': {
      const inp = h('input', { value: v || '', placeholder: 'img/arquivo.png', oninput: e => alterar(e.target.value) });
      return h('label', {}, rot, h('div', { class: 'linha-bts' }, inp,
        h('button', { type: 'button', onclick: () => escolherImagem(src => { inp.value = src || ''; alterar(src || ''); }) }, 'Escolher…')));
    }
    case 'json':
      return h('label', {}, rot, h('textarea', { class: 'mono', rows: 2, value: v ? JSON.stringify(v) : '',
        oninput: e => { try { alterar(e.target.value.trim() ? JSON.parse(e.target.value) : {}); e.target.style.borderColor = ''; } catch (x) { e.target.style.borderColor = 'red'; } } }));
    case 'tabela':
      return campoRotulo(h('span', {}, 'Tabela ', h('span', { class: 'muted' }, '— clique numa célula para editar; ⋯ define a cor da linha/célula')), editorTabela(base));
    case 'itens': {
      const box = h('div', { class: 'caixa' }, h('b', {}, rot));
      (v || []).forEach((it, i) => {
        const item = h('div', { class: 'item' });
        c.subcampos.forEach(sc => item.append(campoEl(sc, caminho + '/' + i)));
        item.append(h('button', { type: 'button', class: 'perigo', onclick: () => { v.splice(i, 1); marcar(); renderPainelSlide(); } }, 'Remover'));
        box.append(item);
      });
      box.append(h('button', { type: 'button', onclick: () => { setP(st.dados, caminho, (v || []).concat([{}])); marcar(); renderPainelSlide(); } }, '+ Adicionar'));
      return box;
    }
    case 'blocos':
      return h('div', { class: 'caixa' }, h('b', {}, rot), editorBlocos(caminho));
    case 'colunas':
      return editorColunas(caminho, base);
  }
  return h('div', {}, rot + ': tipo não suportado');
}
const CAMPOS_DA_GRADE = ['cabecalho', 'linhas_classe', 'celulas_classe', 'preencher']; // editados dentro da grade da tabela
function formCampos(campos, base, cont) {
  const dono = base ? getP(st.dados, base) : null;
  for (const c of campos) {
    if (dono && dono.tipo === 'tabela' && CAMPOS_DA_GRADE.includes(c.nome)) continue;
    cont.append(campoEl(c, base));
  }
}

/* ------------------------------------------------------------ editor de tabela */
const CLASSES_LINHA = { '': 'normal', hl: 'destacada (verde)', bs: 'base / referência' };
const CLASSES_CELULA = { '': 'normal', bom: 'valor bom (verde)', ruim: 'valor ruim (vermelho)', cen: 'centralizada' };
function editorTabela(base) {
  const b = getP(st.dados, base);
  b.cabecalho = b.cabecalho || []; b.linhas = b.linhas || [];
  const ncol = () => Math.max(b.cabecalho.length, ...b.linhas.map(r => r.length), 1);
  const normalizar = () => {
    const n = ncol();
    while (b.cabecalho.length < n) b.cabecalho.push('');
    b.linhas.forEach(r => { while (r.length < n) r.push(''); });
    b.linhas_classe = (b.linhas_classe || []).slice(0, b.linhas.length);
    while (b.linhas_classe.length < b.linhas.length) b.linhas_classe.push('');
    if (!b.linhas_classe.some(Boolean)) delete b.linhas_classe;
    if (b.celulas_classe && !Object.keys(b.celulas_classe).length) delete b.celulas_classe;
  };
  normalizar();
  const mudou = (redesenhar) => { normalizar(); marcar(); if (redesenhar) renderPainelSlide(true); };
  const remapear = fn => { // reescreve as chaves "linha,coluna" das classes por célula
    const novo = {};
    for (const [k, v] of Object.entries(b.celulas_classe || {})) { const [r, c] = k.split(',').map(Number); const nk = fn(r, c); if (nk) novo[nk[0] + ',' + nk[1]] = v; }
    b.celulas_classe = novo;
  };
  const tb = h('table', { class: 'tabela-ed' });
  // cabeçalho
  const trc = h('tr', {}, h('th', { class: 'canto' }, '#'));
  for (let c = 0; c < ncol(); c++) {
    trc.append(h('th', {},
      editorRico(b.cabecalho[c], v => { b.cabecalho[c] = v; marcar(); }, { compacto: true, linha: true, placeholder: 'Coluna ' + (c + 1) }),
      h('div', { class: 'ops-cel' },
        h('button', { type: 'button', title: 'Mover coluna para a esquerda', disabled: c === 0, onclick: () => {
          [b.cabecalho[c - 1], b.cabecalho[c]] = [b.cabecalho[c], b.cabecalho[c - 1]];
          b.linhas.forEach(r => { [r[c - 1], r[c]] = [r[c], r[c - 1]]; });
          remapear((r, k) => [r, k === c ? c - 1 : k === c - 1 ? c : k]); mudou(true); } }, '←'),
        h('button', { type: 'button', title: 'Mover coluna para a direita', disabled: c === ncol() - 1, onclick: () => {
          [b.cabecalho[c + 1], b.cabecalho[c]] = [b.cabecalho[c], b.cabecalho[c + 1]];
          b.linhas.forEach(r => { [r[c + 1], r[c]] = [r[c], r[c + 1]]; });
          remapear((r, k) => [r, k === c ? c + 1 : k === c + 1 ? c : k]); mudou(true); } }, '→'),
        h('button', { type: 'button', class: 'perigo', title: 'Excluir coluna', disabled: ncol() <= 1, onclick: () => {
          if (!confirm('Excluir a coluna ' + (c + 1) + '?')) return;
          b.cabecalho.splice(c, 1); b.linhas.forEach(r => r.splice(c, 1));
          remapear((r, k) => k === c ? null : [r, k > c ? k - 1 : k]); mudou(true); } }, '✕'))));
  }
  trc.append(h('th', { class: 'canto' }, h('button', { type: 'button', title: 'Nova coluna', onclick: () => { b.cabecalho.push(''); b.linhas.forEach(r => r.push('')); mudou(true); } }, '+ col')));
  tb.append(trc);
  // linhas
  b.linhas.forEach((linha, r) => {
    const cls = (b.linhas_classe || [])[r] || '';
    const selLinha = h('select', { title: 'Cor da linha', onchange: e => { b.linhas_classe = b.linhas_classe || b.linhas.map(() => ''); b.linhas_classe[r] = e.target.value; mudou(true); } },
      ...Object.entries(CLASSES_LINHA).map(([k, t]) => h('option', { value: k }, t)));
    selLinha.value = cls;
    const tr = h('tr', { class: cls ? 'cls-' + cls : '' }, h('td', { class: 'canto' },
      h('div', { class: 'num-linha' }, r + 1),
      h('div', { class: 'ops-cel' },
        h('button', { type: 'button', title: 'Subir linha', disabled: r === 0, onclick: () => {
          [b.linhas[r - 1], b.linhas[r]] = [b.linhas[r], b.linhas[r - 1]];
          if (b.linhas_classe) [b.linhas_classe[r - 1], b.linhas_classe[r]] = [b.linhas_classe[r], b.linhas_classe[r - 1]];
          remapear((k, c) => [k === r ? r - 1 : k === r - 1 ? r : k, c]); mudou(true); } }, '↑'),
        h('button', { type: 'button', title: 'Descer linha', disabled: r === b.linhas.length - 1, onclick: () => {
          [b.linhas[r + 1], b.linhas[r]] = [b.linhas[r], b.linhas[r + 1]];
          if (b.linhas_classe) [b.linhas_classe[r + 1], b.linhas_classe[r]] = [b.linhas_classe[r], b.linhas_classe[r + 1]];
          remapear((k, c) => [k === r ? r + 1 : k === r + 1 ? r : k, c]); mudou(true); } }, '↓'),
        h('button', { type: 'button', class: 'perigo', title: 'Excluir linha', onclick: () => {
          b.linhas.splice(r, 1); if (b.linhas_classe) b.linhas_classe.splice(r, 1);
          remapear((k, c) => k === r ? null : [k > r ? k - 1 : k, c]); mudou(true); } }, '✕')),
      h('details', { class: 'mais-cel' }, h('summary', { title: 'Cor da linha' }, '⋯'), selLinha)));
    for (let c = 0; c < ncol(); c++) {
      const chave = r + ',' + c; const cc = (b.celulas_classe || {})[chave] || '';
      const selCel = h('select', { title: 'Estilo da célula', onchange: e => {
        b.celulas_classe = b.celulas_classe || {}; if (e.target.value) b.celulas_classe[chave] = e.target.value; else delete b.celulas_classe[chave]; mudou(true); } },
        ...Object.entries(CLASSES_CELULA).map(([k, t]) => h('option', { value: k }, t)));
      selCel.value = cc;
      tr.append(h('td', { class: cc ? 'cel-' + cc : '' },
        editorRico(linha[c], v => { linha[c] = v; marcar(); }, { compacto: true, linha: true }),
        h('details', { class: 'mais-cel' }, h('summary', { title: 'Estilo da célula' }, '⋯'), selCel)));
    }
    tb.append(tr);
  });
  return h('div', { class: 'tabela-wrap' }, tb,
    h('div', { class: 'linha-bts' },
      h('button', { type: 'button', onclick: () => { b.linhas.push(Array(ncol()).fill('')); mudou(true); } }, '+ Linha'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!b.preencher, onchange: e => { b.preencher = e.target.checked; marcar(); } }), 'Esticar até a altura disponível')));
}
function resumoBloco(b) {
  const t = b.titulo || b.texto || b.html || b.legenda || b.pergunta || (b.itens && b.itens[0] && (b.itens[0].valor || b.itens[0].titulo || b.itens[0])) || b.src || (b.cabecalho || []).join(' · ') || '';
  return txt(typeof t === 'string' ? t : JSON.stringify(t)).slice(0, 50);
}
function blocoPadrao(tipo) {
  return ({
    texto: { tipo, html: '<p>Texto.</p>' }, titulo: { tipo, texto: 'Subtítulo' }, lista: { tipo, itens: ['Item 1', 'Item 2'] },
    card: { tipo, titulo: 'Título', html: '<p>Texto.</p>' }, destaque: { tipo, estilo: 'cd', titulo: 'Destaque', html: '<p>Texto.</p>' },
    chips: { tipo, itens: ['Etiqueta 1', 'Etiqueta 2'] }, pergunta: { tipo, rotulo: 'Pergunta', html: 'Qual é a pergunta?' },
    tabela: { tipo, cabecalho: ['A', 'B'], linhas: [['1', '2']] }, kpis: { tipo, itens: [{ valor: '10', texto: 'legenda' }, { valor: '20', texto: 'legenda' }] },
    faixa: { tipo, html: 'Mensagem principal.' }, figura: { tipo, src: '', alt: '' },
    duelo: { tipo, antes_rotulo: 'Antes', antes_valor: 'A', depois_rotulo: 'Depois', depois_valor: 'B' },
    lins: { tipo, itens: [{ titulo: 'Ponto', html: 'Explicação' }] }, evo: { tipo, titulo: 'Evolução', linhas: [{ rotulo: 'Métrica', valor: '1 → 2 ▲', tendencia: 'up' }] },
    revelar: { tipo, pergunta: 'Pergunta para a turma', resposta: 'Resposta' }, codigo: { tipo, codigo: 'print("olá")' },
    video: { tipo, url: '' }, grade: { tipo, proporcao: '1fr 1fr', colunas: [[], []] }, html: { tipo, html: '<p>HTML</p>' }
  })[tipo] || { tipo };
}
function editorBlocos(caminho) {
  const lista = getP(st.dados, caminho) || [];
  const box = h('div', {});
  lista.forEach((b, i) => {
    const p = caminho + '/' + i; const def = CAT.blocos[b.tipo] || { rotulo: b.tipo, campos: [] };
    const aberto = !st.fechados.has(p);
    const mov = (d) => { const j = i + d; if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; st.bloco = null; marcar(); renderPainelSlide(); };
    const el = h('div', { class: 'bloco' + (st.bloco === p ? ' sel' : '') },
      h('div', { class: 'cab', onclick: () => { aberto ? st.fechados.add(p) : st.fechados.delete(p); renderPainelSlide(); } },
        h('span', {}, aberto ? '▾' : '▸'),
        h('span', { class: 'nome' }, def.rotulo + ' ', h('small', {}, resumoBloco(b))),
        h('button', { title: 'Subir', onclick: e => { e.stopPropagation(); mov(-1); } }, '↑'),
        h('button', { title: 'Descer', onclick: e => { e.stopPropagation(); mov(1); } }, '↓'),
        h('button', { title: 'Duplicar', onclick: e => { e.stopPropagation(); lista.splice(i + 1, 0, clone(b)); marcar(); renderPainelSlide(); } }, '⧉'),
        h('button', { title: 'Excluir', class: 'perigo', onclick: e => { e.stopPropagation(); lista.splice(i, 1); st.bloco = null; marcar(); renderPainelSlide(); } }, '✕')));
    if (aberto) { const corpo = h('div', { class: 'corpo' }); formCampos(def.campos, p, corpo); el.append(corpo); }
    box.append(el);
  });
  const sel = h('select', { onchange: e => { if (!e.target.value) return; lista.push(blocoPadrao(e.target.value)); setP(st.dados, caminho, lista); st.fechados.delete(caminho + '/' + (lista.length - 1)); marcar(); renderPainelSlide(); } },
    h('option', { value: '' }, '+ Adicionar bloco…'), ...Object.entries(CAT.blocos).map(([k, v]) => h('option', { value: k }, v.rotulo)));
  box.append(sel);
  return box;
}
function editorColunas(caminho, base) {
  const cols = getP(st.dados, caminho) || [[]];
  if (!getP(st.dados, caminho)) setP(st.dados, caminho, cols);
  const chave = caminho; const ativa = Math.max(0, Math.min(st.colAtiva[chave] || 0, cols.length - 1));
  const ajustarProp = () => {
    const pp = base + '/proporcao'; const atual = (getP(st.dados, pp) || '').split(/\s+/).filter(Boolean);
    if (atual.length !== cols.length) setP(st.dados, pp, Array(cols.length).fill('1fr').join(' '));
  };
  const tabs = h('div', { class: 'colunas-tabs' });
  cols.forEach((_, i) => tabs.append(h('button', { type: 'button', class: i === ativa ? 'on' : '', onclick: () => { st.colAtiva[chave] = i; renderPainelSlide(); } }, 'Coluna ' + (i + 1))));
  tabs.append(h('button', { type: 'button', title: 'Nova coluna', onclick: () => { cols.push([]); ajustarProp(); st.colAtiva[chave] = cols.length - 1; marcar(); renderPainelSlide(); } }, '+'));
  if (cols.length > 1) tabs.append(h('button', { type: 'button', class: 'perigo', title: 'Remover a coluna selecionada', onclick: () => { if (!confirm('Remover a coluna ' + (ativa + 1) + ' e seus blocos?')) return; cols.splice(ativa, 1); ajustarProp(); st.colAtiva[chave] = 0; marcar(); renderPainelSlide(); } }, '− coluna'));
  return h('div', { class: 'caixa' }, h('b', {}, 'Colunas'), tabs, editorBlocos(caminho + '/' + ativa));
}

/* ------------------------------------------------------------ painel: slide */
function renderPainelSlide(manterRolagem) {
  const box = $('#aba-slide'); const top = box.scrollTop; box.innerHTML = '';
  const s = st.dados && st.dados.slides[st.sel];
  if (!s) { box.append(h('p', { class: 'vazio' }, 'Abra uma aula para editar.')); return; }
  const base = 'slides/' + st.sel;
  const sel = h('select', { onchange: e => trocarLayout(e.target.value) });
  for (const [k, v] of Object.entries(CAT.layouts)) sel.append(h('option', { value: k }, v.rotulo));
  sel.value = s.layout;
  box.append(h('h3', {}, 'Slide ' + (st.sel + 1)), h('label', {}, 'Layout', sel));
  if (s.layout === 'html') {
    let avisou = false;
    const ed = editorRico(s.html || '', v => {
      if (!/^\s*<div\b[^>]*class="sl[\s"]/.test(v)) { if (!avisou) { avisou = true; toast('O slide precisa continuar dentro de <div class="sl">… — use </> para conferir o código.', true); } return; }
      avisou = false; s.html = v.trim(); s.editado = true; marcar(); renderNotas(); agendarListaHtml();
    }, { placeholder: '<div class="sl">…</div>', baseImg: urlAula('') });
    ed.classList.add('rico-slide');
    box.append(campoRotulo(h('span', {}, 'Conteúdo do slide ', h('span', { class: 'muted' }, '— edite aqui com a barra de formatação ou direto no palco; </> mostra o HTML')), ed));
    box.append(h('p', { class: 'muted' }, 'Clique numa imagem e use "Trocar imagem" (ou dê duplo clique nela).'),
      h('div', { class: 'linha-bts' },
        h('button', { onclick: editarCodigo }, 'Editar código HTML'),
        h('button', { onclick: () => st.imgSel ? trocarImagemPalco(st.imgSel.el) : toast('Clique numa imagem do slide primeiro.') }, 'Trocar imagem'),
        h('button', { onclick: () => iaConverter() }, '✦ Converter em blocos (IA)')));
    if (s.prefixo !== undefined && s.prefixo !== null) box.append(h('p', { class: 'muted' }, s.editado ? 'Este slide foi editado no editor.' : 'Inalterado em relação ao HTML original.'));
  } else {
    formCampos(CAT.layouts[s.layout].campos, base, box);
    if (s.layout === 'conteudo') box.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!s.sem_numero, onchange: e => { s.sem_numero = e.target.checked; marcar(); } }), 'Sem número no cabeçalho'));
    box.append(h('div', { class: 'linha-bts' }, h('button', { onclick: () => iaConverter('Reorganize o conteúdo deste slide escolhendo o layout e os blocos mais claros para projeção, sem perder informação.') }, '✦ Sugerir layout melhor (IA)')));
  }
  if (manterRolagem) box.scrollTop = top;
}
function trocarLayout(novo) {
  const s = st.dados.slides[st.sel]; if (novo === s.layout) return;
  if (!confirm('Trocar o layout pode descartar campos que não existem no novo layout. Continuar?')) return renderPainelSlide();
  const mapa = { capa: 'Capa', conteudo: 'Conteúdo — 1 coluna', secao: 'Seção / encerramento', imagem: 'Imagem inteira', html: 'HTML livre' };
  const n = MODELOS[mapa[novo]]();
  const tit = s.layout === 'html' ? tituloSlide(s) : s.titulo;
  if (tit && 'titulo' in n) n.titulo = tit;
  if (s.layout === 'html' && novo !== 'html') n.notas = notasHtml(s); else if (s.notas && novo !== 'html') n.notas = s.notas;
  if (s.prefixo !== undefined) n.prefixo = s.prefixo;
  st.dados.slides[st.sel] = n; st.bloco = null; marcar(); renderLista(); renderPainelSlide(); renderNotas();
}
function editarCodigo() {
  const s = st.dados.slides[st.sel]; const d = $('#d-codigo');
  $('#codigo').value = s.html || ''; d.showModal();
  $('#codigo-ok').onclick = () => {
    const v = $('#codigo').value.trim();
    if (!/^<div[^>]*class="sl[\s"]/.test(v)) return toast('O HTML precisa começar com <div class="sl">', true);
    s.html = v; s.editado = true; d.close(); marcar(); renderLista(); renderNotas();
  };
}

/* ------------------------------------------------------------ painel: aula */
function renderAula() {
  const box = $('#aba-aula'); box.innerHTML = '';
  if (!st.dados) return;
  const d = st.dados; d.meta = d.meta || {};
  box.append(h('h3', {}, 'Dados da aula'));
  const campos = [
    { nome: 'titulo', tipo: 'texto', rotulo: 'Título da página (aparece no índice: "Disciplina · Aula NN — Assunto")' },
  ];
  if (!legado()) campos.push(
    { nome: 'titulo_barra', tipo: 'texto', rotulo: 'Título na barra superior' },
    { nome: 'arquivo', tipo: 'texto', rotulo: 'Nome do arquivo HTML (ex.: aula05.html)' },
    { nome: 'cronometro_min', tipo: 'texto', rotulo: 'Duração do cronômetro (minutos)' },
    { nome: 'rodape', tipo: 'html', rotulo: 'Texto do rodapé (vazio = sem rodapé)' },
    { nome: 'numerar', tipo: 'bool', rotulo: 'Numerar os slides de conteúdo' },
    { nome: 'mostrar_pdf', tipo: 'bool', rotulo: 'Botão "Exportar PDF" na navegação' });
  formCampos(campos, 'meta', box);
  box.append(h('p', { class: 'muted' }, 'Pasta: ', h('code', {}, pastaAula())));
  if (legado()) {
    box.append(h('h3', {}, 'Aula importada'),
      h('p', {}, 'Estado: ', h('b', {}, d.estado === 'importada' ? 'importada — o HTML original continua oficial' : 'assumida pelo editor')),
      h('p', { class: 'muted' }, st.ver ? (st.ver.ok ? '✔ ' : '⚠ ') + 'Verificação: ' + st.ver.msg : ''));
    if (d.estado === 'importada') box.append(h('button', { class: 'primario', onclick: assumir }, 'Assumir esta aula pelo editor'));
    box.append(h('h3', {}, 'Avançado'),
      h('p', { class: 'muted' }, 'Trechos do HTML original antes do primeiro slide (head, barra) e depois do último (controles, script). Edite com cuidado.'));
    formCampos([{ nome: 'antes', tipo: 'codigo', rotulo: 'Antes dos slides' }, { nome: 'depois', tipo: 'codigo', rotulo: 'Depois dos slides' }], 'legado', box);
  } else {
    box.append(h('h3', {}, 'CSS específico desta aula'),
      h('p', { class: 'muted' }, 'Ajustes finos (ex.: #s3 .tb2 { … }). Vai no final do CSS gerado.'));
    formCampos([{ nome: 'css_extra', tipo: 'codigo', rotulo: 'CSS extra' }], '', box);
  }
}

/* ------------------------------------------------------------ painel: tema */
const ehCor = v => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((v || '').trim());
const corHex6 = v => { v = v.trim(); return v.length === 4 ? '#' + [...v.slice(1)].map(x => x + x).join('') : v; };
function renderTema() {
  const box = $('#aba-tema'); box.innerHTML = '';
  if (!st.dados) return;
  const d = st.dados; d.tema = d.tema || {}; d.tema.vars = d.tema.vars || {};
  let base;
  if (legado()) {
    box.append(h('h3', {}, 'Cores e fontes da aula'),
      h('p', { class: 'muted' }, 'Variáveis do CSS original (', h('code', {}, (st.temaVars || {}).origem || '?'), '). As alterações entram como um bloco <style> extra no HTML gerado — o CSS original não é modificado.'));
    base = (st.temaVars || {}).vars || {};
  } else {
    const sel = h('select', { onchange: e => { d.tema.base = e.target.value; marcar(); renderTema(); } });
    TEMAS.forEach(t => sel.append(h('option', { value: t.nome }, t.rotulo || t.nome)));
    sel.value = d.tema.base || 'ppgcc';
    const t = TEMAS.find(x => x.nome === sel.value) || TEMAS[0];
    box.append(h('h3', {}, 'Tema'), h('label', {}, 'Tema base', sel), h('p', { class: 'muted' }, t.descricao || ''));
    base = t.vars || {};
    box.append(h('h3', {}, 'Logos'), h('p', { class: 'muted' }, 'Os temas não trazem logos. Adicione as suas aqui (ficam em img/ da aula).'));
    d.tema.logos = d.tema.logos || {};
    for (const [k, rot] of [['barra', 'Barra superior'], ['capa', 'Capa (direita)'], ['rodape', 'Rodapé'], ['marca', 'Marca d\'água da capa']]) {
      const v = d.tema.logos[k];
      box.append(h('div', { class: 'logo-linha' }, h('span', {}, rot),
        v ? h('img', { src: urlAula(v), alt: '' }) : h('span', { class: 'muted' }, 'sem logo'),
        h('button', { onclick: () => escolherImagem(src => { d.tema.logos[k] = src || null; marcar(); renderTema(); }) }, 'Escolher'),
        h('button', { disabled: !v, onclick: () => { d.tema.logos[k] = null; marcar(); renderTema(); } }, 'Remover')));
    }
  }
  box.append(h('h3', {}, 'Cores, fontes e tamanhos'));
  const filtro = h('input', { placeholder: 'Filtrar variáveis…', oninput: e => $$('.var-linha', box).forEach(l => l.hidden = !l.dataset.k.includes(e.target.value)) });
  box.append(filtro);
  for (const [k, vb] of Object.entries(base)) {
    const v = d.tema.vars[k] ?? vb; const mudou = k in d.tema.vars;
    const txtInp = h('input', { type: 'text', value: v, onchange: e => { d.tema.vars[k] = e.target.value; marcar(); renderTema(); } });
    const cor = ehCor(v) ? h('input', { type: 'color', value: corHex6(v), oninput: e => { d.tema.vars[k] = e.target.value; txtInp.value = e.target.value; marcar(); } }) : h('span');
    box.append(h('div', { class: 'var-linha' + (mudou ? ' mudou' : ''), 'data-k': k }, h('span', { title: k }, k), cor, txtInp,
      mudou ? h('button', { title: 'Voltar ao valor do tema', onclick: () => { delete d.tema.vars[k]; marcar(); renderTema(); } }, '↺') : h('span')));
  }
  if (!legado()) {
    const nome = h('input', { placeholder: 'nome do novo tema (ex.: ifpi_escuro)' });
    box.append(h('h3', {}, 'Salvar como tema'), h('p', { class: 'muted' }, 'Cria temas/<nome>/tema.json com o tema base + suas alterações, para reutilizar em outras aulas.'), nome,
      h('div', { class: 'linha-bts' }, h('button', { onclick: async () => {
        try {
          const r = await api('/api/temas', { nome: nome.value, rotulo: nome.value, base: d.tema.base, vars: d.tema.vars });
          TEMAS = r.temas; d.tema.base = r.nome; d.tema.vars = {}; marcar(); renderTema(); toast('Tema "' + r.nome + '" salvo.');
        } catch (e) { toast(e.message, true); }
      } }, 'Salvar tema')));
  }
}

/* ------------------------------------------------------------ imagens */
function escolherImagem(cb) {
  const d = $('#d-imagem'); const gal = $('#galeria'); gal.innerHTML = '';
  const listar = async () => {
    try { st.imagens = (await api('/api/imagens?c=' + encodeURIComponent(st.c))).imagens; } catch (e) { }
    gal.innerHTML = '';
    if (!st.imagens.length) gal.append(h('p', { class: 'vazio' }, 'Nenhuma imagem na pasta da aula ainda.'));
    st.imagens.forEach(src => gal.append(h('figure', { onclick: () => { d.close(); cb(src); } }, h('img', { src: urlAula(src), alt: '', loading: 'lazy' }), h('figcaption', {}, src))));
  };
  listar(); d.showModal();
  $('#img-remover').onclick = () => { d.close(); cb(null); };
  $('#up-img').value = '';
  $('#up-img').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const b64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    try { const j = await api('/api/upload', { c: st.c, nome: f.name, dados: b64 }); d.close(); toast('Imagem salva em ' + j.src); cb(j.src); }
    catch (x) { toast(x.message, true); }
  };
}

/* ------------------------------------------------------------ gerar / visualizar / publicar */
async function gerar(silencioso, comPdf) {
  await salvar(true);
  if (!silencioso || comPdf) toast('Gerando a aula' + (comPdf !== false ? ' e o PDF (usado no celular)…' : '…'));
  const r = await api('/api/gerar', { c: st.c, pdf: comPdf !== undefined ? comPdf : !silencioso });
  if (!r.ok) { toast((r.erros || []).slice(0, 3).join(' · '), true); return null; }
  if (!silencioso) toast(r.escritos.length ? 'Gerado: ' + r.escritos.map(x => x.split('/').pop()).join(', ') : 'Nada mudou desde a última geração.');
  return r;
}
async function visualizar(pdf) {
  try {
    let arq = (st.dados.meta || {}).arquivo;
    if (!(legado() && st.dados.estado !== 'editor')) { const r = await gerar(true, pdf === 'celular'); if (!r) return; arq = r.html.split('/').pop(); }
    else toast('Aula importada: abrindo o HTML publicado (suas edições ainda não entram nele).');
    const w = pdf === 'celular' ? window.open(urlAula(arq), 'slides_celular', 'width=400,height=820,menubar=no,toolbar=no,location=no')
      : window.open(urlAula(arq) + (pdf ? '?pdf=1' : ''), '_blank');
    if (pdf === true && w) w.addEventListener('load', () => setTimeout(() => { if (w.exportarPDF) w.exportarPDF(); else w.print(); }, 600));
  } catch (e) { toast(e.message, true); }
}
async function dialogoPublicar() {
  if (st.c && st.sujo) await salvar(true);
  const d = $('#d-publicar'); const info = $('#pub-info'); const log = $('#pub-log');
  log.hidden = true; log.textContent = ''; info.innerHTML = 'Carregando…'; d.showModal();
  const g = await api('/api/git'); GIT = g; $('#branch').textContent = '⎇ ' + g.branch;
  info.innerHTML = '';
  info.append(h('p', {}, 'Branch atual: ', h('b', {}, g.branch || '?'), ' · remoto: ', h('code', {}, g.remoto || '?')));
  if (g.branch !== 'main') info.append(h('div', { class: 'caixa' }, '⚠ Você está na branch ', h('b', {}, g.branch), '. O push vai para ', h('code', {}, 'origin/' + g.branch),
    ' e o site (GitHub Pages) só muda depois do merge na ', h('b', {}, 'main'), '.'));
  info.append(h('p', { class: 'muted' }, 'O botão roda ', h('code', {}, 'make publicar'), ': gera as aulas assumidas pelo editor, regenera o índice, checa as referências, faz commit (se houver mudanças) e push.'));
  info.append(h('details', {}, h('summary', {}, g.alteracoes.length + ' arquivo(s) com alterações locais'), h('pre', { style: 'max-height:200px;overflow:auto;font-size:12px' }, g.alteracoes.join('\n') || '(nenhum)')));
  $('#pub-checar').onclick = async () => {
    log.hidden = false; log.textContent = 'Checando…';
    try { const r = await api('/api/checar', {}); log.textContent = (r.ok ? '✔ Tudo certo\n\n' : '✘ Problemas encontrados\n\n') + r.saida; } catch (e) { log.textContent = e.message; }
  };
  $('#pub-ok').onclick = async () => {
    if (!confirm('Publicar agora na branch "' + g.branch + '"?')) return;
    log.hidden = false; log.textContent = ''; $('#pub-ok').disabled = true;
    try {
      const r = await fetch('/api/publicar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: $('#pub-msg').value }) });
      if (!r.body) { log.textContent = await r.text(); }
      else {
        const rd = r.body.getReader(); const dec = new TextDecoder();
        for (; ;) { const { done, value } = await rd.read(); if (done) break; log.textContent += dec.decode(value, { stream: true }); log.scrollTop = log.scrollHeight; }
      }
    } catch (e) { log.textContent += '\n' + e.message; }
    $('#pub-ok').disabled = false;
    if (st.c) { try { const r = await api('/api/projeto?c=' + encodeURIComponent(st.c)); st.ver = r.verificacao; } catch (e) { } }
  };
}

/* ------------------------------------------------------------ IA */
function renderIA() {
  const box = $('#aba-ia'); box.innerHTML = '';
  if (!LLM) return;
  const provs = LLM.provedores;
  st.provedor = st.provedor || LLM.padrao;
  const sp = h('select', { onchange: e => { st.provedor = e.target.value; st.modelo = ''; renderIA(); } });
  provs.forEach(p => sp.append(h('option', { value: p.nome }, p.rotulo + (p.pronto ? '' : ' (sem chave)'))));
  sp.value = st.provedor;
  const prov = provs.find(p => p.nome === st.provedor) || provs[0];
  const sm = h('select', { onchange: e => { st.modelo = e.target.value; } }, h('option', { value: '' }, 'Automático (por ação)'),
    ...Object.entries(prov.modelos || {}).map(([k, v]) => h('option', { value: v }, v + ' — ' + k)));
  sm.value = st.modelo;
  box.append(h('h3', {}, 'Provedor'), h('label', {}, 'Provedor', sp), h('label', {}, 'Modelo', sm));
  if (!prov.pronto) box.append(h('div', { class: 'caixa' }, 'Sem chave para ', h('b', {}, prov.rotulo), '. Crie o arquivo ', h('code', {}, 'editor_slides/.env'), ' com ', h('code', {}, prov.chave_env + '=sua-chave'), ' e reinicie o ', h('code', {}, 'make editor'), '.'));
  box.append(h('p', { class: 'muted', id: 'ia-uso' }, usoTxt(LLM.uso)));
  if (!st.dados) { box.append(h('p', { class: 'vazio' }, 'Abra uma aula para usar a IA.')); return; }

  // Texto selecionado
  box.append(h('h3', {}, 'Texto selecionado'), h('div', { id: 'ia-foco', class: 'caixa' }));
  const modos = [['reescrever', 'Reescrever'], ['resumir', 'Resumir'], ['didatico', 'Mais didático'], ['topicos', 'Em tópicos'], ['corrigir', 'Corrigir']];
  box.append(h('div', { class: 'linha-bts' }, ...modos.map(([m, r]) => h('button', { onclick: () => iaReescrever({ modo: m }) }, r))));
  const instr = h('input', { placeholder: 'Ou descreva: "deixe com tom mais formal"…' });
  box.append(h('div', { class: 'linha-bts' }, instr, h('button', { onclick: () => iaReescrever({ instrucao: instr.value }) }, 'Aplicar')));

  // Slide atual
  box.append(h('h3', {}, 'Slide atual'), h('div', { class: 'linha-bts' },
    h('button', { onclick: iaRoteiro }, 'Escrever roteiro de fala'),
    h('button', { onclick: () => iaConverter() }, legado() ? 'Converter em blocos' : 'Reorganizar em blocos'),
    h('button', { onclick: iaAlt }, 'Texto alternativo da imagem')));

  // Novo slide
  const ped = h('textarea', { id: 'ia-pedido', rows: 3, placeholder: legado() ? 'Ex.: slide comparando HD e SSD, no mesmo estilo dos outros' : 'Ex.: slide com 3 cartões sobre os tipos de memória' });
  box.append(h('h3', {}, 'Novo slide'), ped, h('div', { class: 'linha-bts' }, h('button', { class: 'primario', onclick: () => iaNovoSlide(ped.value) }, '✦ Criar slide após o atual')));

  // Aula em PDF
  box.append(h('h3', {}, 'Aula em PDF'),
    h('p', { class: 'muted' }, 'Carregue uma aula que você elaborou em PDF: o LLM adapta o conteúdo ao template desta apresentação (com prévia antes de inserir).'),
    h('div', { class: 'linha-bts' }, h('button', { class: 'primario', onclick: abrirPdf }, '✦ Importar aula de um PDF…')));

  // Aula completa
  if (!legado()) {
    const f = { tema: h('input', { value: txt((st.dados.meta || {}).titulo) }), publico: h('input', { value: 'estudantes do curso técnico' }),
      n: h('input', { type: 'number', value: 10, min: 3, max: 40 }), dur: h('input', { type: 'number', value: 50, min: 5 }), roteiro: h('textarea', { rows: 5, placeholder: 'Tópicos, sequência, exemplos que quer usar…' }) };
    box.append(h('h3', {}, 'Aula completa'), h('label', {}, 'Tema', f.tema), h('label', {}, 'Público', f.publico),
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, h('label', {}, 'Nº de slides', f.n), h('label', {}, 'Duração (min)', f.dur)),
      h('label', {}, 'Roteiro / tópicos', f.roteiro),
      h('div', { class: 'linha-bts' }, h('button', { class: 'primario', onclick: () => iaAula({ tema: f.tema.value, publico: f.publico.value, n_slides: +f.n.value, duracao: +f.dur.value, roteiro: f.roteiro.value }) }, '✦ Gerar aula')));
  }
  renderIAFoco();
}
const usoTxt = u => u ? 'Uso nesta sessão: ' + (u.chamadas || 0) + ' chamada(s) · ' + (u.entrada || 0).toLocaleString('pt-BR') + ' tokens de entrada · ' + (u.saida || 0).toLocaleString('pt-BR') + ' de saída' : '';
function renderIAFoco() {
  const el = $('#ia-foco'); if (!el) return;
  const f = st.foco;
  el.innerHTML = '';
  if (f && f.el && f.el.isConnected) el.append(h('div', { class: 'muted' }, f.tipo === 'campo' ? 'Campo: ' + f.caminho.split('/').slice(2).join(' › ') : 'Trecho do slide HTML'), h('div', {}, txt(f.el.innerHTML).slice(0, 160) || '(vazio)'));
  else el.append(h('span', { class: 'muted' }, 'Clique num texto do slide (no palco) para selecioná-lo.'));
}
async function iaChamar(acao, entrada, titulo) {
  const d = $('#d-ia'); $('#ia-titulo').textContent = titulo; $('#ia-corpo').innerHTML = '<p class="muted">Consultando ' + st.provedor + '…</p>'; $('#ia-acoes').innerHTML = '';
  $('#ia-acoes').append(h('button', { class: 'fechar', onclick: () => d.close() }, 'Cancelar'));
  d.showModal();
  try {
    const r = await api('/api/llm', { acao, entrada, provedor: st.provedor, modelo: st.modelo || null, c: st.c });
    if (r.uso_sessao) { LLM.uso = r.uso_sessao; const u = $('#ia-uso'); if (u) u.textContent = usoTxt(LLM.uso); }
    return r;
  } catch (e) { $('#ia-corpo').innerHTML = ''; $('#ia-corpo').append(h('p', { style: 'color:#B42318' }, e.message)); return null; }
}
function iaAcoes(botoes) {
  const a = $('#ia-acoes'); a.innerHTML = '';
  a.append(h('button', { onclick: () => $('#d-ia').close() }, 'Descartar'));
  botoes.forEach(([rot, fn, pri]) => a.append(h('button', { class: pri ? 'primario' : '', onclick: () => { fn(); $('#d-ia').close(); } }, rot)));
}
async function miniPrevia(slides, cont) {
  const dados = clone(st.dados); dados.slides = slides;
  const box = h('div', { class: 'previa-mini' }); const fr = h('iframe', { title: 'Prévia' }); box.append(fr); cont.append(box);
  let i = 0; const nav = h('div', { class: 'linha-bts', style: 'justify-content:center' });
  const mostrar = () => { const doc = fr.contentDocument; if (!doc) return; $$('.sl', doc).forEach((s, k) => s.classList.toggle('ac', k === i)); cont_.textContent = (i + 1) + ' / ' + slides.length + ' — ' + tituloSlide(slides[i]); };
  const cont_ = h('span', { class: 'muted' });
  if (slides.length > 1) { nav.append(h('button', { onclick: () => { i = Math.max(0, i - 1); mostrar(); } }, '‹'), cont_, h('button', { onclick: () => { i = Math.min(slides.length - 1, i + 1); mostrar(); } }, '›')); cont.append(nav); }
  try { const r = await api('/api/previa', { c: st.c, dados }); fr.onload = mostrar; fr.src = r.url; } catch (e) { box.textContent = e.message; }
}
async function iaReescrever(op) {
  const f = st.foco;
  if (!f || !f.el || !f.el.isConnected) return toast('Clique primeiro num texto do slide, no palco.', true);
  const antes = f.el.innerHTML;
  const r = await iaChamar('reescrever', { html: antes, ...op }, 'Reescrever texto'); if (!r) return;
  const c = $('#ia-corpo'); c.innerHTML = '';
  c.append(h('div', { class: 'comparar' }, h('div', {}, h('h4', {}, 'Antes'), h('div', { html: antes })), h('div', {}, h('h4', {}, 'Sugestão'), h('div', { html: r.html }))));
  iaAcoes([['Aplicar', () => {
    const s = st.dados.slides[st.sel];
    if (f.tipo === 'campo') { setP(st.dados, f.caminho, r.html); marcar(); renderPainelSlide(true); }
    else { f.el.innerHTML = r.html; s.html = serializar(slideAtivo()); s.editado = true; marcar(); }
  }, true]]);
}
function conteudoSlide(s) { return s.layout === 'html' ? s.html : JSON.stringify(s); }
async function iaRoteiro() {
  const s = st.dados.slides[st.sel];
  const r = await iaChamar('roteiro', { slide: conteudoSlide(s), dados: { meta: st.dados.meta, slides: st.dados.slides.map(x => ({ layout: x.layout, titulo: tituloSlide(x) })) } }, 'Roteiro de fala'); if (!r) return;
  const c = $('#ia-corpo'); c.innerHTML = '';
  c.append(h('div', { class: 'caixa', html: r.notas }), h('p', { class: 'muted' }, r.tempo_seg ? 'Tempo estimado: ~' + Math.round(r.tempo_seg / 60 * 10) / 10 + ' min' : ''));
  iaAcoes([['Usar como roteiro', () => { if (s.layout === 'html') setNotasHtml(s, r.notas); else s.notas = r.notas; marcar(s.layout === 'html'); renderNotas(); }, true]]);
}
async function iaConverter(instrucao) {
  const s = st.dados.slides[st.sel];
  const r = await iaChamar('converter', { slide: conteudoSlide(s), instrucao }, 'Slide em blocos estruturados'); if (!r) return;
  const c = $('#ia-corpo'); c.innerHTML = '';
  if (legado()) c.append(h('p', { class: 'muted' }, 'Atenção: em aulas importadas, os blocos usam as classes comuns do CSS da aula; o visual pode diferir um pouco do original. O slide original continua disponível no desfazer.'));
  await miniPrevia([Object.assign({ prefixo: s.prefixo }, r.slide)], c);
  iaAcoes([['Inserir como novo slide', () => inserir(Object.assign({}, r.slide))], ['Substituir este slide', () => {
    st.dados.slides[st.sel] = Object.assign(s.prefixo !== undefined ? { prefixo: s.prefixo } : {}, r.slide); st.bloco = null; marcar(); renderLista(); renderPainelSlide(); renderNotas();
  }, true]]);
}
async function iaNovoSlide(pedido) {
  if (!pedido.trim()) return toast('Descreva o slide que você quer.', true);
  let r;
  if (legado()) {
    const vizinhos = st.dados.slides.filter(x => x.layout === 'html').slice(Math.max(0, st.sel - 2), st.sel + 2).map(x => x.html);
    r = await iaChamar('slide_legado', { pedido, exemplos: vizinhos }, 'Novo slide'); if (!r) return;
    r.slide = { layout: 'html', editado: true, html: r.html };
  } else {
    r = await iaChamar('gerar_slide', { pedido, dados: { meta: st.dados.meta, slides: st.dados.slides.map(x => ({ layout: x.layout, titulo: tituloSlide(x) })) } }, 'Novo slide'); if (!r) return;
  }
  const c = $('#ia-corpo'); c.innerHTML = ''; await miniPrevia([r.slide], c);
  iaAcoes([['Inserir após o slide atual', () => inserir(r.slide), true]]);
}
async function iaAula(e) {
  const r = await iaChamar('gerar_aula', e, 'Aula gerada pela IA'); if (!r) return;
  const c = $('#ia-corpo'); c.innerHTML = '';
  c.append(h('p', {}, h('b', {}, r.titulo || ''), ' — ', r.slides.length + ' slides'));
  await miniPrevia(r.slides, c);
  iaAcoes([['Acrescentar ao final', () => { st.dados.slides.push(...r.slides); marcar(); renderLista(); }],
    ['Substituir todos os slides', () => { if (!confirm('Substituir todos os slides atuais? (dá para desfazer)')) return; st.dados.slides = r.slides; st.sel = 0; marcar(); renderTudo(); }, true]]);
}
async function iaAlt() {
  const im = st.imgSel; if (!im || !im.el.isConnected) return toast('Clique numa imagem do slide primeiro.', true);
  const slideEl = slideAtivo();
  const r = await iaChamar('alt', { src: im.src, contexto: txt(slideEl ? slideEl.innerHTML : '').slice(0, 600) }, 'Texto alternativo'); if (!r) return;
  $('#ia-corpo').innerHTML = ''; $('#ia-corpo').append(h('p', {}, h('code', {}, im.src)), h('div', { class: 'caixa' }, r.alt));
  iaAcoes([['Aplicar', () => {
    const s = st.dados.slides[st.sel];
    if (im.caminho) {
      const p = im.caminho.replace(/\/(src|imagem)$/, '/alt');
      const dono = getP(st.dados, p.replace(/\/alt$/, ''));
      if (dono && (dono.tipo === 'figura' || dono.layout === 'imagem')) { setP(st.dados, p, r.alt); marcar(); renderPainelSlide(true); }
      else toast('Esta imagem (capa/seção) é decorativa e não tem campo de texto alternativo.');
    }
    else if (s.layout === 'html') { im.el.setAttribute('alt', r.alt); s.html = serializar(slideEl); s.editado = true; marcar(); }
  }, true]]);
}

/* ------------------------------------------------------------ importar aula em PDF */
const PDF = { r: null, cancelado: false, slides: [], aplicado: false };
const parafusoPdf = txt => h('p', { class: 'muted' }, txt);
function slidesParaPrevia(slides) {
  if (!PDF.r) return slides;
  return JSON.parse(JSON.stringify(slides).split('img/pdf-').join(PDF.r.url_cache + 'pdf-'));
}
async function descartarPdf() {
  if (PDF.r && !PDF.aplicado) { try { await api('/api/pdf/descartar', { token: PDF.r.token }); } catch (e) { } }
  PDF.r = null; PDF.slides = []; PDF.cancelado = true;
}
async function abrirPdf() {
  if (!st.dados) return;
  await descartarPdf();
  PDF.aplicado = false; PDF.cancelado = false;
  const d = $('#d-pdf'); const corpo = $('#pdf-corpo'); const acoes = $('#pdf-acoes');
  d.onclose = () => descartarPdf();
  corpo.innerHTML = ''; acoes.innerHTML = '';
  $('#pdf-titulo').textContent = 'Importar aula de um PDF — 1. Arquivo';
  d.showModal();
  let status = { ok: false, msg: '' };
  try { status = await api('/api/pdf/status'); } catch (e) { status.msg = e.message; }
  const prov = (LLM.provedores.find(p => p.nome === st.provedor) || {});
  corpo.append(
    h('p', {}, 'Escolha o PDF da sua aula. O texto e as imagens são extraídos no seu computador; depois você escolhe as páginas e o LLM ',
      h('b', {}, 'adapta'), ' o conteúdo ao template (reorganiza, divide páginas densas e leva detalhes para o roteiro).'),
    h('div', { class: 'caixa' }, '🔒 O texto das páginas escolhidas será enviado ao provedor ', h('b', {}, prov.rotulo || st.provedor),
      '. O PDF fica numa pasta temporária fora do git e é apagado quando você termina.'));
  if (!status.ok) {
    corpo.append(h('div', { class: 'caixa erro-caixa' }, h('b', {}, 'Falta o PyMuPDF. '), status.msg));
    acoes.append(h('button', { onclick: () => d.close() }, 'Fechar'));
    return;
  }
  const inp = h('input', { type: 'file', accept: 'application/pdf,.pdf' });
  corpo.append(h('label', {}, 'Arquivo PDF', inp), h('p', { class: 'muted' }, status.msg));
  acoes.append(h('button', { onclick: () => d.close() }, 'Cancelar'));
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    corpo.append(parafusoPdf('Lendo ' + f.name + '…')); inp.disabled = true;
    try {
      const b64 = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
      PDF.r = await api('/api/pdf/enviar', { nome: f.name, dados: b64 });
      revisarPdf();
    } catch (e) { toast(e.message, true); inp.disabled = false; }
  };
}
function intervalo(txt, max) {
  const set = new Set();
  for (const parte of (txt || '').split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte); if (!m) continue;
    let a = +m[1], b = +(m[2] || m[1]); if (a > b) [a, b] = [b, a];
    for (let k = Math.max(1, a); k <= Math.min(max, b); k++) set.add(k);
  }
  return set;
}
function revisarPdf() {
  const r = PDF.r; const corpo = $('#pdf-corpo'); const acoes = $('#pdf-acoes');
  $('#pdf-titulo').textContent = 'Importar aula de um PDF — 2. Revisar';
  corpo.innerHTML = ''; acoes.innerHTML = '';
  const nTexto = r.paginas.filter(p => !p.sem_texto).length;
  const nImg = r.paginas.reduce((n, p) => n + p.imagens.length, 0);
  corpo.append(h('p', {}, h('b', {}, r.nome), ' — ', r.total_paginas + ' página(s), ' + nImg + ' imagem(ns) aproveitável(is)',
    r.paginas.some(p => p.sem_texto) ? ', ' + r.paginas.filter(p => p.sem_texto).length + ' página(s) sem texto (entram como slide de imagem inteira)' : '', '.'));
  const faixa = h('input', { value: '1-' + r.total_paginas, title: 'Ex.: 1-5, 8, 10-12' });
  const lista = h('div', { class: 'pdf-paginas' });
  const marcarFaixa = () => { const set = intervalo(faixa.value, r.total_paginas); $$('input[data-pag]', lista).forEach(c => c.checked = set.has(+c.dataset.pag)); atualizar(); };
  faixa.oninput = marcarFaixa;
  for (const p of r.paginas) {
    const imgs = h('div', { class: 'pdf-imgs' });
    for (const im of p.imagens) imgs.append(h('label', { class: 'pdf-img', title: im.arquivo + ' — ' + im.largura + '×' + im.altura },
      h('input', { type: 'checkbox', checked: true, 'data-img': im.arquivo }), h('img', { src: r.url_cache + im.arquivo, alt: '' })));
    if (p.render) imgs.append(h('span', { class: 'pdf-img' }, h('img', { src: r.url_cache + p.render, alt: '' })));
    lista.append(h('div', { class: 'pdf-pag' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: true, 'data-pag': p.numero, onchange: atualizar }), h('b', {}, 'p. ' + p.numero)),
      h('div', { class: 'pdf-txt' },
        p.sem_texto ? h('span', { class: 'selo importada' }, 'sem texto → slide de imagem inteira') : h('span', {}, h('b', {}, p.titulo || ''), h('br'), h('small', { class: 'muted' }, (p.texto || '').slice(p.titulo.length, 220).replace(/\s+/g, ' ') + '… (' + p.caracteres + ' caracteres)')),
        imgs)));
  }
  const alvo = h('input', { type: 'number', min: 1, max: 200, value: Math.max(1, Math.round(nTexto * 1.3)) });
  const roteiro = h('input', { type: 'checkbox', checked: true });
  const onde = h('select', {}, h('option', { value: 'depois' }, 'Após o slide atual'), h('option', { value: 'fim' }, 'No final da apresentação'),
    h('option', { value: 'substituir' }, 'Substituir todos os slides'));
  if (legado()) onde.value = 'fim';
  const est = h('p', { class: 'muted' });
  function atualizar() {
    const pags = $$('input[data-pag]', lista).filter(c => c.checked).map(c => +c.dataset.pag);
    const chars = r.paginas.filter(p => pags.includes(p.numero)).reduce((n, p) => n + p.caracteres, 0);
    est.textContent = pags.length + ' página(s) selecionada(s) · ~' + Math.round(chars / 3.2 + 1500 * Math.max(1, Math.ceil(pags.length / 8))).toLocaleString('pt-BR') + ' tokens de entrada estimados';
  }
  corpo.append(h('label', {}, 'Páginas (intervalo)', faixa), lista,
    h('div', { class: 'pdf-opcoes' },
      h('label', {}, 'Nº aproximado de slides', alvo),
      h('label', {}, 'Inserir', onde),
      h('label', { class: 'chk' }, roteiro, 'Escrever o roteiro de fala')),
    ...(legado() ? [h('p', { class: 'muted' }, 'Aula importada: os slides serão criados em HTML no mesmo estilo dos slides desta aula.')] : []), est);
  atualizar();
  acoes.append(h('button', { onclick: () => $('#d-pdf').close() }, 'Cancelar'),
    h('button', { class: 'primario', onclick: () => {
      const pags = $$('input[data-pag]', lista).filter(c => c.checked).map(c => +c.dataset.pag);
      if (!pags.length) return toast('Selecione ao menos uma página.', true);
      const imgs = $$('input[data-img]', lista).filter(c => c.checked).map(c => c.dataset.img);
      converterPdf(pags, imgs, +alvo.value || 1, roteiro.checked, onde.value);
    } }, '✦ Converter com IA'));
}
async function converterPdf(pags, imgs, alvo, roteiro, onde) {
  const r = PDF.r; const corpo = $('#pdf-corpo'); const acoes = $('#pdf-acoes');
  $('#pdf-titulo').textContent = 'Importar aula de um PDF — 3. Convertendo';
  corpo.innerHTML = ''; acoes.innerHTML = '';
  PDF.cancelado = false; PDF.slides = [];
  const prog = h('progress', { max: 1, value: 0, style: 'width:100%' }); const msg = parafusoPdf('Planejando…'); const erros = h('div');
  corpo.append(prog, msg, erros);
  acoes.append(h('button', { onclick: () => { PDF.cancelado = true; msg.textContent = 'Cancelando após o lote atual…'; } }, 'Cancelar'));
  let lotes;
  try { lotes = (await api('/api/pdf/planejar', { token: r.token, paginas: pags })).lotes; } catch (e) { msg.textContent = e.message; return; }
  const pagsTexto = lotes.filter(l => l.tipo === 'texto').reduce((n, l) => n + l.paginas.length, 0) || 1;
  const exemplos = legado() ? st.dados.slides.filter(x => x.layout === 'html').slice(Math.max(0, st.sel - 1), st.sel + 2).map(x => x.html) : [];
  prog.max = lotes.length;
  for (let k = 0; k < lotes.length; k++) {
    if (PDF.cancelado) break;
    const l = lotes[k];
    if (l.tipo === 'imagem') {
      const src = 'img/' + l.arquivo, alt = 'Página ' + l.pagina + ' de ' + r.nome;
      PDF.slides.push({ slide: legado()
        ? { layout: 'html', editado: true, html: '<div class="sl" style="padding:0;background:#fff"><img src="' + src + '" alt="' + alt.replace(/"/g, '&quot;') + '" style="width:100%;height:100%;object-fit:contain;display:block"></div>' }
        : { layout: 'imagem', imagem: src, alt, notas: '' }, imagens: [l.arquivo], paginas: [l.pagina] });
      prog.value = k + 1; continue;
    }
    msg.textContent = 'Lote ' + (k + 1) + ' de ' + lotes.length + ': páginas ' + l.paginas[0] + '–' + l.paginas[l.paginas.length - 1] + ' (consultando ' + st.provedor + '…)';
    try {
      const res = await api('/api/llm', { acao: 'pdf_lote', provedor: st.provedor, modelo: st.modelo || null, c: st.c, entrada: {
        token: r.token, paginas: l.paginas, imagens_ok: imgs, roteiro, legado: legado(), exemplos,
        slides_alvo: Math.max(1, Math.round(alvo * l.paginas.length / pagsTexto)),
        dados: { meta: st.dados.meta } } });
      if (res.uso_sessao) LLM.uso = res.uso_sessao;
      res.slides.forEach(sl => PDF.slides.push({ slide: sl, imagens: res.imagens_usadas, paginas: res.paginas }));
    } catch (e) {
      erros.append(h('p', { style: 'color:#B42318' }, 'Páginas ' + l.paginas.join(', ') + ': ' + e.message));
    }
    prog.value = k + 1;
  }
  previaPdf(onde);
}
async function previaPdf(onde) {
  const corpo = $('#pdf-corpo'); const acoes = $('#pdf-acoes');
  const erros = $$('p', corpo).filter(p => p.style.color);
  $('#pdf-titulo').textContent = 'Importar aula de um PDF — 4. Prévia';
  corpo.innerHTML = ''; acoes.innerHTML = '';
  erros.forEach(e => corpo.append(e));
  if (!PDF.slides.length) { corpo.append(h('p', { class: 'vazio' }, 'Nenhum slide foi gerado.')); acoes.append(h('button', { onclick: () => $('#d-pdf').close() }, 'Fechar')); return; }
  const marcados = PDF.slides.map(() => true);
  const fr = h('iframe', { title: 'Prévia' }); let atual = 0;
  const lista = h('ol', { class: 'pdf-lista' });
  const mostrar = () => {
    const doc = fr.contentDocument; if (doc) $$('.sl', doc).forEach((s, k) => s.classList.toggle('ac', k === atual));
    $$('li', lista).forEach((li, k) => li.classList.toggle('on', k === atual));
  };
  PDF.slides.forEach((x, i) => lista.append(h('li', { onclick: () => { atual = i; mostrar(); } },
    h('input', { type: 'checkbox', checked: true, onclick: e => e.stopPropagation(), onchange: e => { marcados[i] = e.target.checked; botao.textContent = 'Inserir ' + marcados.filter(Boolean).length + ' slide(s)'; } }),
    h('span', {}, tituloSlide(x.slide), h('small', { class: 'muted' }, '  ' + (x.paginas.length > 1 ? 'págs. ' + x.paginas[0] + '–' + x.paginas[x.paginas.length - 1] : 'pág. ' + x.paginas[0]))))));
  corpo.append(h('p', { class: 'muted' }, PDF.slides.length + ' slide(s) gerado(s). Clique para ver; desmarque o que não quiser. Depois de inserir, tudo continua editável (e Ctrl+Z desfaz).'),
    h('div', { class: 'pdf-previa' }, lista, h('div', { class: 'previa-mini' }, fr)));
  const dados = clone(st.dados); dados.slides = slidesParaPrevia(PDF.slides.map(x => x.slide));
  try { const r = await api('/api/previa', { c: st.c, dados }); fr.onload = mostrar; fr.src = r.url; } catch (e) { toast(e.message, true); }
  const botao = h('button', { class: 'primario', onclick: () => aplicarPdf(marcados, onde) }, 'Inserir ' + PDF.slides.length + ' slide(s)');
  acoes.append(h('button', { onclick: () => $('#d-pdf').close() }, 'Descartar'), botao);
}
async function aplicarPdf(marcados, onde) {
  const escolhidos = PDF.slides.filter((_, i) => marcados[i]);
  if (!escolhidos.length) return toast('Nenhum slide marcado.', true);
  let texto = JSON.stringify(escolhidos.map(x => x.slide));
  const usados = [...new Set((texto.match(/img\/(pdf-[\w-]+\.(?:png|jpg))/g) || []).map(s => s.slice(4)))];
  try {
    const r = await api('/api/pdf/aplicar', { c: st.c, token: PDF.r.token, arquivos: usados });
    PDF.aplicado = true;
    for (const [nome, final] of Object.entries(r.mapa)) texto = texto.split('img/' + nome).join(final);
  } catch (e) { return toast(e.message, true); }
  const novos = JSON.parse(texto);
  if (onde === 'substituir') { if (!confirm('Substituir todos os slides atuais? (Ctrl+Z desfaz)')) return; st.dados.slides = novos; st.sel = 0; }
  else if (onde === 'fim') { st.sel = st.dados.slides.length; st.dados.slides.push(...novos); }
  else { st.dados.slides.splice(st.sel + 1, 0, ...novos); st.sel = st.sel + 1; }
  st.bloco = null; PDF.r = null;
  $('#d-pdf').close(); marcar(); renderTudo();
  toast(novos.length + ' slide(s) inseridos a partir do PDF. O PDF temporário foi apagado.');
}

/* ------------------------------------------------------------ atalhos e início */
function atalhos(e) {
  const mod = e.metaKey || e.ctrlKey; if (!mod) return;
  const k = e.key.toLowerCase();
  const emTexto = e.target.closest && e.target.closest('input,textarea,[contenteditable="true"]');
  if (k === 's') { e.preventDefault(); salvar(); }
  else if (k === 'z' && !emTexto) { e.preventDefault(); e.shiftKey ? refazer() : desfazer(); }
  else if (k === 'y' && !emTexto) { e.preventDefault(); refazer(); }
}
function ligar() {
  $('#b-abrir').onclick = () => dialogoAbrir().catch(e => toast(e.message, true));
  $('#b-novo').onclick = () => dialogoNovo();
  $('#b-salvar').onclick = () => salvar();
  $('#b-desfazer').onclick = desfazer; $('#b-refazer').onclick = refazer;
  $('#b-gerar').onclick = () => gerar().catch(e => toast(e.message, true));
  $('#b-ver').onclick = () => visualizar(false); $('#b-pdf').onclick = () => visualizar(true);
  $('#b-celular').onclick = () => visualizar('celular');
  $('#b-publicar').onclick = () => dialogoPublicar().catch(e => toast(e.message, true));
  $('#b-add').onclick = e => { e.stopPropagation(); menuAdicionar(); };
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) $('#menu-add').hidden = true; });
  $$('.abas button[data-aba]').forEach(b => b.onclick = () => abaAtiva(b.dataset.aba));
  const largo = v => { document.body.classList.toggle('painel-largo', v); try { localStorage.setItem('editor_slides:painel-largo', v ? '1' : ''); } catch (e) { } setTimeout(escalarPalco, 50); };
  try { largo(!!localStorage.getItem('editor_slides:painel-largo')); } catch (e) { }
  $('#b-largura').onclick = () => largo(!document.body.classList.contains('painel-largo'));
  $$('dialog .fechar').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); b.closest('dialog').close(); }));
  document.addEventListener('keydown', atalhos);
  window.addEventListener('beforeunload', e => { if (st.sujo) { salvar(true); e.preventDefault(); e.returnValue = ''; } });
  new ResizeObserver(escalarPalco).observe($('#palco-wrap'));
}
async function iniciar() {
  ligar();
  try {
    const e = await api('/api/estado');
    CAT = e.catalogo; TEMAS = e.temas; LLM = e.llm; GIT = e.git;
    const b = $('#branch'); b.textContent = '⎇ ' + (GIT.branch || '?'); b.className = 'selo' + (GIT.branch === 'main' ? ' main' : '');
    renderTudo();
    let ult = null; try { ult = localStorage.getItem('editor_slides:ultimo'); } catch (x) { }
    const q = new URLSearchParams(location.search).get('c');
    if (q || ult) await abrir(q || ult).catch(() => dialogoAbrir());
    else dialogoAbrir();
  } catch (e) { toast('Não consegui falar com o servidor: ' + e.message, true); }
}
iniciar();
