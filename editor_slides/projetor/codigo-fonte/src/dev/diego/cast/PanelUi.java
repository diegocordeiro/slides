package dev.diego.cast;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Tela de informações do Diego Cast: painel em cartões de vidro sobre o degradê da marca. */
final class PanelUi {

    static final int WAITING = 0, CONNECTING = 1, LIVE = 2, REFUSED = 3, WARN = 4;

    private static final int INK = Color.WHITE, SOFT = 0xB3FFFFFF, MUTED = 0x80FFFFFF;
    private static final int GREEN = 0xFF34D399, AMBER = 0xFFFBBF24, RED = 0xFFF87171, BLUE = 0xFF7CC4FF;
    private static final int GLASS = 0x1AFFFFFF, GLASS_LINE = 0x26FFFFFF;

    private final Activity act;
    private final float u;

    final FrameLayout root;
    final TextView pairButton;
    final TextView slidesButton;
    final TextView secureToggle;

    private TextView stateTitle, stateDetail, deviceName;
    private View stateDot;
    private ObjectAnimator pulse;

    private TextView ipText, ssidText, bandChip, speedChip;
    private SignalBars bars;

    private LinearLayout streamGrid, streamIdle;
    private TextView codecChip, fpsVal, mbpsVal, lateVal, slackVal, framesVal, fromVal, errorText;

    private FrameLayout pairOverlay;
    private LinearLayout codeRow;
    private TextView pairNotice;
    private View pairProgress;
    private final android.os.Handler clock = new android.os.Handler(android.os.Looper.getMainLooper());
    private long pairDeadline, pairDuration;
    private final Runnable pairTick = new Runnable() {
        @Override public void run() {
            long left = pairDeadline - android.os.SystemClock.uptimeMillis();
            if (left <= 0) { hidePairCode(); return; }
            pairProgress.setScaleX(left / (float) pairDuration);
            clock.postDelayed(this, 250);
        }
    };

