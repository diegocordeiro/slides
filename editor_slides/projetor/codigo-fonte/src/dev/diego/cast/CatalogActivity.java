package dev.diego.cast;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.webkit.WebView;
import android.widget.ImageView;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Catálogo das aulas do site, em fileiras de cartões por seção. Tudo pelo controle. */
public class CatalogActivity extends Activity {

    private static final int INK = Color.WHITE, SOFT = 0xB3FFFFFF, MUTED = 0x80FFFFFF;
    private static final int BLUE = 0xFF7CC4FF, AMBER = 0xFFFBBF24;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private float u;
    private LinearLayout list;
    private TextView status;
    private List<SlidesCatalog.Aula> shown = new ArrayList<>();
    private String lastOpened;
    private ThumbMaker thumbs;
    private final Map<String, ImageView> thumbViews = new HashMap<>();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (getSharedPreferences("seguranca", MODE_PRIVATE).getBoolean("bloquear_capturas", true))
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        u = getResources().getDisplayMetrics().widthPixels / 1920f;
        lastOpened = getSharedPreferences("aulas", MODE_PRIVATE).getString("ultima", null);

        FrameLayout root = new FrameLayout(this);
        // WebView escondido atrás do fundo: carrega cada aula para fotografar o primeiro slide.
        WebView shooter = new WebView(this);
        root.addView(shooter, new FrameLayout.LayoutParams(-1, -1));
        View backdrop = new View(this);
        backdrop.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF231A5E, 0xFF101A44, 0xFF06243F}));
        root.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
        thumbs = new ThumbMaker(this, shooter, new ThumbMaker.Listener() {
            @Override public void onThumb(SlidesCatalog.Aula a, Bitmap bmp) {
                ImageView iv = thumbViews.get(a.url);
                if (iv != null) showThumb(iv, bmp);
            }
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        scroll.setFadingEdgeLength(px(80));
        scroll.setVerticalFadingEdgeEnabled(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setClipChildren(false);
        col.setClipToPadding(false);
        col.setPadding(px(110), px(70), 0, px(100));

        TextView kicker = text(22, BLUE, "sans-serif-medium");
        kicker.setText("DIEGO CAST");
        kicker.setLetterSpacing(0.22f);
        col.addView(kicker);
        TextView title = text(64, INK, "sans-serif-medium");
        title.setText("Apresentações");
        title.setPadding(0, px(10), 0, px(10));
        col.addView(title);
        status = text(24, MUTED, "sans-serif-light");
        status.setText("Carregando a lista de aulas…");
        col.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setClipChildren(false);
        list.setClipToPadding(false);
        LinearLayout.LayoutParams ll = new LinearLayout.LayoutParams(-1, -2);
        ll.topMargin = px(30);
        col.addView(list, ll);

        TextView foot = text(21, MUTED, "sans-serif-light");
        foot.setText("OK abre a aula  ·  ◀ ▶ OK passam os slides  ·  ☰ menu da aula  ·  Voltar sai");
        foot.setPadding(0, px(40), 0, 0);
        col.addView(foot);

        scroll.addView(col, new FrameLayout.LayoutParams(-1, -2));
        scroll.setBackgroundColor(Color.TRANSPARENT);
        root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        Object[] saved = SlidesCatalog.load(this);
        if (saved != null) {
            @SuppressWarnings("unchecked") List<SlidesCatalog.Aula> l = (List<SlidesCatalog.Aula>) saved[0];
            render(l);
            status.setText("Lista guardada de " + when((Long) saved[1]) + " · atualizando…");
        }
        refresh();
    }

    @Override
    protected void onPause() {
        thumbs.pause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        thumbs.destroy();
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        thumbs.resume();
        lastOpened = getSharedPreferences("aulas", MODE_PRIVATE).getString("ultima", lastOpened);
    }

    private void refresh() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    final List<SlidesCatalog.Aula> l = SlidesCatalog.fetch();
                    SlidesCatalog.save(CatalogActivity.this, l);
                    ui.post(new Runnable() {
                        @Override public void run() {
                            if (!sameAs(l)) render(l);
                            status.setTextColor(MUTED);
                            status.setText(l.size() + " aulas · atualizado agora · diegocordeiro.github.io/slides");
                        }
                    });
                } catch (final Exception e) {
                    ui.post(new Runnable() {
                        @Override public void run() {
                            status.setTextColor(AMBER);
                            status.setText(shown.isEmpty()
                                    ? "Não foi possível carregar a lista (" + e.getMessage() + "). Confira a internet da TV."
                                    : "Sem conexão com o site agora: mostrando a lista guardada.");
                        }
                    });
                }
            }
        }, "catalogo").start();
    }

    private boolean sameAs(List<SlidesCatalog.Aula> l) {
        if (l.size() != shown.size()) return false;
        for (int i = 0; i < l.size(); i++) {
            SlidesCatalog.Aula a = l.get(i), b = shown.get(i);
            if (!a.url.equals(b.url) || !a.titulo.equals(b.titulo) || a.slides != b.slides
                    || !TextUtils.equals(a.secao, b.secao)) return false;
        }
        return true;
    }

    private void render(List<SlidesCatalog.Aula> l) {
        shown = l;
        list.removeAllViews();
        thumbViews.clear();
        Map<String, List<SlidesCatalog.Aula>> bySection = new LinkedHashMap<>();
        for (SlidesCatalog.Aula a : l) {
            List<SlidesCatalog.Aula> g = bySection.get(a.secao);
            if (g == null) { g = new ArrayList<>(); bySection.put(a.secao, g); }
            g.add(a);
        }
        View first = null, focusTarget = null;
        for (Map.Entry<String, List<SlidesCatalog.Aula>> e : bySection.entrySet()) {
            TextView h = text(22, MUTED, "sans-serif-medium");
            h.setText(e.getKey().toUpperCase(new Locale("pt", "BR")));
            h.setLetterSpacing(0.16f);
            h.setPadding(0, px(34), 0, px(16));
            list.addView(h);

            HorizontalScrollView hs = new HorizontalScrollView(this);
            hs.setHorizontalScrollBarEnabled(false);
            hs.setClipChildren(false);
            hs.setClipToPadding(false);
            hs.setPadding(0, px(14), px(110), px(14));
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setClipChildren(false);
            for (SlidesCatalog.Aula a : e.getValue()) {
                View card = card(a);
                LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(px(420), -2);
                cl.rightMargin = px(30);
                row.addView(card, cl);
                if (first == null) first = card;
                if (a.url.equals(lastOpened)) focusTarget = card;
            }
            hs.addView(row);
            list.addView(hs);
        }
        final View f = focusTarget != null ? focusTarget : first;
        if (f != null) f.post(new Runnable() { @Override public void run() { f.requestFocus(); } });
        thumbs.submit(l);
    }

    private void showThumb(ImageView iv, Bitmap bmp) {
        iv.setImageBitmap(bmp);
        iv.setAlpha(0f);
        ((Runnable) iv.getTag()).run();
        iv.animate().alpha(1f).setDuration(350).start();
        iv.postDelayed(new Runnable() { @Override public void run() { iv.setAlpha(1f); } }, 400);
    }

    private View card(final SlidesCatalog.Aula a) {
        final FrameLayout frame = new FrameLayout(this);
        frame.setFocusable(true);
        frame.setClickable(true);
        final GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(px(26));
        bg.setColor(0x1AFFFFFF);
        frame.setBackground(bg);
        frame.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) {
                o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), px(26));
            }
        });
        frame.setClipToOutline(true);

        final ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setVisibility(View.GONE);
        frame.addView(img, new FrameLayout.LayoutParams(-1, -1));
        thumbViews.put(a.url, img);

        final View ring = new View(this);
        final GradientDrawable ringBg = new GradientDrawable();
        ringBg.setCornerRadius(px(26));
        ringBg.setStroke(2, 0x26FFFFFF);
        ring.setBackground(ringBg);

        final LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(px(30), px(26), px(30), px(26));
        frame.addView(c, new FrameLayout.LayoutParams(-1, -1));
        frame.addView(ring, new FrameLayout.LayoutParams(-1, -1));

        TextView chip = text(19, BLUE, "sans-serif-medium");
        chip.setText(a.slides > 0 ? a.slides + " slides" : "aula");
        GradientDrawable pill = new GradientDrawable();
        pill.setCornerRadius(px(14));
        pill.setColor(0x8C0A0A1E);
        chip.setBackground(pill);
        chip.setPadding(px(12), px(6), px(12), px(6));
        c.addView(chip, new LinearLayout.LayoutParams(-2, -2));
        final TextView t = text(31, INK, "sans-serif-medium");
        t.setText(a.titulo);
        t.setMaxLines(3);
        t.setEllipsize(TextUtils.TruncateAt.END);
        t.setLineSpacing(px(4), 1f);
        t.setPadding(0, px(14), 0, px(6));
        t.setGravity(Gravity.BOTTOM | Gravity.START);
        t.setShadowLayer(px(8), 0, px(2), 0x99000000);
        c.addView(t, new LinearLayout.LayoutParams(-1, 0, 1f));
        final TextView s = text(21, SOFT, "sans-serif-light");
        s.setText(a.curso == null || a.curso.isEmpty() ? a.secao : a.curso);
        s.setSingleLine(true);
        s.setEllipsize(TextUtils.TruncateAt.END);
        c.addView(s);

        // Com miniatura, o texto sai de cima da imagem e vai para uma legenda embaixo do cartão.
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setClipChildren(false);
        box.setClipToPadding(false);
        box.addView(frame, new LinearLayout.LayoutParams(-1, px(236)));
        final TextView capT = text(25, SOFT, "sans-serif-medium");
        capT.setText(a.titulo);
        capT.setMaxLines(2);
        capT.setEllipsize(TextUtils.TruncateAt.END);
        capT.setLineSpacing(px(3), 1f);
        final TextView capS = text(19, MUTED, "sans-serif-light");
        String sub = a.curso == null || a.curso.isEmpty() ? a.secao : a.curso;
        capS.setText(a.slides > 0 ? a.slides + " slides  ·  " + sub : sub);
        capS.setSingleLine(true);
        capS.setEllipsize(TextUtils.TruncateAt.END);
        final LinearLayout cap = new LinearLayout(this);
        cap.setOrientation(LinearLayout.VERTICAL);
        cap.setPadding(px(6), px(22), px(6), 0);
        cap.addView(capT);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(-1, -2);
        sl.topMargin = px(6);
        cap.addView(capS, sl);
        cap.setVisibility(View.GONE);
        box.addView(cap, new LinearLayout.LayoutParams(-1, -2));

        img.setTag(new Runnable() {
            @Override public void run() {
                img.setVisibility(View.VISIBLE);
                c.setVisibility(View.INVISIBLE);
                cap.setVisibility(View.VISIBLE);
                frame.getOnFocusChangeListener().onFocusChange(frame, frame.hasFocus());
            }
        });
        Bitmap saved = ThumbMaker.cached(this, a);
        if (saved != null) img.setImageBitmap(saved);

        frame.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                boolean pic = img.getVisibility() == View.VISIBLE;
                // Com miniatura: o foco vira um contorno branco grosso; sem: o cartão fica branco.
                bg.setColor(f && !pic ? 0xF2FFFFFF : 0x1AFFFFFF);
                ringBg.setStroke(f && pic ? px(6) : 2, f && pic ? Color.WHITE : 0x26FFFFFF);
                t.setTextColor(f && !pic ? 0xFF14123A : INK);
                s.setTextColor(f && !pic ? 0xB314123A : SOFT);
                v.setScaleX(f ? 1.06f : 1f);
                v.setScaleY(f ? 1.06f : 1f);
                v.setElevation(f ? px(24) : 0);
                capT.setTextColor(f ? INK : SOFT);
                capS.setTextColor(f ? SOFT : MUTED);
            }
        });
        if (saved != null) ((Runnable) img.getTag()).run();
        frame.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                getSharedPreferences("aulas", MODE_PRIVATE).edit().putString("ultima", a.url).apply();
                Intent i = new Intent(CatalogActivity.this, DeckActivity.class);
                i.putExtra(DeckActivity.EXTRA_URL, a.fullUrl());
                i.putExtra(DeckActivity.EXTRA_TITLE, a.titulo);
                i.putExtra(DeckActivity.EXTRA_KEY, a.url);
                startActivity(i);
            }
        });
        return box;
    }

    private String when(long t) {
        if (t <= 0) return "antes";
        return new SimpleDateFormat("dd/MM 'às' HH:mm", new Locale("pt", "BR")).format(new Date(t));
    }

    private int px(float v) { return Math.round(v * u); }

    private TextView text(float size, int color, String family) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(size));
        t.setTextColor(color);
        t.setTypeface(Typeface.create(family, Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        t.setGravity(Gravity.START);
        return t;
    }
}
