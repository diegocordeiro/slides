/* runtime.js — navegação, modo apresentador, roteiro, cronômetro e PDF.
   Copiado para cada aula gerada pelo editor (aulaNN.js). Não edite a cópia da aula. */
let c=0,t=document.querySelectorAll('.sl').length,dots=[];
let isPresenter = new URLSearchParams(location.search).get('modo')==='apresentador';
let win=null;

/* ===== Celular/tablet: abre o PDF da aula =====
   O <script> do <head> marca <html class="celular-pdf"> em telas de celular/tablet.
   - navegador que mostra PDF (Safari/iOS, Firefox, Chrome de computador…): abre o PDF direto;
   - sem visualizador de PDF (Chrome/Android, a maioria): mostra botões "Abrir" e "Baixar";
   - sem PDF publicado: cai na versão web em rolagem (?web=1). */
function celularPdf(){
  var raiz=document.documentElement;if(!raiz.classList.contains('celular-pdf'))return;
  var pdf=document.body.getAttribute('data-pdf');
  var web=location.pathname+(location.search?location.search+'&':'?')+'web=1'+location.hash;
  function versaoWeb(){location.replace(web)}
  if(!pdf)return versaoWeb();
  var ua=navigator.userAgent||'';
  var ios=/iPad|iPhone|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
  var mostra=navigator.pdfViewerEnabled===true||(navigator.pdfViewerEnabled===undefined&&ios);
  var titulo=(document.querySelector('.tb h2')||{}).textContent||document.title;
  var p=document.createElement('div');p.id='celular-pdf';
  p.innerHTML='<div class="cp-caixa"><div class="cp-icone" aria-hidden="true">PDF</div>'+
    '<h1></h1><p class="cp-msg">Abrindo a apresentação em PDF…</p>'+
    '<a class="cp-bt cp-pri" id="cp-abrir">Abrir o PDF</a>'+
    '<a class="cp-bt" id="cp-baixar" download>Baixar o PDF</a>'+
    '<a class="cp-link" id="cp-web">Ver no navegador mesmo assim</a></div>';
  p.querySelector('h1').textContent=titulo.trim();
  p.querySelector('#cp-abrir').href=pdf;p.querySelector('#cp-baixar').href=pdf;p.querySelector('#cp-web').href=web;
  document.body.appendChild(p);
  function semVisualizador(){p.querySelector('.cp-msg').textContent='Este navegador não mostra PDF dentro da página. Toque em "Abrir o PDF" (abre no leitor do celular) ou baixe o arquivo.';p.classList.add('pronto')}
  function existe(cb){
    if(location.protocol==='file:'||!window.fetch)return cb(true);
    fetch(pdf,{method:'HEAD',cache:'no-store'}).then(function(r){cb(r.ok)}).catch(function(){cb(false)});
  }
  existe(function(ok){
    if(!ok)return versaoWeb();
    if(mostra){p.classList.add('pronto');location.replace(pdf)}else semVisualizador();
  });
}

/* ===== Celular/tablet: versão web em rolagem (?web=1) =====
   Mesma regra do <script> no <head> da aula (que liga a classe antes de desenhar). */
var MQ_MOVEL='(max-width: 820px), (max-height: 500px) and (pointer: coarse)';
var mqMovel=window.matchMedia?window.matchMedia(MQ_MOVEL):{matches:false};
function movel(){return document.documentElement.classList.contains('movel')}

