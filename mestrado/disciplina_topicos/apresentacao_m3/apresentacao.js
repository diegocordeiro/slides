/* runtime.js — navegação, modo apresentador, roteiro, cronômetro e PDF.
   Copiado para cada aula gerada pelo editor (aulaNN.js). Não edite a cópia da aula. */
let c=0,t=document.querySelectorAll('.sl').length,dots=[];
let isPresenter = new URLSearchParams(location.search).get('modo')==='apresentador';
let win=null;

function sh(n){
  document.querySelectorAll('.sl').forEach(s=>s.classList.remove('ac'));
  document.getElementById('s'+(n+1)).classList.add('ac');
  document.getElementById('ctr').textContent=(n+1)+' / '+t;
  dots.forEach(function(b,i){
    var on=i===n;
    b.classList.toggle('ac',on);
    if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  var bp=document.getElementById('bprev'),bn=document.getElementById('bnext');
  if(bp)bp.disabled=n<=0;
  if(bn)bn.disabled=n>=t-1;
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
function autoZoom(){var r=Math.min(window.innerHeight/720,window.innerWidth/1280);var best=0;for(var i=0;i<fzSteps.length;i++){if(fzSteps[i]<=r+0.02)best=i}return best}
const fzSteps=[0.85,1,1.15,1.3,1.45,1.6];
function fz(d){if(d)zoomManual=true;fzLevel=Math.max(0,Math.min(fzSteps.length-1,fzLevel+(d||0)));applyZoom();sync()}
function applyZoom(){var sc=document.querySelector('.sc');if(sc)sc.style.zoom=fzSteps[fzLevel];var el=document.getElementById('fzpct');if(el)el.textContent=Math.round(fzSteps[fzLevel]*100)+'%';}
fzLevel=autoZoom();fz(0);
window.addEventListener('resize',function(){if(!zoomManual){fzLevel=autoZoom();applyZoom()}});

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
window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='estado'&&typeof d.c==='number')applyEstado(d.c,d.fz);else if(d.type==='tela')telaApagada(d.modo,true)});

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
    var dx=x-x0,dy=y-y0,dt=Date.now()-t0;x0=null;
    if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy)*1.3&&dt<1000){if(dx<0)nx();else pv();return true}
    if(Math.abs(dx)<12&&Math.abs(dy)<12&&dt<450&&!emCampo(alvo)&&!emControle(alvo)&&!(alvo&&alvo.closest&&alvo.closest('iframe,video'))){
      var w=window.innerWidth;if(x>w*0.85){nx();return true}if(x<w*0.15){pv();return true}
    }
  }
  sc.addEventListener('touchstart',function(e){if(e.touches.length!==1){x0=null;return}var p=e.touches[0];ini(p.clientX,p.clientY,e.target)},{passive:true});
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
applyZoom();
buildDots();
sh(c);
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
