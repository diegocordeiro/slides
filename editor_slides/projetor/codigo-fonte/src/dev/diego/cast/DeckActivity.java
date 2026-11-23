package dev.diego.cast;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Mostra uma aula do site em tela cheia, controlada pelo controle remoto.
 * O navegador embutido só abre endereços de diegocordeiro.github.io/slides/ e não expõe nada do Android à página.
 * As teclas do controle viram as teclas que as aulas já entendem: ← → Home End p e fz() (tamanho do texto).
 */
public class DeckActivity extends Activity {

    static final String EXTRA_URL = "url", EXTRA_TITLE = "titulo", EXTRA_KEY = "chave";

    private static final int INK = Color.WHITE, SOFT = 0xB3FFFFFF, MUTED = 0x80FFFFFF, BLUE = 0xFF7CC4FF;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private float u;
    private WebView web;
    private FrameLayout loading, menu;
    private TextView loadingText, toast;
    private LinearLayout menuButtons;
    private String key;
    private boolean loaded = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (getSharedPreferences("seguranca", MODE_PRIVATE).getBoolean("bloquear_capturas", true))
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        u = getResources().getDisplayMetrics().widthPixels / 1920f;

        final String url = getIntent().getStringExtra(EXTRA_URL);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        key = getIntent().getStringExtra(EXTRA_KEY);
        if (!SlidesCatalog.allowed(url)) { finish(); return; }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(false);                       // as teclas são tratadas aqui e repassadas à página
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, String to) {
                if (SlidesCatalog.allowed(to)) return false;
                flash("Link externo bloqueado");
                return true;
            }
            @Override public void onPageFinished(WebView v, String u2) {
                if (loaded) return;
                loaded = true;
                // Tela de TV: esconde as barras de ferramentas/rodapé das aulas do editor (o slide ocupa tudo).
                // As aulas antigas já ficam limpas pelo #apresentacao. Nada muda no site.
                js("(function(){if(document.getElementById('diegocast-tv'))return;var s=document.createElement('style');"
                        + "s.id='diegocast-tv';s.textContent='header.tb,footer.ft,nav.ctr,.fita{display:none!important}';"
                        + "document.head.appendChild(s);})()");
                loading.setVisibility(View.GONE);
                resume();
            }
            @Override public void onReceivedError(WebView v, int code, String desc, String failing) {
                if (failing != null && failing.startsWith(url)) {
                    loadingText.setText("Não foi possível abrir a aula.\nConfira a internet da TV e tente de novo (Voltar sai).");
                    loading.setVisibility(View.VISIBLE);
                }
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        loading = new FrameLayout(this);
        loading.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF231A5E, 0xFF101A44, 0xFF06243F}));
        LinearLayout lc = new LinearLayout(this);
        lc.setOrientation(LinearLayout.VERTICAL);
        lc.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView lt = text(52, INK, "sans-serif-medium");
        lt.setText(title == null ? "Aula" : title);
        lt.setGravity(Gravity.CENTER);
        loadingText = text(26, SOFT, "sans-serif-light");
        loadingText.setText("Abrindo a aula…");
        loadingText.setGravity(Gravity.CENTER);
        loadingText.setPadding(0, px(20), 0, 0);
        lc.addView(lt);
        lc.addView(loadingText);
        loading.addView(lc, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        root.addView(loading, new FrameLayout.LayoutParams(-1, -1));

        toast = text(24, INK, "sans-serif-medium");
        toast.setPadding(px(28), px(14), px(28), px(14));
        GradientDrawable tb = new GradientDrawable();
        tb.setColor(0xCC14123A);
        tb.setCornerRadius(px(30));
        toast.setBackground(tb);
        toast.setVisibility(View.GONE);
        FrameLayout.LayoutParams tl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        tl.bottomMargin = px(60);
        root.addView(toast, tl);

        buildMenu(root);
        setContentView(root);
        web.loadUrl(url.contains("#") ? url : url + "#apresentacao");   // modo apresentação: sem controles na tela
    }

    // ------------------------------------------------------------------ controle remoto

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;

        if (menu.getVisibility() == View.VISIBLE) {
            if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_MENU) {
                if (!down) hideMenu();
                return true;
            }
            return super.dispatchKeyEvent(e);          // navegação normal entre os botões do menu
        }

        switch (k) {
            case KeyEvent.KEYCODE_MENU:
                if (!down) showMenu();
                return true;
            case KeyEvent.KEYCODE_BACK:
                return super.dispatchKeyEvent(e);
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_PAGE_DOWN:
                if (down) key("ArrowRight");
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_PAGE_UP:
                if (down) key("ArrowLeft");
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
                if (down) { js("window.fz&&window.fz(1)"); }
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                if (down) { js("window.fz&&window.fz(-1)"); }
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (down && e.getRepeatCount() == 0) { key("p"); flash("Passagem automática ligada/desligada"); }
                return true;
        }
        return super.dispatchKeyEvent(e);
    }

    /** Dispara a tecla dentro da página, exatamente como um teclado faria. */
    private void key(String name) {
        js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + name + "',bubbles:true,cancelable:true}))");
    }

    private void js(String code) {
        if (web != null && loaded) web.evaluateJavascript(code, null);
    }

    // ------------------------------------------------------------------ retomar de onde parou

    @Override
    protected void onPause() {
        super.onPause();
        if (web == null || !loaded) return;
        web.evaluateJavascript("(function(){var c=document.getElementById('ctr');return c?c.textContent:'';})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String v) {
                        try {
                            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+)\\s*/\\s*(\\d+)").matcher(v);
                            if (!m.find()) return;
                            int cur = Integer.parseInt(m.group(1));
                            int total = Integer.parseInt(m.group(2));
                            // chegou ao fim: da próxima vez começa do início
                            int save = cur >= total ? 1 : cur;
                            getSharedPreferences("aulas", MODE_PRIVATE).edit().putInt("pos:" + key, save).apply();
                        } catch (Exception ignored) { }
                    }
                });
    }

    private void resume() {
        int n = getSharedPreferences("aulas", MODE_PRIVATE).getInt("pos:" + key, 1);
        if (n <= 1) return;
        js("(function(n){var k=function(x){document.dispatchEvent(new KeyboardEvent('keydown',{key:x,bubbles:true}))};"
                + "k('Home');for(var i=1;i<n;i++)k('ArrowRight');})(" + n + ")");
        flash("Retomando no slide " + n + "  ·  ☰ → Recomeçar para voltar ao início");
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            ((FrameLayout) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------ menu ☰

    private void buildMenu(FrameLayout root) {
        menu = new FrameLayout(this);
        menu.setBackgroundColor(0xB305060F);
        menu.setVisibility(View.GONE);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(px(56), px(48), px(56), px(44));
        GradientDrawable bb = new GradientDrawable();
        bb.setColor(0xF21A1846);
        bb.setCornerRadius(px(36));
        bb.setStroke(2, 0x33FFFFFF);
        box.setBackground(bb);

        TextView k = text(20, BLUE, "sans-serif-medium");
        k.setText("MENU DA AULA");
        k.setLetterSpacing(0.22f);
        box.addView(k);

        menuButtons = new LinearLayout(this);
        menuButtons.setOrientation(LinearLayout.VERTICAL);
        menuButtons.setPadding(0, px(24), 0, px(10));
        menuButton("Recomeçar do primeiro slide", new Runnable() { @Override public void run() { key("Home"); } });
        menuButton("Ir para o último slide", new Runnable() { @Override public void run() { key("End"); } });
        menuButton("Passagem automática (liga/desliga)", new Runnable() { @Override public void run() { key("p"); } });
        menuButton("Voltar ao catálogo", new Runnable() { @Override public void run() { finish(); } });
        box.addView(menuButtons);

        TextView help = text(20, MUTED, "sans-serif-light");
        help.setText("◀ ▶ OK passam os slides  ·  ▲ ▼ tamanho do texto  ·  ⏯ passagem automática");
        help.setPadding(0, px(14), 0, 0);
        box.addView(help);

        menu.addView(box, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        root.addView(menu, new FrameLayout.LayoutParams(-1, -1));
    }

    private void menuButton(String label, final Runnable action) {
        final TextView b = text(28, INK, "sans-serif-medium");
        b.setText(label);
        b.setPadding(px(30), px(18), px(30), px(18));
        b.setFocusable(true);
        b.setClickable(true);
        final GradientDrawable bg = new GradientDrawable();
        bg.setColor(0x00000000);
        bg.setCornerRadius(px(22));
        b.setBackground(bg);
        b.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                bg.setColor(f ? Color.WHITE : 0x00000000);
                b.setTextColor(f ? 0xFF14123A : INK);
            }
        });
        b.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { hideMenu(); action.run(); }
        });
        LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(-1, -2);
        l.topMargin = px(6);
        menuButtons.addView(b, l);
    }

    private void showMenu() {
        menu.setVisibility(View.VISIBLE);
        menuButtons.getChildAt(0).requestFocus();
    }

    private void hideMenu() { menu.setVisibility(View.GONE); }

    private final Runnable hideToast = new Runnable() { @Override public void run() { toast.setVisibility(View.GONE); } };

    private void flash(String msg) {
        toast.setText(msg);
        toast.setVisibility(View.VISIBLE);
        ui.removeCallbacks(hideToast);
        ui.postDelayed(hideToast, 2500);
    }

    // ------------------------------------------------------------------ util

    private int px(float v) { return Math.round(v * u); }

    private TextView text(float size, int color, String family) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(size));
        t.setTextColor(color);
        t.setTypeface(Typeface.create(family, Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        return t;
    }
}