function sh(n,semRolar){
  document.querySelectorAll('.sl').forEach(s=>s.classList.remove('ac'));
  var alvo=document.getElementById('s'+(n+1));
  alvo.classList.add('ac');
  if(movel()&&!semRolar){rolandoAte=n;clearTimeout(rolandoT);rolandoT=setTimeout(function(){rolandoAte=null},900);alvo.scrollIntoView({behavior:'smooth',block:'start'})}
  document.getElementById('ctr').textContent=(n+1)+' / '+t;
  dots.forEach(function(b,i){
    var on=i===n;
    b.classList.toggle('ac',on);
    if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  var bp=document.getElementById('bprev'),bn=document.getElementById('bnext');
  if(bp)bp.disabled=n<=0;
  if(bn)bn.disabled=n>=t-1;
  if(!movel())ajustarCelular(alvo);
  if(window.zoomPreparar)zoomPreparar(alvo);
}
var rolandoAte=null,rolandoT=null;
/* Celular: grades e linhas de elementos que não cabem na largura passam a quebrar
   (vale também para estruturas criadas no CSS extra da aula). */
function ajustarCelular(sl){
  if(!sl||!movel())return;
  var els=sl.querySelectorAll('*');
  for(var i=0;i<els.length;i++){
    var el=els[i];if(el.closest('table,pre,.dots,.kpi,.tb2,svg'))continue;
    var cs=getComputedStyle(el);
    var estoura=!(el.scrollWidth<=el.clientWidth+2&&el.getBoundingClientRect().right<=sl.getBoundingClientRect().right+2);
    /* grade que cabe, mas com colunas estreitas demais para o texto (ex.: 3–4 cartões lado a lado) */
    if(!estoura&&(cs.display==='grid'||cs.display==='inline-grid')){
      for(var k=0;k<el.children.length;k++){var f=el.children[k];if(f.getBoundingClientRect().width<140&&(f.textContent||'').trim().length>14){estoura=true;break}}
    }
    if(!estoura)continue;
    if(cs.display==='grid'||cs.display==='inline-grid')el.classList.add('grade-movel');
    else if((cs.display==='flex'||cs.display==='inline-flex')&&cs.flexDirection.indexOf('row')===0)el.classList.add('flex-movel');
  }
}
function nx(){if(c<t-1){c++;sh(c);sync()}}
function pv(){if(c>0){c--;sh(c);sync()}}
function go(n){if(n<0||n>=t||n===c)return;c=n;sh(c);sync()}
function buildDots(){
  var box=document.getElementById('dots');if(!box)return;
  dots=[];box.innerHTML='';
  document.querySelectorAll('.sl').forEach(function(s,i){
    var h=s.querySelector('.slhd h2')||s.querySelector('h1')||s.querySelector('h2');
    var nome=h?h.textContent.trim():'Slide '+(i+1);
    var b=document.createElement('button');
    b.type='button';b.className='dot';b.textContent=i+1;
    b.title=(i+1)+' — '+nome;
    b.setAttribute('aria-label','Ir para o slide '+(i+1)+': '+nome);
    b.onclick=function(){go(i)};
    box.appendChild(b);dots.push(b);
  });
}

let fzLevel=1,zoomManual=false;
function autoZoom(){if(movel())return 1; /* modo rolagem: 100% */var r=Math.min(window.innerHeight/720,window.innerWidth/1280);var best=0;for(var i=0;i<fzSteps.length;i++){if(fzSteps[i]<=r+0.02)best=i}return best}
const fzSteps=[0.85,1,1.15,1.3,1.45,1.6];
function fz(d){if(d)zoomManual=true;fzLevel=Math.max(0,Math.min(fzSteps.length-1,fzLevel+(d||0)));applyZoom();sync()}
function applyZoom(){var sc=document.querySelector('.sc');if(sc)sc.style.zoom=fzSteps[fzLevel];var el=document.getElementById('fzpct');if(el)el.textContent=Math.round(fzSteps[fzLevel]*100)+'%';}
fzLevel=autoZoom();fz(0);
window.addEventListener('resize',function(){if(!zoomManual){fzLevel=autoZoom();applyZoom()}if(movel())ajustarTodos()});
function ajustarTodos(){document.querySelectorAll('.sl').forEach(function(sl){ajustarCelular(sl);if(window.zoomPreparar)zoomPreparar(sl)})}

/* liga/desliga o modo rolagem (girar o celular, redimensionar a janela) */
function aplicarMovel(){
  if(document.documentElement.classList.contains('celular-pdf'))return; /* celular: tela do PDF */
  var era=movel(),agora=!!mqMovel.matches&&!isPresenter&&/[?&]web=1/.test(location.search);
  document.documentElement.classList.toggle('movel',agora);
  if(agora){
    if(!zoomManual){fzLevel=autoZoom();applyZoom()}
    ajustarTodos();
    if(!era&&c>0){ /* mantém o slide em que estava */
      var alvo=c;rolandoAte=alvo;clearTimeout(rolandoT);rolandoT=setTimeout(function(){rolandoAte=null},600);
      requestAnimationFrame(function(){var a=document.getElementById('s'+(alvo+1));if(a)a.scrollIntoView({block:'start'})});
    }
  }else if(era){
    window.scrollTo(0,0);if(!zoomManual){fzLevel=autoZoom();applyZoom()}sh(c,true);
  }
}
if(mqMovel.addEventListener)mqMovel.addEventListener('change',aplicarMovel);else if(mqMovel.addListener)mqMovel.addListener(aplicarMovel);
/* o slide "atual" (contador, botões ‹ ›) é o que está no terço de cima da tela */
function atualPelaRolagem(){
  if(!movel())return;
  var melhor=0,lim=window.innerHeight*0.35;
  document.querySelectorAll('.sl').forEach(function(sl,i){if(sl.getBoundingClientRect().top<=lim)melhor=i});
  if((window.innerHeight+window.scrollY)>=document.documentElement.scrollHeight-4)melhor=t-1; /* chegou ao fim */
  if(rolandoAte!==null&&melhor!==rolandoAte)return; /* durante a rolagem suave disparada por ‹ › */
  if(melhor!==c){c=melhor;sh(c,true)}
}
var rafMovel=0;
window.addEventListener('scroll',function(){if(!movel()||rafMovel)return;rafMovel=requestAnimationFrame(function(){rafMovel=0;atualPelaRolagem()})},{passive:true});

function openPresenter(){
  var bp=document.getElementById('bp');
  if(win && !win.closed){win.close();win=null;if(bp)bp.textContent='Modo apresentador';return}
  var url=location.href.split('?')[0].split('#')[0]+'?modo=apresentador&c='+c+(zoomManual?'&fz='+fzLevel:'')+'&limite='+(TMR_LIM/60);
  win=window.open(url,'slides_apresentador','menubar=no,toolbar=no,location=no,width=1280,height=800');
  if(win && bp)bp.textContent='Fechar apresentação';
}
function sync(){
  try{
    if(isPresenter){if(window.opener)window.opener.postMessage({type:'estado',c:c,fz:zoomManual?fzLevel:null},'*')}
    else if(win && !win.closed){win.postMessage({type:'estado',c:c,fz:zoomManual?fzLevel:null},'*')}
  }catch(e){}
}
function applyEstado(cn,fzN){
  c=cn;
  if(typeof fzN==='number'){fzLevel=Math.max(0,Math.min(fzSteps.length-1,fzN));applyZoom()}
  sh(c);
}
window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='estado'&&typeof d.c==='number')applyEstado(d.c,d.fz);else if(d.type==='tela')telaApagada(d.modo,true);else if(d.type==='zoom'&&window.zoomRemoto)zoomRemoto(d)});

