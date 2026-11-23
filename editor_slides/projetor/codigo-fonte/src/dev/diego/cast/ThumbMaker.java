package dev.diego.cast;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.List;

/**
 * Fotografa o primeiro slide de cada aula com um WebView escondido atrás do catálogo.
 * Uma aula por vez, em segundo plano; o resultado fica guardado e só é refeito quando a aula muda.
 */
class ThumbMaker {

    interface Listener { void onThumb(SlidesCatalog.Aula a, Bitmap bmp); }

    private static final String HIDE_CHROME =
            "(function(){var s=document.createElement('style');" +
            "s.textContent='header.tb,footer.ft,nav.ctr,.fita{display:none!important}';" +
            "document.head.appendChild(s);})()";
    private static final long SETTLE_MS = 1800, TIMEOUT_MS = 15000;

    private final Context ctx;
    private final WebView web;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ArrayDeque<SlidesCatalog.Aula> queue = new ArrayDeque<>();
    private SlidesCatalog.Aula current;
    private boolean paused, destroyed;
    private int token;

    @SuppressLint("SetJavaScriptEnabled")
    ThumbMaker(Context ctx, WebView web, Listener listener) {
        this.ctx = ctx;
        this.web = web;
        this.listener = listener;
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setTextZoom(100);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ws.setMediaPlaybackRequiresUserGesture(true);
        web.setFocusable(false);
        web.setFocusableInTouchMode(false);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return !SlidesCatalog.allowed(url);
            }
            @Override public void onPageFinished(WebView v, String url) {
                if (current == null || destroyed) return;
                v.evaluateJavascript(HIDE_CHROME, null);
                final int t = token;
                ui.postDelayed(new Runnable() { @Override public void run() { capture(t); } }, SETTLE_MS);
            }
        });
    }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "miniaturas");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    static File fileFor(Context c, SlidesCatalog.Aula a) {
        String id = a.url + "|" + (a.versao != null && !a.versao.isEmpty() ? a.versao : String.valueOf(a.slides));
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] h = md.digest(id.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(String.format("%02x", h[i]));
            return new File(dir(c), sb + ".jpg");
        } catch (Exception e) {
            return new File(dir(c), Integer.toHexString(id.hashCode()) + ".jpg");
        }
    }

    static Bitmap cached(Context c, SlidesCatalog.Aula a) {
        File f = fileFor(c, a);
        return f.isFile() ? BitmapFactory.decodeFile(f.getPath()) : null;
    }

    /** Põe na fila as aulas que ainda não têm miniatura e apaga as que não servem mais. */
    void submit(List<SlidesCatalog.Aula> aulas) {
        queue.clear();
        java.util.HashSet<String> keep = new java.util.HashSet<>();
        for (SlidesCatalog.Aula a : aulas) {
            File f = fileFor(ctx, a);
            keep.add(f.getName());
            if (!f.isFile()) queue.add(a);
        }
        File[] old = dir(ctx).listFiles();
        if (old != null) for (File f : old) if (!keep.contains(f.getName())) f.delete();
        if (current == null) next();
    }

    void pause() { paused = true; web.onPause(); }

    void resume() {
        paused = false;
        web.onResume();
        if (current == null) next();
    }

    void destroy() {
        destroyed = true;
        ui.removeCallbacksAndMessages(null);
        queue.clear();
        try { web.stopLoading(); web.destroy(); } catch (Throwable ignored) { }
    }

    private void next() {
        if (paused || destroyed) return;
        current = queue.poll();
        if (current == null) { web.loadUrl("about:blank"); return; }
        final int t = ++token;
        web.loadUrl(current.fullUrl() + "#apresentacao");
        ui.postDelayed(new Runnable() {
            @Override public void run() { if (t == token && current != null) { current = null; next(); } }
        }, TIMEOUT_MS);
    }

    private void capture(int t) {
        if (t != token || current == null || destroyed) return;
        final SlidesCatalog.Aula a = current;
        current = null;
        token++;
        if (paused) { queue.addFirst(a); return; }
        try {
            int w = web.getWidth(), h = web.getHeight();
            if (w > 0 && h > 0) {
                float scale = 480f / w;
                Bitmap bmp = Bitmap.createBitmap(480, Math.round(h * scale), Bitmap.Config.RGB_565);
                Canvas c = new Canvas(bmp);
                c.scale(scale, scale);
                web.draw(c);
                if (!looksBlank(bmp)) {
                    FileOutputStream out = new FileOutputStream(fileFor(ctx, a));
                    bmp.compress(Bitmap.CompressFormat.JPEG, 84, out);
                    out.close();
                    listener.onThumb(a, bmp);
                }
            }
        } catch (Throwable ignored) { }
        next();
    }

    /** Uma captura toda de uma cor só (página ainda em branco) não é guardada. */
    private static boolean looksBlank(Bitmap b) {
        int first = b.getPixel(b.getWidth() / 7, b.getHeight() / 7);
        for (int y = 1; y < 8; y++)
            for (int x = 1; x < 8; x++)
                if (b.getPixel(b.getWidth() * x / 8, b.getHeight() * y / 8) != first) return false;
        return true;
    }
}
