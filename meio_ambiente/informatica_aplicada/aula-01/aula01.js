/* ============================================================
   Informática Básica · Aula 01 — IFPI Campus Barras
   Passador de slides responsivo + navegação completa
   Base: apresentacao/apresentacao_suap.js (pasta modelo)
   ============================================================ */
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.sl'));
  var cur = 1;
  var ctr = document.getElementById('ctr');
  var dots = document.getElementById('dots');
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

  function buildDots() {
    if (!dots) return;
    dots.innerHTML = '';
    slides.forEach(function (s, i) {
      var d = document.createElement('button');
      d.className = 'dot';
      d.type = 'button';
      d.textContent = String(i + 1);
      d.title = 'Ir para o slide ' + (i + 1);
      d.setAttribute('aria-label', 'Ir para o slide ' + (i + 1) + ' de ' + slides.length);
      d.setAttribute('aria-current', 'false');
      d.addEventListener('click', function () { show(i + 1); });
      dots.appendChild(d);
    });
  }
  function updateProgress() { if (progress) progress.style.width = ((cur / slides.length) * 100) + '%'; }

  function show(n, fromRemote) {
    cur = Math.max(1, Math.min(n, slides.length));
    slides.forEach(function (s, i) { s.classList.toggle('ac', i === cur - 1); });
    if (ctr) ctr.textContent = cur + ' / ' + slides.length;
    slides.forEach(function (s) { s.scrollTop = 0; });
    if (dots) Array.prototype.forEach.call(dots.children, function (d, i) {
      var on = (i === cur - 1);
      d.classList.toggle('on', on);
      d.setAttribute('aria-current', on ? 'true' : 'false');
    });
    updateProgress();
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
    presWin = window.open(url, 'ifpi_informatica_aula01');
    if (!presWin || presWin.closed) {
      var f = (location.pathname.split('/').pop() || 'aula01.html') + '#apresentacao';
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
    try { localStorage.setItem('aula01-tema', on ? 'projetor' : 'leitura'); } catch (e) {}
    if (!isPres && presWin && !presWin.closed) { try { presWin.postMessage({ type: 'tema', projetor: on }, '*'); } catch (e) {} }
  };

  (function restoreTema() {
    var saved = null;
    try { saved = localStorage.getItem('aula01-tema'); } catch (e) {}
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

  var scEl = document.querySelector('.sc');
  var touchStartX = 0, touchStartY = 0;
  if (scEl) {
    scEl.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0]; touchStartX = t.clientX; touchStartY = t.clientY;
    }, { passive: true });
    scEl.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0]; var dx = t.clientX - touchStartX; var dy = t.clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) show(cur + 1); else show(cur - 1); }
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
    else if (d.type === 'zoom') { fzVal = Math.round(d.fz * 100); var p = document.getElementById('fzpct'); if (p) p.textContent = fzVal + '%'; applyZoom(d.fz); }
    else if (d.type === 'tema') { setProjetor(!!d.projetor); }
    else if (d.type === 'sync') sendAll();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); show(1); }
    else if (e.key === 'End') { e.preventDefault(); show(slides.length); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    else if (e.key === 'p' || e.key === 'P') { toggleAuto(); }
    else if (e.key === 'n' || e.key === 'N') { openPresentation(); }
  });

  var playBtn = document.getElementById('play'); if (playBtn) playBtn.addEventListener('click', toggleAuto);
  var fullBtn = document.getElementById('full'); if (fullBtn) fullBtn.addEventListener('click', toggleFullscreen);

  buildDots(); show(1); updateProgress();
})();

