from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import math
INTER_B="/usr/share/fonts/opentype/inter/Inter-Bold.otf"
INTER_S="/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
INTER_M="/usr/share/fonts/opentype/inter/Inter-Medium.otf"

def lerp(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))

def background(w,h):
    # diagonal gradient indigo -> violet, plus cyan and magenta glows
    im=Image.new("RGB",(w,h))
    px=im.load()
    c1=(16,18,48); c2=(58,36,140); 
    for y in range(h):
        for x in range(w):
            t=(x/w*0.55+y/h*0.45)
            px[x,y]=lerp(c1,c2,t)
    glow=Image.new("RGB",(w,h),(0,0,0)); g=ImageDraw.Draw(glow)
    r=int(h*0.9); cx,cy=int(w*0.95),int(h*1.05)
    g.ellipse((cx-r,cy-r,cx+r,cy+r),fill=(0,170,255))
    r2=int(h*0.6); cx2,cy2=int(w*0.05),int(-h*0.1)
    g.ellipse((cx2-r2,cy2-r2,cx2+r2,cy2+r2),fill=(170,60,255))
    glow=glow.filter(ImageFilter.GaussianBlur(h*0.35))
    im=ImageChops.screen(im,ImageChops.multiply(glow,Image.new("RGB",(w,h),(150,150,150))))
    return im

def glyph(size):
    """Tela arredondada com 'slide' e ondas de transmissão. Retorna RGBA quadrado."""
    S=size; im=Image.new("RGBA",(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    # tela
    x0,y0,x1,y1=int(S*.08),int(S*.18),int(S*.80),int(S*.68)
    rad=int(S*.07)
    # sombra
    sh=Image.new("RGBA",(S,S),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle((x0,y0+S*.03,x1,y1+S*.03),rad,fill=(0,0,20,150))
    im=Image.alpha_composite(im,sh.filter(ImageFilter.GaussianBlur(S*.03))); d=ImageDraw.Draw(im)
    # corpo branco com leve gradiente
    body=Image.new("RGBA",(S,S),(0,0,0,0)); bd=ImageDraw.Draw(body)
    for i in range(y0,y1):
        t=(i-y0)/(y1-y0); col=lerp((255,255,255),(214,228,255),t)
        bd.line([(x0,i),(x1,i)],fill=col+(255,))
    mask=Image.new("L",(S,S),0); ImageDraw.Draw(mask).rounded_rectangle((x0,y0,x1,y1),rad,fill=255)
    im.paste(body,(0,0),mask); d=ImageDraw.Draw(im)
    # "slide" dentro da tela: título + barras com gradiente
    m=int(S*.07)
    ix0,iy0,ix1,iy1=x0+m,y0+m,x1-m,y1-m
    d.rounded_rectangle((ix0,iy0,ix0+(ix1-ix0)*.55,iy0+S*.04),int(S*.02),fill=(40,44,90,255))
    bars=[.35,.6,.45,.85]; bw=(ix1-ix0)/(len(bars)*1.6)
    for k,hh in enumerate(bars):
        bx=ix0+k*bw*1.6; top=iy1-(iy1-(iy0+S*.09))*hh
        col=lerp((90,70,255),(0,190,255),k/(len(bars)-1))
        d.rounded_rectangle((bx,top,bx+bw,iy1),int(S*.015),fill=col+(255,))
    # pé da tela
    d.rounded_rectangle((int(S*.36),int(S*.71),int(S*.52),int(S*.75)),int(S*.02),fill=(255,255,255,230))
    # ondas de transmissão (canto superior direito)
    cx,cy=int(S*.80),int(S*.26)
    for k,r in enumerate((S*.08,S*.15,S*.22)):
        a=255-k*55
        d.arc((cx-r,cy-r,cx+r,cy+r),-80,10,fill=(120,220,255,a),width=max(2,int(S*.035)))
    d.ellipse((cx-S*.03,cy-S*.03,cx+S*.03,cy+S*.03),fill=(120,220,255,255))
    return im

def banner(W,H):
    k=4; w,h=W*k,H*k
    im=background(w//4,h//4).resize((w,h),Image.BICUBIC).convert("RGBA")
    g=glyph(int(h*.74)); im.alpha_composite(g,(int(w*.03),int(h*.14)))
    d=ImageDraw.Draw(im)
    tx=int(w*.465)
    f1=ImageFont.truetype(INTER_B,int(h*.215)); f2=ImageFont.truetype(INTER_B,int(h*.215))
    d.text((tx,int(h*.24)),"Diego",font=f1,fill=(255,255,255,255))
    # "Cast" com gradiente
    tw=d.textbbox((0,0),"Cast",font=f2); tlay=Image.new("L",(w,h),0)
    ImageDraw.Draw(tlay).text((tx,int(h*.50)),"Cast",font=f2,fill=255)
    gr=Image.new("RGBA",(w,h)); gd=ImageDraw.Draw(gr)
    for x in range(tx,tx+tw[2]+10):
        t=(x-tx)/(tw[2]+10); gd.line([(x,0),(x,h)],fill=lerp((120,220,255),(190,140,255),t)+(255,))
    im.paste(gr,(0,0),tlay)
    return im.resize((W,H),Image.LANCZOS).convert("RGB")

def icon(S):
    k=4; s=S*k
    bg=background(s//4,s//4).resize((s,s),Image.BICUBIC).convert("RGBA")
    g=glyph(int(s*.92)); bg.alpha_composite(g,(int(s*.06),int(s*.06)))
    mask=Image.new("L",(s,s),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,s-1,s-1),int(s*.22),fill=255)
    out=Image.new("RGBA",(s,s),(0,0,0,0)); out.paste(bg,(0,0),mask)
    return out.resize((S,S),Image.LANCZOS)

banner(640,360).save("banner.png")
icon(192).save("ic_launcher.png")
# prévia: banner + ícone sobre fundo escuro, e banner reduzido como aparece no Lumen
pv=Image.new("RGB",(1100,420),(12,12,16)); b=Image.open("banner.png")
pv.paste(b,(30,30)); ic=Image.open("ic_launcher.png"); pv.paste(ic,(700,30),ic)
small=b.resize((305,183),Image.LANCZOS); pv.paste(small,(700,230))
pv.save("preview.png")