function rv(e){e.classList.toggle('rv')}

function toggleFullscreen(){if(document.fullscreenElement||document.webkitFullscreenElement){if(document.exitFullscreen)document.exitFullscreen();else if(document.webkitExitFullscreen)document.webkitExitFullscreen();}else{var d=document.documentElement;if(d.requestFullscreen)d.requestFullscreen();else if(d.webkitRequestFullscreen)d.webkitRequestFullscreen();}}

/* Exporta os slides em PDF pela janela de impressão (CSS @media print em estilo.css).
   O zoom aplicado ao .sc na tela é neutralizado durante a impressão. */
function exportarPDF(){
  var sc=document.querySelector('.sc'),antes=sc?sc.style.zoom:'';
  if(sc)sc.style.zoom='1';
  function restaurar(){if(sc)sc.style.zoom=antes;window.removeEventListener('afterprint',restaurar)}
  window.addEventListener('afterprint',restaurar);
  window.print();
  setTimeout(restaurar,1500);
}
/* ===== Teclado e passadores de slides (clickers) =====
   Os passadores USB/Bluetooth se apresentam como teclado e enviam, conforme o modelo:
   PageDown/PageUp (Logitech, Targus…), setas, Espaço/Enter, F5 ou Esc (botão "iniciar")
   e "." ou "b" (botão "tela preta"). Tudo funciona nas duas janelas (apresentação e
   apresentador) e a outra janela acompanha pelo postMessage. */
