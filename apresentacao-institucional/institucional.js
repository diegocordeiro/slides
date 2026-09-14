/* ============================================================
   Aula Inaugural · IFPI — Campus Barras (apresentação institucional)
   Passador de slides responsivo + navegação completa
   Base: slides/meio_ambiente/informatica_aplicada/aula-02/aula02.js
   ============================================================ */
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.sl'));
  var cur = 1;
  var ctr = document.getElementById('ctr');
  var progress = document.getElementById('progress');
  var isPres = location.hash.indexOf('apresentacao') !== -1;
  var presWin = null;
  var fzVal = 100;
  var autoTimer = null;
  var autoOn = false;
  var autoDelay = 4000;

  function applyZoom(k) {
    var sc = document.querySelector('.sc');
    if (sc) sc.style.setProperty('--fz', k);
  }
  function sendSlide() {
    if (presWin && !presWin.closed) { try { presWin.postMessage({ type: 'slide', i: cur }, '*'); } catch (e) {} }
  }
  function sendZoom() {
    if (presWin && !presWin.closed) { try { presWin.postMessage({ type: 'zoom', fz: fzVal / 100 }, '*'); } catch (e) {} }
  }
  function sendAll() { sendSlide(); sendZoom(); }

  /* Sumário (44 slides: navegação por títulos em vez de bolinhas numeradas) */
  var smItens = [];

  function tituloDoSlide(s, i) {
    var h = s.querySelector('.slhd h2');
    if (h) return h.textContent.trim();
    var h1 = s.querySelector('h1');
    return h1 ? h1.textContent.trim() : 'Slide ' + (i + 1);
  }

  function marcarSumario() {
    smItens.forEach(function (b, i) {
      var on = (i === cur - 1);
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
    });
  }

  function buildSumario() {
    var cx = document.getElementById('smItens');
    var janela = document.getElementById('sumario');
    if (!cx || !janela) return;
    cx.innerHTML = '';
    smItens = [];
    slides.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm-it';
      b.innerHTML = '<b>' + (i + 1) + '</b><span>' + tituloDoSlide(s, i) + '</span>';
      b.setAttribute('aria-label', 'Ir para o slide ' + (i + 1) + ': ' + tituloDoSlide(s, i));
      b.addEventListener('click', function () { show(i + 1); fecharSumario(); });
      cx.appendChild(b);
      smItens.push(b);
    });
    window.fecharSumario = function () {
      janela.classList.remove('on');
      document.body.classList.remove('sm-aberto');
    };
    janela.querySelector('.sm-fch').addEventListener('click', function () { window.fecharSumario(); });
    janela.addEventListener('click', function (e) { if (e.target === janela) window.fecharSumario(); });
  }

  window.abrirSumario = function () {
    var janela = document.getElementById('sumario');
    if (!janela) return;
    marcarSumario();
    janela.classList.add('on');
    document.body.classList.add('sm-aberto');
    setTimeout(function () { try { janela.querySelector('.sm-it') ? janela.querySelector('.sm-it').focus() : janela.querySelector('.sm-fch').focus(); } catch (e) {} }, 40);
  };
  window.fecharSumario = function () {};
  function updateProgress() { if (progress) progress.style.width = ((cur / slides.length) * 100) + '%'; }

  function show(n, fromRemote) {
    cur = Math.max(1, Math.min(n, slides.length));
    slides.forEach(function (s, i) { s.classList.toggle('ac', i === cur - 1); });
    if (ctr) ctr.textContent = cur + ' / ' + slides.length;
    slides.forEach(function (s) { s.scrollTop = 0; });
    updateProgress();
    marcarSumario();
    aoTrocarSlide(slides[cur - 1]);
    if (!fromRemote && !isPres) sendSlide();
  }

  function startAuto() {
    stopAuto(); autoOn = true;
    var btn = document.getElementById('play');
    if (btn) { btn.textContent = '⏸'; btn.title = 'Pausar'; btn.classList.add('on'); }
    autoTimer = setInterval(function () { if (cur < slides.length) show(cur + 1); else show(1); }, autoDelay);
  }
  function stopAuto() {
    autoOn = false;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    var btn = document.getElementById('play');
    if (btn) { btn.textContent = '▶'; btn.title = 'Reproduzir automaticamente'; btn.classList.remove('on'); }
  }
  function toggleAuto() { if (autoOn) stopAuto(); else startAuto(); }

  window.openPresentation = function () {
    if (presWin && !presWin.closed) { presWin.focus(); return; }
    var url = location.href.split('#')[0] + '#apresentacao';
    presWin = window.open(url, 'ifpi_aula_inaugural');
    if (!presWin || presWin.closed) {
      var f = (location.pathname.split('/').pop() || 'institucional.html') + '#apresentacao';
      alert('Permita pop-ups ou abra manualmente a janela de apresentação:\n\n' + f);
    } else { sendAll(); }
  };

  window.toggleFullscreen = function () {
    var el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  };

  window.nx = function () { show(cur + 1); };
  window.pv = function () { show(cur - 1); };
  window.fz = function (d) {
    fzVal = Math.max(80, Math.min(180, fzVal + d * 10));
    var p = document.getElementById('fzpct'); if (p) p.textContent = fzVal + '%';
    document.body.classList.toggle('zoom-maior', fzVal > 100);
    applyZoom(fzVal / 100); if (!isPres) sendZoom();
  };

  /* Tema projetor (padrão) ↔ tema de leitura — memória local + sincronia */
  function setProjetor(on) {
    document.body.classList.toggle('projetor', !!on);
    var b = document.getElementById('cz');
    if (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? '◉ Projetor' : '◐ Leitura';
      b.title = on ? 'Tema projetor ativo — clique para o tema de leitura'
        : 'Tema de leitura ativo — clique para o tema projetor';
    }
  }
  window.toggleProjetor = function () {
    var on = !document.body.classList.contains('projetor');
    setProjetor(on);
    try { localStorage.setItem('aula-inaugural-tema', on ? 'projetor' : 'leitura'); } catch (e) {}
    if (!isPres && presWin && !presWin.closed) { try { presWin.postMessage({ type: 'tema', projetor: on }, '*'); } catch (e) {} }
    /* o tema muda alturas e proporções: refaz o autofit */
    setTimeout(function () { if (typeof ajustarSlides === 'function') ajustarSlides(); }, 40);
  };

  (function restoreTema() {
    var saved = null;
    try { saved = localStorage.getItem('aula-inaugural-tema'); } catch (e) {}
    setProjetor(saved !== 'leitura'); /* padrão: tema projetor */
  })();

  document.querySelectorAll('.rev').forEach(function (el) {
    function togg() { el.classList.toggle('rv'); }
    el.addEventListener('click', togg); el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togg(); } });
  });
  document.querySelectorAll('.abas').forEach(function (bar) {
    bar.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-p');
        bar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
        var scope = bar.parentElement;
        scope.querySelectorAll('.painel').forEach(function (p) { p.classList.toggle('on', p.id === target); });
      });
    });
  });

  /* ---------- Foto ampliada: clique para ver por inteiro (slide dos componentes) ---------- */
  var swipeTs = 0;
  var ampJanela = document.createElement('div');
  ampJanela.className = 'amp-lg';
  ampJanela.setAttribute('role', 'dialog');
  ampJanela.setAttribute('aria-modal', 'true');
  ampJanela.setAttribute('aria-label', 'Foto ampliada');
  ampJanela.innerHTML = '<button class="fch" type="button" aria-label="Fechar foto ampliada">✕</button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(ampJanela);

  var ampImg = ampJanela.querySelector('img');
  var ampLgd = ampJanela.querySelector('figcaption');
  var ampVolta = null;

  function abrirFoto(img) {
    var card = img.closest('.bege');
    var figura = img.closest('figure');
    var tit = card ? card.querySelector('h3') : null;
    var cap = figura ? figura.querySelector('figcaption') : null;
    var cred = card ? card.querySelector('.cred') : null;
    var rotulo = tit ? tit.textContent.trim() : (cap ? cap.textContent.trim() : '');
    ampImg.src = img.currentSrc || img.getAttribute('src');
    ampImg.alt = img.alt || '';
    ampLgd.innerHTML = (rotulo ? '<span class="ft">' + rotulo + '</span>' : '') +
      (cred ? '<span class="cr">' + cred.innerHTML + '</span>' : '');
    ampVolta = img;
    ampJanela.classList.add('on');
    /* o foco só é possível depois que a transição de visibility inicia */
    setTimeout(function () { try { ampJanela.querySelector('.fch').focus(); } catch (e) {} }, 40);
  }

  function fecharFoto() {
    if (!ampJanela.classList.contains('on')) return;
    ampJanela.classList.remove('on');
    var volta = ampVolta; ampVolta = null;
    if (volta) { try { volta.focus(); } catch (e) {} }
  }

  document.querySelectorAll('.comp .bege .foto, .bege .amp .foto, .gal .foto, .fig-leg img').forEach(function (img) {
    img.setAttribute('tabindex', '0');
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', 'Ampliar foto: ' + (img.alt || ''));
    img.addEventListener('click', function () {
      if (Date.now() - swipeTs < 350) return; /* ignora o clique no fim de um arrasto */
      abrirFoto(img);
    });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirFoto(img); }
    });
  });

  /* Clique no fundo escuro ou no ✕ fecha a ampliação */
  ampJanela.addEventListener('click', function (e) {
    if (e.target === ampJanela || e.target.classList.contains('fch')) fecharFoto();
  });

  var scEl = document.querySelector('.sc');
  var touchStartX = 0, touchStartY = 0;
  if (scEl) {
    scEl.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0]; touchStartX = t.clientX; touchStartY = t.clientY;
    }, { passive: true });
    scEl.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0]; var dx = t.clientX - touchStartX; var dy = t.clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        swipeTs = Date.now();
        if (dx < 0) show(cur + 1); else show(cur - 1);
      }
    }, { passive: true });
    var nextBtn = document.createElement('button');
    nextBtn.className = 'swipe next'; nextBtn.type = 'button'; nextBtn.textContent = '›'; nextBtn.setAttribute('aria-label', 'Próximo slide');
    nextBtn.addEventListener('click', function () { show(cur + 1); });
    var prevBtn = document.createElement('button');
    prevBtn.className = 'swipe prev'; prevBtn.type = 'button'; prevBtn.textContent = '‹'; prevBtn.setAttribute('aria-label', 'Slide anterior');
    prevBtn.addEventListener('click', function () { show(cur - 1); });
    scEl.appendChild(nextBtn); scEl.appendChild(prevBtn);
  }

  if (isPres) { document.body.classList.add('pres-mode'); if (window.opener) { try { window.opener.postMessage({ type: 'sync' }, '*'); } catch (e) {} } }
  else { document.body.classList.add('control-mode'); }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'slide') show(d.i, true);
    else if (d.type === 'zoom') { fzVal = Math.round(d.fz * 100); var p = document.getElementById('fzpct'); if (p) p.textContent = fzVal + '%'; document.body.classList.toggle('zoom-maior', fzVal > 100); applyZoom(d.fz); }
    else if (d.type === 'tema') { setProjetor(!!d.projetor); }
    else if (d.type === 'sync') sendAll();
  });

  document.addEventListener('keydown', function (e) {
    var smAberto = document.getElementById('sumario') && document.getElementById('sumario').classList.contains('on');
    if (ampJanela.classList.contains('on')) {
      if (e.key === 'Escape') { e.preventDefault(); fecharFoto(); }
      return; /* foto ampliada aberta: não navega slides */
    }
    if (smAberto) {
      if (e.key === 'Escape' || e.key === 's' || e.key === 'S') { e.preventDefault(); fecharSumario(); }
      return; /* sumário aberto: não navega slides */
    }
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(1); }
    else if (e.key === 'End') { e.preventDefault(); show(slides.length); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    else if (e.key === 'p' || e.key === 'P') { toggleAuto(); }
    else if (e.key === 'n' || e.key === 'N') { openPresentation(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); abrirSumario(); }
  });

  /* ============================================================
     Recursos próprios da apresentação institucional
     ============================================================ */
  var menosMovimento = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Vídeos do YouTube: carregam ao clique e param ao sair do slide ---------- */
  var vdVideos = Array.prototype.slice.call(document.querySelectorAll('.vd'));
  var vdCapas = vdVideos.map(function (vd) { return vd.innerHTML; });

  function vdParar(vd) {
    if (!vd.querySelector('iframe')) return;
    var i = vdVideos.indexOf(vd);
    if (i < 0) return;
    vd.innerHTML = vdCapas[i];
    vd.classList.remove('tocando');
  }

  vdVideos.forEach(function (vd) {
    vd.setAttribute('tabindex', '0');
    vd.setAttribute('role', 'button');
    vd.setAttribute('aria-label', 'Reproduzir vídeo: ' + (vd.getAttribute('data-titulo') || ''));
    function tocar() {
      if (vd.querySelector('iframe')) return;
      var id = vd.getAttribute('data-yt');
      if (!id) return;
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0&hl=pt-BR';
      f.title = vd.getAttribute('data-titulo') || 'Vídeo';
      f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      vd.innerHTML = '';
      vd.appendChild(f);
      vd.classList.add('tocando');
    }
    vd.addEventListener('click', tocar);
    vd.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocar(); }
    });
  });

  /* ---------- Números animados dos cartões .kpi ---------- */
  function animarKpis(slide) {
    var alvos = slide.querySelectorAll('.kpi .n[data-v]');
    Array.prototype.forEach.call(alvos, function (el) {
      var alvo = parseFloat(el.getAttribute('data-v'));
      if (isNaN(alvo)) return;
      var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
      var semMilhar = el.getAttribute('data-mil') === 'nao';
      var no = el.firstChild;
      if (!no || no.nodeType !== 3) {
        no = document.createTextNode('');
        el.insertBefore(no, el.firstChild);
      }
      function escreve(v) {
        var s = v.toFixed(dec).replace('.', ',');
        if (!semMilhar) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        no.nodeValue = s;
      }
      if (menosMovimento || !window.requestAnimationFrame || document.hidden) { escreve(alvo); return; }
      escreve(0);
      var inicio = null;
      var pronto = false;
      var passo = function (ts) {
        if (inicio === null) inicio = ts;
        var k = Math.min(1, (ts - inicio) / 1200);
        escreve(alvo * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(passo);
        else { pronto = true; escreve(alvo); }
      };
      requestAnimationFrame(passo);
      /* rede de segurança: se o navegador não animar (aba oculta, sem compositor),
         o número final aparece de qualquer forma */
      setTimeout(function () { if (!pronto) escreve(alvo); }, 1500);
    });
  }

  /* Chamado a cada troca de slide: para os vídeos e anima os números */
  function aoTrocarSlide(slide) {
    if (!slide) return;
    vdVideos.forEach(function (vd) { if (!slide.contains(vd)) vdParar(vd); });
    animarKpis(slide);
  }

  /* ============================================================
     AUTOFIT — cada slide cresce/diminui para ocupar a área útil
     O fator vai na variável --aj do próprio slide (o --fz do zoom
     do usuário continua valendo por cima).
     ============================================================ */
  var AJ_MIN = 0.6;   /* menor fator aceito */
  var AJ_MAX = 1.7;   /* maior fator aceito (evita texto gigante) */
  var AJ_ALVO = 0.9;  /* quanto da altura útil o conteúdo deve ocupar */

  function alturaDe(el) { return el ? el.offsetHeight : 0; }

  function ajustarSlide(s) {
    var painel = s.querySelector('.slbd');
    if (!painel || !s.clientHeight) return;
    var cabec = s.querySelector('.slhd');
    var rodape = s.querySelector('.ref');
    var k = 1;
    var passo, util, conteudo;

    for (passo = 0; passo < 6; passo++) {
      s.style.setProperty('--aj', k);
      util = s.clientHeight - alturaDe(cabec) - alturaDe(rodape);
      if (util <= 0) return;
      conteudo = Math.max(painel.scrollHeight, 1);
      if (conteudo > util) {
        /* não cabe: encolhe com uma pequena margem de segurança */
        k = k * (util / conteudo) * 0.98;
      } else {
        var alvo = AJ_ALVO * util / conteudo;
        if (alvo <= 1.02) break;          /* já está no ponto */
        k = k * alvo;
      }
      k = Math.min(AJ_MAX, Math.max(AJ_MIN, k));
    }

    /* trava final: garante que o conteúdo nunca ultrapasse a área útil */
    k = Math.floor(Math.min(AJ_MAX, Math.max(AJ_MIN, k)) * 20) / 20;
    s.style.setProperty('--aj', k);
    util = s.clientHeight - alturaDe(cabec) - alturaDe(rodape);
    if (util > 0 && painel.scrollHeight > util) {
      k = Math.max(AJ_MIN, Math.floor((k * (util / painel.scrollHeight) * 0.97) * 20) / 20);
      s.style.setProperty('--aj', k);
      util = s.clientHeight - alturaDe(cabec) - alturaDe(rodape);
    }
    /* se o texto já chegou ao tamanho máximo e ainda sobra espaço, o
       conteúdo é distribuído na altura (sem deixar faixa branca embaixo) */
    var uso = util > 0 ? painel.scrollHeight / util : 1;
    s.classList.toggle('folga', k >= AJ_MAX - 0.001 && uso < 0.9);
  }

  function ajustarSlides() {
    var palco = document.querySelector('.sc');
    if (!palco || !palco.clientHeight) return;
    document.body.classList.add('medindo');
    slides.forEach(function (s) { ajustarSlide(s); });
    document.body.classList.remove('medindo');
  }

  var ajTimer = null;
  function ajustarSlidesDepois(ms) {
    if (ajTimer) clearTimeout(ajTimer);
    ajTimer = setTimeout(ajustarSlides, ms);
  }

  window.addEventListener('resize', function () { ajustarSlidesDepois(180); });
  window.addEventListener('orientationchange', function () { ajustarSlidesDepois(180); });
  window.addEventListener('load', function () { ajustarSlidesDepois(60); });
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { ajustarSlidesDepois(60); }); }

  var playBtn = document.getElementById('play'); if (playBtn) playBtn.addEventListener('click', toggleAuto);
  var fullBtn = document.getElementById('full'); if (fullBtn) fullBtn.addEventListener('click', toggleFullscreen);

  buildSumario(); show(1); updateProgress(); ajustarSlides();
})();