    PanelUi(Activity a, float scale) {
        act = a;
        u = scale;

        root = new FrameLayout(a);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF231A5E, 0xFF101A44, 0xFF06243F});
        root.setBackground(bg);
        root.addView(glow(0x66A855F7, px(900)), glowLp(px(900), -px(260), -px(320), Gravity.TOP | Gravity.START));
        root.addView(glow(0x5522D3EE, px(1000)), glowLp(px(1000), -px(300), -px(380), Gravity.BOTTOM | Gravity.END));

        root.setClipChildren(false);
        LinearLayout main = new LinearLayout(a);
        main.setOrientation(LinearLayout.HORIZONTAL);
        main.setClipChildren(false);
        main.setClipToPadding(false);
        main.setPadding(px(110), px(40), px(110), px(128));

        // ---------------- coluna esquerda
        LinearLayout left = new LinearLayout(a);
        left.setOrientation(LinearLayout.VERTICAL);
        left.setClipChildren(false);
        left.setClipToPadding(false);

        ImageView logo = new ImageView(a);
        logo.setImageResource(R.drawable.banner);
        logo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        logo.setBackground(round(0, px(26)));
        logo.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
        logo.setClipToOutline(true);
        logo.setElevation(px(24));
        left.addView(logo, new LinearLayout.LayoutParams(px(260), px(146)));

        deviceName = text(26, MUTED, "sans-serif");
        deviceName.setPadding(px(4), px(18), 0, px(26));
        left.addView(deviceName);

        LinearLayout stateRow = new LinearLayout(a);
        stateRow.setOrientation(LinearLayout.HORIZONTAL);
        stateRow.setGravity(Gravity.CENTER_VERTICAL);
        stateDot = new View(a);
        stateDot.setBackground(oval(BLUE));
        LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(px(22), px(22));
        dl.rightMargin = px(22);
        stateRow.addView(stateDot, dl);
        stateTitle = text(58, INK, "sans-serif-medium");
        stateRow.addView(stateTitle);
        left.addView(stateRow);
        stateDetail = text(28, SOFT, "sans-serif-light");
        stateDetail.setPadding(px(44), px(8), 0, px(28));
        left.addView(stateDetail);

        LinearLayout steps = card();
        steps.addView(label("COMO USAR"));
        steps.addView(step("1", "Apresentações", "Abra uma aula do seu site direto aqui, sem o Mac"));
        steps.addView(step("2", "Projetar do Mac", "Pareie uma vez e use Diego Cast → Espelhar tela no Mac"));
        left.addView(steps, new LinearLayout.LayoutParams(-1, -2));

        pairButton = text(30, INK, "sans-serif-medium");
        pairButton.setText("Parear um Mac");
        pairButton.setGravity(Gravity.CENTER);
        pairButton.setPadding(px(54), px(22), px(54), px(22));
        pairButton.setFocusable(true);
        pairButton.setClickable(true);
        final GradientDrawable pb = round(0x33FFFFFF, px(44));
        pairButton.setBackground(pb);
        pairButton.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                pb.setColor(f ? Color.WHITE : 0x33FFFFFF);
                pairButton.setTextColor(f ? 0xFF14123A : INK);
                v.animate().scaleX(f ? 1.06f : 1f).scaleY(f ? 1.06f : 1f).setDuration(160).start();
            }
        });
        pairButton.setPivotX(0);                    // cresce para a direita, sem sair da tela

        slidesButton = text(30, INK, "sans-serif-medium");
        slidesButton.setText("Apresentações");
        slidesButton.setGravity(Gravity.CENTER);
        slidesButton.setPadding(px(54), px(22), px(54), px(22));
        slidesButton.setFocusable(true);
        slidesButton.setClickable(true);
        slidesButton.setPivotX(0);
        final GradientDrawable sbg = round(0x4D7CC4FF, px(44));
        slidesButton.setBackground(sbg);
        slidesButton.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                sbg.setColor(f ? Color.WHITE : 0x4D7CC4FF);
                slidesButton.setTextColor(f ? 0xFF14123A : INK);
                v.animate().scaleX(f ? 1.06f : 1f).scaleY(f ? 1.06f : 1f).setDuration(160).start();
            }
        });

        LinearLayout btnRow = new LinearLayout(a);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER_VERTICAL);
        btnRow.setClipChildren(false);
        btnRow.addView(slidesButton);
        LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(-2, -2);
        pl.leftMargin = px(36);
        btnRow.addView(pairButton, pl);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-1, -2);
        bl.topMargin = px(34);
        left.addView(btnRow, bl);

        // Proteção contra capturas de tela/gravação da TV (FLAG_SECURE)
        secureToggle = text(22, SOFT, "sans-serif-medium");
        secureToggle.setPadding(px(26), px(12), px(26), px(12));
        secureToggle.setFocusable(true);
        secureToggle.setClickable(true);
        final GradientDrawable sb = round(0x14FFFFFF, px(30), 0x33FFFFFF);
        secureToggle.setBackground(sb);
        secureToggle.setPivotX(0);
        secureToggle.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                sb.setColor(f ? Color.WHITE : 0x14FFFFFF);
                secureToggle.setTextColor(f ? 0xFF14123A : SOFT);
                v.animate().scaleX(f ? 1.05f : 1f).scaleY(f ? 1.05f : 1f).setDuration(160).start();
            }
        });
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(-2, -2);
        tl.topMargin = px(26);
        left.addView(secureToggle, tl);

        main.addView(left, new LinearLayout.LayoutParams(0, -2, 1.05f));
        View gap = new View(a);
        main.addView(gap, new LinearLayout.LayoutParams(px(70), 1));

        // ---------------- coluna direita
        LinearLayout right = new LinearLayout(a);
        right.setOrientation(LinearLayout.VERTICAL);

        LinearLayout net = card();
        LinearLayout netHead = new LinearLayout(a);
        netHead.setOrientation(LinearLayout.HORIZONTAL);
        netHead.setGravity(Gravity.CENTER_VERTICAL);
        netHead.addView(label("REDE"), new LinearLayout.LayoutParams(0, -2, 1f));
        bars = new SignalBars(a);
        netHead.addView(bars, new LinearLayout.LayoutParams(px(44), px(30)));
        net.addView(netHead);
        ipText = text(64, INK, "sans-serif-medium");
        ipText.setPadding(0, px(6), 0, px(2));
        net.addView(ipText);
        ssidText = text(26, SOFT, "sans-serif-light");
        net.addView(ssidText);
        LinearLayout chips = new LinearLayout(a);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.setPadding(0, px(20), 0, 0);
        bandChip = chip("", BLUE);
        speedChip = chip("", 0xFFFFFFFF);
        chips.addView(bandChip);
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(-2, -2);
        cl.leftMargin = px(14);
        chips.addView(speedChip, cl);
        net.addView(chips);
        right.addView(net, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout stream = card();
        LinearLayout sHead = new LinearLayout(a);
        sHead.setOrientation(LinearLayout.HORIZONTAL);
        sHead.setGravity(Gravity.CENTER_VERTICAL);
        sHead.addView(label("TRANSMISSÃO"), new LinearLayout.LayoutParams(0, -2, 1f));
        codecChip = chip("Cifrado", GREEN);
        sHead.addView(codecChip);
        stream.addView(sHead);

        streamIdle = new LinearLayout(a);
        streamIdle.setOrientation(LinearLayout.VERTICAL);
        TextView idleBig = text(34, INK, "sans-serif-light");
        idleBig.setText("Nenhum Mac projetando agora");
        idleBig.setPadding(0, px(26), 0, px(8));
        TextView idleSmall = text(23, MUTED, "sans-serif-light");
        idleSmall.setText("Os números aparecem aqui durante a projeção (☰ abre esta tela).");
        streamIdle.addView(idleBig);
        streamIdle.addView(idleSmall);
        stream.addView(streamIdle);

        streamGrid = new LinearLayout(a);
        streamGrid.setOrientation(LinearLayout.VERTICAL);
        streamGrid.setPadding(0, px(18), 0, 0);
        LinearLayout r1 = row(), r2 = row();
        fpsVal = metric(r1, "QUADROS/S");
        mbpsVal = metric(r1, "MBIT/S");
        lateVal = metric(r1, "ATRASADOS");
        slackVal = metric(r2, "FOLGA");
        framesVal = metric(r2, "EXIBIDOS");
        fromVal = metric(r2, "MAC");
        fromVal.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(30));     // IP é longo: fonte menor
        fromVal.setPadding(0, px(14), 0, 0);
        streamGrid.addView(r1);
        LinearLayout.LayoutParams r2l = new LinearLayout.LayoutParams(-1, -2);
        r2l.topMargin = px(22);
        streamGrid.addView(r2, r2l);
        errorText = text(21, RED, "sans-serif");
        errorText.setPadding(0, px(16), 0, 0);
        streamGrid.addView(errorText);
        stream.addView(streamGrid);
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(-1, -2);
        sl.topMargin = px(30);
        right.addView(stream, sl);

        main.addView(right, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(main, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER_VERTICAL));

        // ---------------- rodapé: teclas do controle
        LinearLayout foot = new LinearLayout(a);
        foot.setOrientation(LinearLayout.HORIZONTAL);
        foot.setGravity(Gravity.CENTER_VERTICAL);
        keycap(foot, "◀ ▶", "passam os slides");
        keycap(foot, "OK", "próximo slide");
        keycap(foot, "☰", "esta tela");
        keycap(foot, "Voltar", "sai do app");
        FrameLayout.LayoutParams fl = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        fl.bottomMargin = px(56);
        root.addView(foot, fl);

        buildPairOverlay();
        setState(WAITING, "Pronto para projetar", "Aguardando o Mac");
        setIdle();
    }

    // ------------------------------------------------------------------ atualizações

    void setDeviceName(String n) { deviceName.setText(n); }

    void setSecureState(boolean on) {
        secureToggle.setText(on ? "Bloquear capturas da tela: ligado  ·  OK para desligar"
                                : "Bloquear capturas da tela: desligado  ·  OK para ligar");
    }

    void setState(int state, String title, String detail) {
        int c = state == LIVE ? GREEN : state == CONNECTING || state == WARN ? AMBER : state == REFUSED ? RED : BLUE;
        ((GradientDrawable) stateDot.getBackground()).setColor(c);
        stateTitle.setText(title);
        stateDetail.setText(detail == null ? "" : detail);
        if (pulse == null) {
            pulse = ObjectAnimator.ofFloat(stateDot, "alpha", 1f, 0.25f);
            pulse.setDuration(900);
            pulse.setRepeatCount(ValueAnimator.INFINITE);
            pulse.setRepeatMode(ValueAnimator.REVERSE);
        }
        if (state == WAITING || state == CONNECTING) { if (!pulse.isStarted()) pulse.start(); }
        else { pulse.cancel(); stateDot.setAlpha(1f); }
    }

    void setNetwork(String ip, String ssid, int freqMhz, int linkMbps, int rssi) {
        ipText.setText(ip == null ? "Sem rede" : ip);
        ssidText.setText(ssid == null ? "Wi‑Fi desconectado" : "Wi‑Fi " + ssid);
        if (freqMhz > 0) {
            boolean five = freqMhz > 4900;
            bandChip.setVisibility(View.VISIBLE);
            bandChip.setText(five ? "5 GHz" : "2,4 GHz · prefira 5 GHz");
            tint(bandChip, five ? GREEN : AMBER);
        } else bandChip.setVisibility(View.GONE);
        if (linkMbps > 0) { speedChip.setVisibility(View.VISIBLE); speedChip.setText(linkMbps + " Mbit/s"); }
        else speedChip.setVisibility(View.GONE);
        bars.setLevel(rssi == 0 ? 0 : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1);
    }

    void setIdle() {
        streamIdle.setVisibility(View.VISIBLE);
        streamGrid.setVisibility(View.GONE);
        codecChip.setText("Cifrado");
    }

    void setStats(String codec, int fps, double mbps, int late, double latePct, int slackMs, int shown,
                  String from, String error) {
        streamIdle.setVisibility(View.GONE);
        streamGrid.setVisibility(View.VISIBLE);
        codecChip.setText(codec + " · cifrado");
        fpsVal.setText(String.valueOf(fps));
        mbpsVal.setText(String.format("%.1f", mbps));
        lateVal.setText(String.format("%.1f%%", latePct));
        lateVal.setTextColor(latePct < 1 ? GREEN : latePct < 5 ? AMBER : RED);
        slackVal.setText(slackMs + " ms");
        framesVal.setText(shown >= 10000 ? (shown / 1000) + " mil" : String.valueOf(shown));
        fromVal.setText(from == null ? "—" : from);
        errorText.setText(error == null ? "" : "Aviso: " + error);
        errorText.setVisibility(error == null ? View.GONE : View.VISIBLE);
    }

    // ------------------------------------------------------------------ código de pareamento

    boolean pairShowing() { return pairOverlay.getVisibility() == View.VISIBLE; }

    void showPairCode(String code, boolean regenerated, long durationMs, final Runnable onTimeout) {
        codeRow.removeAllViews();
        for (int i = 0; i < code.length(); i += 4) {
            TextView box = text(64, INK, "monospace");
            box.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
            box.setText(code.substring(i, Math.min(code.length(), i + 4)));
            box.setGravity(Gravity.CENTER);
            box.setPadding(px(26), px(16), px(26), px(16));
            box.setBackground(round(0x1FFFFFFF, px(18), 0x40FFFFFF));
            LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(-2, -2);
            if (i > 0) l.leftMargin = px(18);
            codeRow.addView(box, l);
        }
        pairNotice.setVisibility(regenerated ? View.VISIBLE : View.GONE);
        pairOverlay.animate().cancel();
        pairOverlay.setAlpha(1f);                   // sem depender de animação (o sistema pode tê-las desligadas)
        pairOverlay.setVisibility(View.VISIBLE);
        pairProgress.setPivotX(0);
        pairProgress.setScaleX(1f);
        pairDuration = durationMs;
        pairDeadline = android.os.SystemClock.uptimeMillis() + durationMs;
        clock.removeCallbacks(pairTick);
        clock.postDelayed(pairTick, 250);
    }

    void hidePairCode() {
        clock.removeCallbacks(pairTick);
        pairOverlay.animate().cancel();
        pairOverlay.setVisibility(View.GONE);
    }

    private void buildPairOverlay() {
        pairOverlay = new FrameLayout(act);
        pairOverlay.setBackgroundColor(0xCC05060F);
        pairOverlay.setVisibility(View.GONE);

        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(px(80), px(64), px(80), px(56));
        box.setBackground(round(0xF01A1846, px(40), 0x33FFFFFF));
        box.setElevation(px(40));

        TextView kicker = text(22, BLUE, "sans-serif-medium");
        kicker.setText("PAREAMENTO SEGURO");
        kicker.setLetterSpacing(0.22f);
        box.addView(kicker);
        TextView title = text(52, INK, "sans-serif-medium");
        title.setText("Parear um Mac");
        title.setPadding(0, px(14), 0, px(10));
        box.addView(title);
        TextView sub = text(26, SOFT, "sans-serif-light");
        sub.setGravity(Gravity.CENTER);
        sub.setText("No Mac: Diego Cast → Segurança → Parear com a TV…\ne digite o código abaixo (os traços são opcionais).");
        box.addView(sub);

        codeRow = new LinearLayout(act);
        codeRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams crl = new LinearLayout.LayoutParams(-2, -2);
        crl.topMargin = px(44);
        crl.bottomMargin = px(40);
        box.addView(codeRow, crl);

        FrameLayout track = new FrameLayout(act);
        track.setBackground(round(0x1FFFFFFF, px(4)));
        pairProgress = new View(act);
        pairProgress.setBackground(round(BLUE, px(4)));
        track.addView(pairProgress, new FrameLayout.LayoutParams(-1, -1));
        box.addView(track, new LinearLayout.LayoutParams(px(820), px(8)));

        TextView foot = text(21, MUTED, "sans-serif-light");
        foot.setText("Some sozinho em 3 minutos · Voltar fecha · Segure OK em Parear um Mac para gerar outro código");
        foot.setPadding(0, px(18), 0, 0);
        box.addView(foot);

        pairNotice = text(23, AMBER, "sans-serif-medium");
        pairNotice.setText("Código novo gerado: os Macs pareados antes foram desconectados.");
        pairNotice.setPadding(0, px(22), 0, 0);
        box.addView(pairNotice);

        pairOverlay.addView(box, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        root.addView(pairOverlay, new FrameLayout.LayoutParams(-1, -1));
    }

    // ------------------------------------------------------------------ peças

    private int px(float v) { return Math.round(v * u); }

    private TextView text(float size, int color, String family) {
        TextView t = new TextView(act);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(size));
        t.setTextColor(color);
        t.setTypeface(Typeface.create(family, Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        return t;
    }

    private TextView label(String s) {
        TextView t = text(20, MUTED, "sans-serif-medium");
        t.setText(s);
        t.setLetterSpacing(0.2f);
        return t;
    }

    private static GradientDrawable round(int color, float radius) { return round(color, radius, 0); }

    private static GradientDrawable round(int color, float radius, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radius);
        if (stroke != 0) g.setStroke(2, stroke);
        return g;
    }

    private static GradientDrawable oval(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        return g;
    }

    private View glow(int color, int size) {
        View v = new View(act);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        g.setGradientRadius(size / 2f);
        g.setColors(new int[]{color, 0x00000000});
        v.setBackground(g);
        return v;
    }

    private FrameLayout.LayoutParams glowLp(int size, int mx, int my, int gravity) {
        FrameLayout.LayoutParams l = new FrameLayout.LayoutParams(size, size, gravity);
        if ((gravity & Gravity.START) == Gravity.START) l.leftMargin = mx; else l.rightMargin = mx;
        if ((gravity & Gravity.TOP) == Gravity.TOP) l.topMargin = my; else l.bottomMargin = my;
        return l;
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(px(40), px(32), px(40), px(36));
        c.setBackground(round(GLASS, px(32), GLASS_LINE));
        return c;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(act);
        r.setOrientation(LinearLayout.HORIZONTAL);
        return r;
    }

    private TextView metric(LinearLayout row, String name) {
        LinearLayout m = new LinearLayout(act);
        m.setOrientation(LinearLayout.VERTICAL);
        TextView v = text(48, INK, "sans-serif-medium");
        v.setText("—");
        v.setSingleLine(true);
        v.setEllipsize(TextUtils.TruncateAt.END);
        TextView n = text(18, MUTED, "sans-serif-medium");
        n.setText(name);
        n.setLetterSpacing(0.16f);
        n.setPadding(0, px(8), 0, 0);
        m.addView(v);
        m.addView(n);
        row.addView(m, new LinearLayout.LayoutParams(0, -2, 1f));
        return v;
    }

    private View step(String num, String title, String body) {
        LinearLayout r = new LinearLayout(act);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, px(22), 0, 0);
        TextView n = text(24, INK, "sans-serif-medium");
        n.setText(num);
        n.setGravity(Gravity.CENTER);
        n.setBackground(oval(0x33FFFFFF));
        r.addView(n, new LinearLayout.LayoutParams(px(46), px(46)));
        LinearLayout col = new LinearLayout(act);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(px(22), px(2), 0, 0);
        TextView t = text(28, INK, "sans-serif-medium");
        t.setText(title);
        TextView b = text(23, SOFT, "sans-serif-light");
        b.setText(body);
        b.setPadding(0, px(8), 0, 0);
        col.addView(t);
        col.addView(b);
        r.addView(col);
        return r;
    }

    private TextView chip(String s, int color) {
        TextView c = text(21, color, "sans-serif-medium");
        c.setText(s);
        c.setPadding(px(18), px(9), px(18), px(9));
        c.setBackground(round((color & 0x00FFFFFF) | 0x26000000, px(20)));
        return c;
    }

    private void tint(TextView chip, int color) {
        chip.setTextColor(color);
        ((GradientDrawable) chip.getBackground()).setColor((color & 0x00FFFFFF) | 0x26000000);
    }

    private void keycap(LinearLayout parent, String key, String what) {
        LinearLayout g = new LinearLayout(act);
        g.setOrientation(LinearLayout.HORIZONTAL);
        g.setGravity(Gravity.CENTER_VERTICAL);
        TextView k = text(22, INK, "sans-serif-medium");
        k.setText(key);
        k.setPadding(px(16), px(8), px(16), px(8));
        k.setBackground(round(0x1AFFFFFF, px(12), 0x40FFFFFF));
        TextView w = text(22, MUTED, "sans-serif-light");
        w.setText(what);
        w.setPadding(px(12), 0, 0, 0);
        g.addView(k);
        g.addView(w);
        LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(-2, -2);
        if (parent.getChildCount() > 0) l.leftMargin = px(44);
        parent.addView(g, l);
    }

    /** Quatro barrinhas de sinal do Wi‑Fi. */
    static final class SignalBars extends View {
        private int level = 0;
        private final Paint on = new Paint(Paint.ANTI_ALIAS_FLAG), off = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();

        SignalBars(Context c) {
            super(c);
            on.setColor(Color.WHITE);
            off.setColor(0x33FFFFFF);
        }

        void setLevel(int l) { level = l; invalidate(); }

        @Override protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), bw = w / 7f;
            for (int i = 0; i < 4; i++) {
                float bh = h * (0.35f + 0.65f * i / 3f);
                float x = i * bw * 2f;
                r.set(x, h - bh, x + bw * 1.3f, h);
                c.drawRoundRect(r, bw / 2, bw / 2, i < level ? on : off);
            }
        }
    }
}