var TECLAS_AVANCAR=['ArrowRight','ArrowDown','PageDown',' ','Spacebar','Enter','MediaTrackNext','MediaNextTrack'],
    TECLAS_VOLTAR=['ArrowLeft','ArrowUp','PageUp','Backspace','MediaTrackPrevious','MediaPreviousTrack'];
function emCampo(el){return el&&(el.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))}
function emControle(el){return el&&el.closest&&el.closest('button,a[href],summary,[role="button"],.rev,.aba,[onclick]')}
function telaApagada(modo,remoto){
  var v=document.getElementById('tela-apagada');
  if(!v){v=document.createElement('div');v.id='tela-apagada';v.title='Clique ou pressione qualquer tecla para voltar';
    v.onclick=function(){telaApagada(null)};document.body.appendChild(v)}
  var atual=v.getAttribute('data-modo');
  if(modo===undefined)modo=null;
  if(modo&&atual===modo&&!remoto)modo=null;
  if(modo){v.setAttribute('data-modo',modo);v.className='on '+modo}else{v.removeAttribute('data-modo');v.className=''}
  if(!remoto){try{var alvo=isPresenter?window.opener:(win&&!win.closed?win:null);if(alvo)alvo.postMessage({type:'tela',modo:modo},'*')}catch(x){}}
}
document.addEventListener('keydown',function(e){
  if(emCampo(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;
  var k=e.key,v=document.getElementById('tela-apagada');
  if(v&&v.getAttribute('data-modo')&&k!=='Shift'){e.preventDefault();telaApagada(null);return}
  if((k===' '||k==='Enter')&&emControle(e.target))return; /* Espaço/Enter num botão focado: deixa o botão agir */
  if(k===' '&&e.shiftKey){e.preventDefault();pv();return}
  if(movel()&&(k==='ArrowUp'||k==='ArrowDown'||k==='PageUp'||k==='PageDown'||k===' '))return; /* rolagem nativa */
  if(TECLAS_AVANCAR.indexOf(k)>=0){e.preventDefault();nx()}
  else if(TECLAS_VOLTAR.indexOf(k)>=0){e.preventDefault();pv()}
  else if(k==='Home'){e.preventDefault();go(0)}
  else if(k==='End'){e.preventDefault();go(t-1)}
  else if(k==='f'||k==='F'||k==='F5'){e.preventDefault();toggleFullscreen()}
  else if(k==='b'||k==='B'||k==='.'||k===';'){e.preventDefault();telaApagada('preta')}
  else if(k==='w'||k==='W'||k===','){e.preventDefault();telaApagada('branca')}
});

/* ===== Telas sensíveis ao toque =====
   Arrastar para a esquerda/direita troca de slide; toque rápido na faixa lateral
   (15% de cada lado) também avança/volta. A rolagem vertical do slide continua normal. */
(function(){
  var sc=document.querySelector('.sc');if(!sc)return;
  var x0=null,y0=0,t0=0,alvo=null;
  function ini(x,y,el){x0=x;y0=y;t0=Date.now();alvo=el}
  function fim(x,y){
    if(x0===null)return;
    if(movel()){x0=null;return}
    var dx=x-x0,dy=y-y0,dt=Date.now()-t0;x0=null;
    if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.3&&dt<1000){if(dx<0)nx();else pv();return true}
    if(Math.abs(dx)<12&&Math.abs(dy)<12&&dt<450&&!emCampo(alvo)&&!emControle(alvo)&&!(alvo&&alvo.closest&&alvo.closest('iframe,video'))){
      var w=window.innerWidth;if(x>w*0.85){nx();return true}if(x<w*0.15){pv();return true}
    }
  }
  /* não troca de slide quando o dedo arrasta algo que rola na horizontal (tabela larga, código, pontos) */
  function rolaHorizontal(el){for(var n=el;n&&n!==sc;n=n.parentNode){if(n.nodeType===1&&n.scrollWidth>n.clientWidth+4){var ox=getComputedStyle(n).overflowX;if(ox==='auto'||ox==='scroll')return true}}return false}
  sc.addEventListener('touchstart',function(e){if(e.touches.length!==1||rolaHorizontal(e.target)){x0=null;return}var p=e.touches[0];ini(p.clientX,p.clientY,e.target)},{passive:true});
  sc.addEventListener('touchend',function(e){var p=e.changedTouches[0];if(p&&fim(p.clientX,p.clientY)&&e.cancelable)e.preventDefault()},{passive:false});
  sc.addEventListener('touchcancel',function(){x0=null},{passive:true});
  /* caneta (stylus) em telas interativas que não geram eventos de toque */
  sc.addEventListener('pointerdown',function(e){if(e.pointerType==='pen')ini(e.clientX,e.clientY,e.target)},{passive:true});
  sc.addEventListener('pointerup',function(e){if(e.pointerType==='pen')fim(e.clientX,e.clientY)},{passive:true});
})();

if(isPresenter){
  document.body.classList.add('modo-presenter');
  var params=new URLSearchParams(location.search);
  var pc=params.get('c');if(pc!==null&&parseInt(pc)>=0)c=parseInt(pc);
  var pf=params.get('fz');if(pf!==null&&parseInt(pf)>=0)zoomManual=true,fzLevel=Math.max(0,Math.min(fzSteps.length-1,parseInt(pf)));
  document.title='(Apresentação) — '+document.title;
}
/* ===== Zoom de imagens em tela cheia =====
   Clique na imagem (mouse) ou toque no botão de lupa (canto da imagem) abre o visualizador:
   roda/pinça/+ − ampliam, arrastar move, clique/toque alterna 2,5×, ← → passam entre as
   imagens do slide, Esc/✕/clique no fundo fecham. Sincroniza com a janela do apresentador.
   Não entram: logos, marca d'água, fundos de seção, a imagem da capa, ícones pequenos,
   imagens dentro de links e figuras marcadas "sem zoom" no editor. */
(function(){
  var MIN=120,vis=null,lista=[],idx=0,esc=1,tx=0,ty=0,ultimoTipo='mouse',telaCheiaNossa=false;
  var IC_LUPA='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  document.addEventListener('pointerdown',function(e){ultimoTipo=e.pointerType||'mouse'},true);
  function elegivel(img){
    if(!img.closest('.sl')||img.closest('a,.tb,.ft,.capa .dir,.divisor,.secao-slide,[data-zoom="nao"],#celular-pdf'))return false;
    if(img.classList.contains('marca')||img.classList.contains('tb-logo')||img.classList.contains('bg'))return false;
    if(img.complete&&img.naturalWidth&&img.naturalWidth<MIN&&img.naturalHeight<MIN)return false;
    return true;
  }
  function imagensDo(sl){return sl?Array.prototype.filter.call(sl.querySelectorAll('img'),elegivel):[]}
  function posicionar(bt,img){
    var w=img.offsetWidth,h=img.offsetHeight;
    if(!w||!h||(w<MIN&&h<MIN)){bt.style.display='none';return}
    bt.style.display='';bt.style.top=(img.offsetTop+8)+'px';bt.style.left=(img.offsetLeft+w-bt.offsetWidth-8)+'px';
  }
  window.zoomPreparar=function(sl){
    imagensDo(sl).forEach(function(img){
      img.classList.add('zoom-ok');
      if(!img._zoomBt){
        var pai=img.parentNode;
        if(getComputedStyle(pai).position==='static')pai.classList.add('zoom-pai');
        var bt=document.createElement('button');bt.type='button';bt.className='zoom-bt';bt.innerHTML=IC_LUPA;
        bt.title='Ampliar imagem';bt.setAttribute('aria-label','Ampliar imagem'+(img.alt?': '+img.alt:''));
        bt.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();abrir(img)});
        pai.appendChild(bt);img._zoomBt=bt;
        img.addEventListener('load',function(){if(!elegivel(img)){bt.remove();img.classList.remove('zoom-ok');img._zoomBt=null}else posicionar(bt,img)});
        img.addEventListener('click',function(e){if(ultimoTipo==='mouse'&&img._zoomBt){e.preventDefault();e.stopPropagation();abrir(img)}});
      }
      posicionar(img._zoomBt,img);
    });
  };
  window.addEventListener('resize',function(){if(vis&&vis.classList.contains('on')){encaixar(vis.querySelector('.zv-img'));aplicar()}var a=document.querySelector('.sl.ac');if(a&&!movel())setTimeout(function(){zoomPreparar(a)},60)});

  function montar(){
    if(vis)return;
    vis=document.createElement('div');vis.id='zoom-vis';vis.setAttribute('role','dialog');vis.setAttribute('aria-modal','true');
    vis.innerHTML='<div class="zv-palco"><img class="zv-img" alt="" draggable="false"></div>'+
      '<div class="zv-barra"><button type="button" data-a="menos" title="Diminuir (−)">−</button><span class="zv-pct">100%</span>'+
      '<button type="button" data-a="mais" title="Ampliar (+)">+</button><button type="button" data-a="ajustar" title="Ajustar à tela (0)">⤢</button>'+
      '<button type="button" data-a="fechar" class="zv-x" title="Fechar (Esc)">✕</button></div>'+
      '<button type="button" class="zv-nav zv-ant" data-a="ant" title="Imagem anterior (←)">‹</button>'+
      '<button type="button" class="zv-nav zv-prox" data-a="prox" title="Próxima imagem (→)">›</button>'+
      '<div class="zv-leg"></div>';
    document.body.appendChild(vis);
    vis.addEventListener('click',function(e){
      var a=e.target.closest('[data-a]');
      if(a){e.stopPropagation();var op=a.getAttribute('data-a');
        if(op==='fechar')fechar();else if(op==='mais')escalar(esc*1.5);else if(op==='menos')escalar(esc/1.5);
        else if(op==='ajustar')escalar(1);else if(op==='ant')trocar(-1);else if(op==='prox')trocar(1);return}
      if(e.target===vis||e.target.classList.contains('zv-palco'))fechar();
    });
    var im=vis.querySelector('.zv-img'),pts={},ini=null,dist0=0,esc0=1,arrastou=false;
    vis.addEventListener('wheel',function(e){e.preventDefault();escalar(esc*Math.pow(1.0015,-e.deltaY),e.clientX,e.clientY)},{passive:false});
    im.addEventListener('pointerdown',function(e){
      e.preventDefault();im.setPointerCapture(e.pointerId);pts[e.pointerId]={x:e.clientX,y:e.clientY};
      var ks=Object.keys(pts);arrastou=false;
      if(ks.length===1)ini={x:e.clientX,y:e.clientY,tx:tx,ty:ty,t:Date.now()};
      if(ks.length===2){var a=pts[ks[0]],b=pts[ks[1]];dist0=Math.hypot(a.x-b.x,a.y-b.y);esc0=esc}
    });
    im.addEventListener('pointermove',function(e){
      if(!pts[e.pointerId])return;pts[e.pointerId]={x:e.clientX,y:e.clientY};var ks=Object.keys(pts);
      if(ks.length===2){var a=pts[ks[0]],b=pts[ks[1]];arrastou=true;escalar(esc0*Math.hypot(a.x-b.x,a.y-b.y)/(dist0||1),(a.x+b.x)/2,(a.y+b.y)/2);return}
      if(!ini)return;var dx=e.clientX-ini.x,dy=e.clientY-ini.y;
      if(Math.abs(dx)+Math.abs(dy)>6)arrastou=true;
      if(esc>1.01){tx=ini.tx+dx;ty=ini.ty+dy;aplicar()}
      else if(e.pointerType!=='mouse'){ty=Math.max(0,dy);im.style.opacity=String(Math.max(.3,1-ty/400));aplicar()} /* puxar para baixo fecha */
    });
    function solta(e){
      var eraUm=Object.keys(pts).length===1;delete pts[e.pointerId];
      if(!eraUm)return;
      if(esc<=1.01&&e.pointerType!=='mouse'&&ty>110){fechar();return}
      if(esc<=1.01){ty=0;im.style.opacity='';aplicar()}
      if(!arrastou&&ini&&Date.now()-ini.t<500){ /* clique/toque: alterna 2,5× no ponto */
        if(esc>1.01)escalar(1);else escalar(2.5,e.clientX,e.clientY);
      }
      ini=null;
    }
    im.addEventListener('pointerup',solta);im.addEventListener('pointercancel',function(e){delete pts[e.pointerId];ini=null});
    document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement&&telaCheiaNossa){telaCheiaNossa=false;if(vis.classList.contains('on'))fechar()}});
  }
  /* ocupa o máximo da tela mantendo a proporção (inclusive imagens pequenas e SVGs) */
  function encaixar(im){
    var pal=vis.querySelector('.zv-palco'),cs=getComputedStyle(pal);
    var pw=pal.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),ph=pal.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
    var nw=im.naturalWidth||1600,nh=im.naturalHeight||900,k=Math.min(pw/nw,ph/nh);
    im.style.width=Math.round(nw*k)+'px';im.style.height=Math.round(nh*k)+'px';
  }
  function aplicar(){
    var im=vis.querySelector('.zv-img');
    im.style.transform='translate('+tx+'px,'+ty+'px) scale('+esc+')';
    vis.querySelector('.zv-pct').textContent=Math.round(esc*100)+'%';
    vis.classList.toggle('ampliada',esc>1.01);
  }
  function escalar(novo,cx,cy){
    novo=Math.max(1,Math.min(8,novo));
    if(novo===1){esc=1;tx=0;ty=0;aplicar();return}
    var r=vis.querySelector('.zv-palco').getBoundingClientRect();
    if(cx===undefined){cx=r.left+r.width/2;cy=r.top+r.height/2}
    var ox=cx-(r.left+r.width/2),oy=cy-(r.top+r.height/2),k=novo/esc;
    tx=ox-(ox-tx)*k;ty=oy-(oy-ty)*k;esc=novo;aplicar();
  }
  function mostrar(i){
    idx=(i+lista.length)%lista.length;var img=lista[idx];
    var im=vis.querySelector('.zv-img');im.style.opacity='';im.style.width=im.style.height='';
    im.onload=function(){encaixar(im)};im.src=img.currentSrc||img.src;im.alt=img.alt||'';if(im.complete)encaixar(im);
    var fig=img.closest('.fig'),cap=fig&&fig.nextElementSibling&&fig.nextElementSibling.classList.contains('cap')?fig.nextElementSibling.textContent:'';
    var leg=(cap||img.alt||'').trim();
    vis.querySelector('.zv-leg').textContent=leg+(lista.length>1?'  ('+(idx+1)+'/'+lista.length+')':'');
    vis.querySelector('.zv-leg').style.display=(leg||lista.length>1)?'':'none';
    vis.classList.toggle('varias',lista.length>1);
    esc=1;tx=0;ty=0;aplicar();
  }
  function abrir(img,remoto){
    montar();var sl=img.closest('.sl');lista=imagensDo(sl);var i=lista.indexOf(img);if(i<0){lista=[img];i=0}
    mostrar(i);vis.classList.add('on');document.documentElement.classList.add('zoom-aberto');
    if(!remoto){
      try{if(!document.fullscreenElement&&vis.requestFullscreen&&!movel()){vis.requestFullscreen().then(function(){telaCheiaNossa=true}).catch(function(){})}}catch(x){}
      enviar({type:'zoom',slide:c,i:idx});
      vis.querySelector('.zv-x').focus({preventScroll:true});
    }
  }
  function fechar(remoto){
    if(!vis||!vis.classList.contains('on'))return;
    vis.classList.remove('on');document.documentElement.classList.remove('zoom-aberto');
    if(telaCheiaNossa&&document.fullscreenElement){telaCheiaNossa=false;try{document.exitFullscreen()}catch(x){}}
    if(!remoto)enviar({type:'zoom',fechar:true});
  }
  function trocar(d){if(lista.length>1){mostrar(idx+d);enviar({type:'zoom',slide:c,i:idx})}}
  function enviar(m){try{var alvo=isPresenter?window.opener:(win&&!win.closed?win:null);if(alvo)alvo.postMessage(m,'*')}catch(x){}}
  window.zoomRemoto=function(d){
    if(d.fechar)return fechar(true);
    var sl=document.getElementById('s'+(d.slide+1));var imgs=imagensDo(sl);
    if(imgs[d.i]){if(d.slide!==c){c=d.slide;sh(c,true)}abrir(imgs[d.i],true)}
  };
  window.zoomAberto=function(){return !!(vis&&vis.classList.contains('on'))};
  /* teclado com o zoom aberto (tem prioridade sobre a navegação dos slides) */
  window.addEventListener('keydown',function(e){
    if(!zoomAberto())return;var k=e.key;
    if(k==='Escape'||k==='PageDown'||k==='PageUp'||k===' '||k==='Enter'||k==='Backspace'){e.preventDefault();fechar()}
    else if(k==='ArrowRight'){e.preventDefault();lista.length>1?trocar(1):fechar()}
    else if(k==='ArrowLeft'){e.preventDefault();lista.length>1?trocar(-1):fechar()}
    else if(k==='+'||k==='='){e.preventDefault();escalar(esc*1.5)}
    else if(k==='-'||k==='_'){e.preventDefault();escalar(esc/1.5)}
    else if(k==='0'){e.preventDefault();escalar(1)}
    else return;
    e.stopImmediatePropagation();
  },true);
})();

aplicarMovel();
celularPdf();
applyZoom();
buildDots();
sh(c,true);
sync();

/* ?pdf=1 — usado pelo exportar_pdf.sh: mantém o zoom em 1 para o PDF sair no tamanho de projeto */
if(new URLSearchParams(location.search).get('pdf')==='1'){zoomManual=true;fzLevel=1;applyZoom()}

/* ===== Roteiro de fala e cronômetro ===== */
function toggleNotas(){document.body.classList.toggle('notas');var b=document.getElementById('bnt');if(b)b.classList.toggle('on',document.body.classList.contains('notas'))}
var tmrIni=null,tmrAcum=0,tmrId=null;
/* Limite do cronômetro: ?limite=<min> na URL > localStorage (Shift+clique) > valor abaixo */
var TMR_CONF={limiteMin:parseFloat(document.body.getAttribute('data-limite'))||10},TMR_CHAVE='slides_tmr_lim:'+location.pathname;
function tmrNum(v){var n=parseFloat(String(v).replace(',','.'));return isFinite(n)?n:NaN}
function tmrLimiteMin(){
  var q=new URLSearchParams(location.search).get('limite');
  if(q!==null&&tmrNum(q)>0)return tmrNum(q);
  try{var ls=tmrNum(localStorage.getItem(TMR_CHAVE));if(ls>0)return ls}catch(e){}
  return TMR_CONF.limiteMin;
}
var TMR_LIM=Math.round(tmrLimiteMin()*60);
function tmrSeg(){return Math.floor((tmrAcum+(tmrIni?Date.now()-tmrIni:0))/1000)}
function tmrFmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
/* verde até 60% do limite, amarelo de 60% a 90%, vermelho de 90% em diante */
function tmrDraw(){
  var el=document.getElementById('tmr');if(!el)return;
  var s=tmrSeg(),p=TMR_LIM?s/TMR_LIM:0;
  el.textContent=tmrFmt(s)+' / '+tmrFmt(TMR_LIM);
  el.classList.toggle('run',s>0&&p<=0.6);
  el.classList.toggle('alerta',s>0&&p>0.6&&p<=0.9);
  el.classList.toggle('estouro',p>0.9);
  el.title='Iniciar/pausar (T) · duplo clique zera · Shift+clique define o limite (agora '+tmrFmt(TMR_LIM)+')';
}
function tmrDefinirLimite(){
  var v=prompt('Limite do cronômetro em minutos (0,5 a 180):',String(+(TMR_LIM/60)).replace('.',','));
  if(v===null)return;
  var n=tmrNum(v);
  if(!(n>=0.5&&n<=180)){alert('Valor inválido: informe um número entre 0,5 e 180 minutos.');return}
  TMR_LIM=Math.round(n*60);
  try{localStorage.setItem(TMR_CHAVE,String(n))}catch(e){}
  tmrDraw();
}
function toggleTimer(){if(tmrIni){tmrAcum+=Date.now()-tmrIni;tmrIni=null;clearInterval(tmrId)}else{tmrIni=Date.now();tmrId=setInterval(tmrDraw,500)}tmrDraw()}
function resetTimer(){if(tmrIni){clearInterval(tmrId)}tmrIni=null;tmrAcum=0;tmrDraw()}
document.addEventListener('keydown',function(e){if(isPresenter||emCampo(e.target)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='n'||e.key==='N')toggleNotas();else if(e.key==='t'||e.key==='T')toggleTimer()});
tmrDraw();
