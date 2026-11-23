package dev.diego.cast;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Receptor de projeção: recebe a tela do Mac (H.264 via TCP) e devolve os comandos do controle. */
public class CastActivity extends Activity implements SurfaceHolder.Callback {

    static final String TAG = "DiegoCast";
    static final int VIDEO_PORT = 7000, DISCOVERY_PORT = 7001, CONTROL_PORT = 7002;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private float u;

    private SurfaceView surfaceView;
    private volatile android.view.Surface surface;
    private FrameLayout panel;
    private PanelUi dash;

    private volatile boolean running = false;
    private volatile boolean streaming = false;
    private ServerSocket videoServer, controlServer;
    private volatile Socket videoClient;
    /** Canais de controle autenticados (um por Mac conectado). */
    private static final class Ctrl { final Socket sock; final SecureChannel ch; Ctrl(Socket s, SecureChannel c) { sock = s; ch = c; } }
    private final List<Ctrl> controls = new CopyOnWriteArrayList<>();
    private final java.security.SecureRandom rnd = new java.security.SecureRandom();
    private android.content.SharedPreferences prefs;
    private volatile byte[] master;          // chave derivada do código de pareamento
    private String pairCode;

    private Thread videoThread, controlThread, discoveryThread;

    private volatile long bytesIn;
    private volatile VideoDecoder curDec;
    private volatile String curFrom;
    private volatile boolean curFS;          // sessão com chaves temporárias (sigilo futuro)
    private long lastShown = 0, lastBytes = 0;
    private final Runnable statsTick = new Runnable() {
        @Override public void run() {
            VideoDecoder d = curDec;
            if (d != null) {
                int shown = d.framesShown;
                long b = bytesIn;
                int fps = (int) Math.max(0, shown - lastShown);
                double mbps = Math.max(0, b - lastBytes) * 8 / 1_000_000.0;
                lastShown = shown;
                lastBytes = b;
                if (panel.getVisibility() == View.VISIBLE) {
                    dash.setStats(d.codecName() + (curFS ? " · ECDH" : ""), fps, mbps, d.framesLate,
                            shown > 0 ? 100.0 * d.framesLate / shown : 0, d.bufferMs, shown, curFrom, d.lastError);
                }
            } else {
                lastShown = 0;
                lastBytes = 0;
                dash.setIdle();
            }
            refreshInfo();
            ui.postDelayed(this, 1000);
        }
    };

    // ------------------------------------------------------------ ciclo de vida

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        u = getResources().getDisplayMetrics().widthPixels / 1920f;
        prefs = getSharedPreferences("seguranca", MODE_PRIVATE);
        // Bloqueia capturas de tela e gravações da TV (ADB screencap, outros apps): saem pretas.
        // Desligável na tela, porque projetores/divisores HDMI sem HDCP também ficariam pretos.
        if (secureOn()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        pairCode = prefs.getString("codigo", null);
        if (pairCode == null) newPairCode();
        else setMaster(pairCode);
        buildUi();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!running) {
            running = true;
            try { if (!wifi().isWifiEnabled()) wifi().setWifiEnabled(true); } catch (Throwable ignored) { }
            startServers();
        }
        refreshInfo();
        ui.post(statsTick);
    }

    @Override
    protected void onStop() {
        // Os servidores continuam no ar enquanto o catálogo ou uma aula estão abertos por cima,
        // para o Mac poder projetar ou mandar abrir outra aula. Só param quando o app é fechado.
        ui.removeCallbacks(statsTick);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        running = false;
        stopServers();
        super.onDestroy();
    }

    // ------------------------------------------------------------ interface

    private int px(float v) { return Math.round(v * u); }

    private TextView text(float size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px(size));
        t.setTextColor(color);
        t.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        t.setLineSpacing(px(6), 1f);
        return t;
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        surfaceView = new SurfaceView(this);
        surfaceView.setSecure(secureOn());          // a camada do vídeo também (precisa ser antes de anexar)
        surfaceView.getHolder().addCallback(this);
        root.addView(surfaceView, new FrameLayout.LayoutParams(-1, -1));

        dash = new PanelUi(this, u);
        dash.setDeviceName(deviceName());
        dash.slidesButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startActivity(new android.content.Intent(CastActivity.this, CatalogActivity.class)); }
        });
        dash.pairButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showPairCode(false); }
        });
        dash.pairButton.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { showPairCode(true); return true; }
        });
        dash.setSecureState(secureOn());
        dash.secureToggle.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.edit().putBoolean("bloquear_capturas", !secureOn()).apply();
                recreate();                         // a superfície do vídeo só muda ao recriar a tela
            }
        });
        panel = dash.root;
        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        dash.slidesButton.requestFocus();
    }

    // ------------------------------------------------------------ pareamento

    private boolean secureOn() { return prefs.getBoolean("bloquear_capturas", true); }

    private void setMaster(String code) {
        try { master = SecureChannel.masterKey(code); } catch (Exception e) { master = null; }
    }

    private void newPairCode() {
        pairCode = SecureChannel.newCode(rnd);
        prefs.edit().putString("codigo", pairCode).apply();
        setMaster(pairCode);
    }

    /** Mostra o código só quando pedido (alunos na sala não devem vê-lo o tempo todo). */
    private void showPairCode(boolean regenerate) {
        if (regenerate) {
            newPairCode();
            closeQuietly(videoClient);
            for (Ctrl c : controls) closeQuietly(c.sock);
            controls.clear();
        }
        dash.showPairCode(pairCode, regenerate, 180_000, null);
    }

    private String deviceName() {
        String n = null;
        try { n = Settings.Global.getString(getContentResolver(), "device_name"); } catch (Exception ignored) { }
        return n != null && !n.isEmpty() ? n : Build.MODEL;
    }

    private void refreshInfo() {
        List<String[]> ips = localIps();
        String ip = null;
        for (String[] i : ips) if (i[0].startsWith("wlan") || i[0].startsWith("eth")) { ip = i[1]; break; }
        if (ip == null && !ips.isEmpty()) ip = ips.get(0)[1];
        int freq = 0, speed = 0, rssi = 0;
        try {
            WifiInfo wi = wifi().getConnectionInfo();
            if (wi != null && wi.getNetworkId() != -1) { freq = wi.getFrequency(); speed = wi.getLinkSpeed(); rssi = wi.getRssi(); }
        } catch (Throwable ignored) { }
        dash.setNetwork(ip, currentSsid(), freq, speed, rssi);
    }

    private String currentSsid() {
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo wi = wm.getConnectionInfo();
            if (wi == null || wi.getNetworkId() == -1) return null;
            String s = wi.getSSID();
            if (s == null || s.contains("unknown")) return null;
            return s.replace("\"", "");
        } catch (Exception e) { return null; }
    }

    /** {interface, ip} de todas as interfaces IPv4 ativas (wlan0, ap0, eth0…). */
    static List<String[]> localIps() {
        List<String[]> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address) out.add(new String[]{ni.getName(), a.getHostAddress()});
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private void showPanel(final boolean show) {
        ui.post(new Runnable() {
            @Override public void run() {
                panel.animate().cancel();
                if (show) {
                    panel.setVisibility(View.VISIBLE);
                    panel.animate().alpha(1f).setDuration(200).start();
                    dash.slidesButton.requestFocus();
                } else {
                    panel.animate().alpha(0f).setDuration(250).withEndAction(new Runnable() {
                        @Override public void run() { panel.setVisibility(View.GONE); }
                    }).start();
                }
            }
        });
    }

    private void setState(final int state, final String title, final String detail) {
        ui.post(new Runnable() { @Override public void run() { dash.setState(state, title, detail); refreshInfo(); } });
    }

    // ------------------------------------------------------------ superfície

    @Override public void surfaceCreated(SurfaceHolder h) { surface = h.getSurface(); }
    @Override public void surfaceChanged(SurfaceHolder h, int f, int w, int hh) { surface = h.getSurface(); }
    @Override public void surfaceDestroyed(SurfaceHolder h) {
        surface = null;
        closeQuietly(videoClient);
    }

    // ------------------------------------------------------------ servidores

    private void startServers() {
        videoThread = new Thread(new Runnable() { @Override public void run() { videoLoop(); } }, "cast-video");
        controlThread = new Thread(new Runnable() { @Override public void run() { controlLoop(); } }, "cast-ctrl");
        discoveryThread = new Thread(new Runnable() { @Override public void run() { discoveryLoop(); } }, "cast-disc");
        videoThread.start();
        controlThread.start();
        discoveryThread.start();
    }

    private void stopServers() {
        closeQuietly(videoClient);
        closeQuietly(videoServer);
        closeQuietly(controlServer);
        for (Ctrl c : controls) closeQuietly(c.sock);
        controls.clear();
        if (discoveryThread != null) discoveryThread.interrupt();
    }

    private void videoLoop() {
        try {
            videoServer = new ServerSocket();
            videoServer.setReuseAddress(true);
            videoServer.bind(new java.net.InetSocketAddress(VIDEO_PORT));
            while (running) {
                final Socket s = videoServer.accept();
                new Thread(new Runnable() { @Override public void run() { handleVideo(s); } }, "cast-session").start();
            }
        } catch (Exception e) {
            if (running) Log.w(TAG, "servidor de vídeo", e);
        }
    }

    private void handleVideo(Socket s) {
        String who = s.getInetAddress().getHostAddress();
        VideoDecoder dec = null;
        SecureChannel ch;
        try {
            s.setTcpNoDelay(true);
            s.setReceiveBufferSize(512 * 1024);
            s.setSoTimeout(5000);
            ch = SecureChannel.serverHandshake(s.getInputStream(), s.getOutputStream(), master, (byte) 'V', rnd);
            s.setSoTimeout(0);
        } catch (Exception e) {
            Log.w(TAG, "aperto de mão recusado de " + who + ": " + e);
            closeQuietly(s);
            if (videoClient == null) setState(PanelUi.REFUSED, "Conexão recusada", who + " não está pareado com esta TV");
            try { Thread.sleep(1000); } catch (InterruptedException ignored) { }  // freia tentativas repetidas
            return;
        }
        closeQuietly(videoClient); // autenticado: assume o lugar da sessão anterior
        videoClient = s;
        try {
            if (surface == null) ui.post(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(CastActivity.this, CastActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    startActivity(i);
                }
            });
            for (int i = 0; i < 100 && surface == null; i++) Thread.sleep(50);
            if (surface == null) return;
            setState(PanelUi.CONNECTING, "Conectando…", "Mac em " + who);
            bytesIn = 0;
            curFrom = who;
            final boolean hevc = ch.purpose == 'h';
            curFS = ch.forwardSecret;
            dec = new VideoDecoder(surface, new VideoDecoder.Events() {
                @Override public void onFirstFrame() {
                    streaming = true;
                    setState(PanelUi.LIVE, "Projetando", "Mac em " + s.getInetAddress().getHostAddress());
                    showPanel(false);
                }
                @Override public void onNeedKeyFrame() { sendControl("KEY"); }
                @Override public void onCodecUnsupported() {
                    sendControl("NOHEVC");
                    setState(PanelUi.WARN, "Ajustando o vídeo", "Esta TV não decodifica HEVC; o Mac volta para H.264");
                }
            }, hevc);
            curDec = dec;
            AnnexBParser parser = new AnnexBParser(dec, hevc);
            final boolean v2 = ch.purpose == 'v' || ch.purpose == 'h';   // Mac novo: cada registro traz o horário
            int n;
            while ((n = ch.readRecordInto()) >= 0 && videoClient == s) {
                byte[] rec = ch.buffer();
                bytesIn += n;
                // Mais de ~0,4 s de vídeo esperando na fila: a TV ficou para trás, alcança o tempo real
                if (ch.available() > 450 * 1024) dec.resync();
                if (v2) {
                    if (n < 8) continue;
                    long pts = 0;
                    for (int k = 0; k < 8; k++) pts = (pts << 8) | (rec[k] & 0xff);
                    dec.nextPtsUs = pts;
                    parser.feed(rec, 8, n - 8);
                } else {
                    parser.feed(rec, 0, n);
                }
            }
        } catch (Exception e) {
            Log.i(TAG, "sessão encerrada: " + e);
        } finally {
            if (dec != null) dec.release();
            if (curDec == dec) curDec = null;
            closeQuietly(s);
            if (videoClient == s) {
                videoClient = null;
                streaming = false;
                setState(PanelUi.WAITING, "Pronto para projetar", "O Mac desconectou · aguardando");
                showPanel(true);
            }
        }
    }

    private void controlLoop() {
        try {
            controlServer = new ServerSocket();
            controlServer.setReuseAddress(true);
            controlServer.bind(new java.net.InetSocketAddress(CONTROL_PORT));
            while (running) {
                final Socket s = controlServer.accept();
                new Thread(new Runnable() {
                    @Override public void run() {
                        try {
                            s.setTcpNoDelay(true);
                            s.setSoTimeout(5000);
                            SecureChannel ch = SecureChannel.serverHandshake(s.getInputStream(), s.getOutputStream(),
                                    master, (byte) 'C', rnd);
                            s.setSoTimeout(0);
                            Ctrl me = new Ctrl(s, ch);
                            controls.add(me);
                            try {
                                byte[] r;
                                while (running && (r = ch.readRecord()) != null) {
                                    String cmd = new String(r, "UTF-8");
                                    if (cmd.startsWith("OPEN ")) {
                                        boolean ok = openDeckFromMac(cmd.substring(5));
                                        ch.writeRecord((ok ? "OPEN_OK" : "OPEN_NO").getBytes("UTF-8"));
                                    }
                                }
                            } catch (Exception ignored) {
                            } finally {
                                controls.remove(me);
                                closeQuietly(s);
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "controle recusado: " + e);
                            closeQuietly(s);
                        }
                    }
                }, "cast-ctrl-hs").start();
            }
        } catch (Exception e) {
            if (running) Log.w(TAG, "servidor de controle", e);
        }
    }

    /** O Mac pareado pediu para abrir uma aula. Só endereços do site de slides são aceitos. */
    private boolean openDeckFromMac(String payload) {
        String[] parts = payload.split("\t", 2);
        final String rel = parts[0].trim();
        final String title = parts.length > 1 ? parts[1].trim() : "Aula";
        final String full = rel.startsWith("https://") ? rel : SlidesCatalog.BASE + rel;
        if (!SlidesCatalog.allowed(full)) { Log.w(TAG, "endereço recusado: " + full); return false; }
        ui.post(new Runnable() {
            @Override public void run() {
                getSharedPreferences("aulas", MODE_PRIVATE).edit().putString("ultima", rel).apply();
                Intent i = new Intent(CastActivity.this, DeckActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                i.putExtra(DeckActivity.EXTRA_URL, full);
                i.putExtra(DeckActivity.EXTRA_TITLE, title);
                i.putExtra(DeckActivity.EXTRA_KEY, rel);
                startActivity(i);
            }
        });
        return true;
    }

    private void sendControl(final String cmd) {
        new Thread(new Runnable() {
            @Override public void run() {
                byte[] b = cmd.getBytes();
                for (Ctrl c : controls) {
                    try { c.ch.writeRecord(b); } catch (Exception e) { controls.remove(c); closeQuietly(c.sock); }
                }
            }
        }).start();
    }

    /** Anuncia o receptor na rede para o Mac achar sozinho. */
    private void discoveryLoop() {
        DatagramSocket ds = null;
        try {
            ds = new DatagramSocket();
            ds.setBroadcast(true);
            while (running && !Thread.currentThread().isInterrupted()) {
                byte[] msg = ("DIEGOCAST|" + deviceName() + "|" + VIDEO_PORT).getBytes("UTF-8");
                List<InetAddress> targets = new ArrayList<>();
                targets.add(InetAddress.getByName("255.255.255.255"));
                try {
                    for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                        if (!ni.isUp() || ni.isLoopback()) continue;
                        for (InterfaceAddress ia : ni.getInterfaceAddresses())
                            if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
                    }
                } catch (Exception ignored) { }
                for (InetAddress t : targets) {
                    try { ds.send(new DatagramPacket(msg, msg.length, t, DISCOVERY_PORT)); } catch (Exception ignored) { }
                }
                Thread.sleep(1000);
            }
        } catch (Exception ignored) {
        } finally {
            if (ds != null) ds.close();
        }
    }

    // ------------------------------------------------------------ rede direta (hotspot local)

    private WifiManager wifi() {
        return (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    // ------------------------------------------------------------ controle remoto

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean panelShown = panel.getVisibility() == View.VISIBLE;

        if (dash.pairShowing() && (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_MENU)) {
            if (e.getAction() == KeyEvent.ACTION_UP) dash.hidePairCode();
            return true;
        }
        if (k == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) showPanel(!panelShown);
            return true;
        }
        if (!streaming || panelShown) return super.dispatchKeyEvent(e);

        if (e.getAction() != KeyEvent.ACTION_DOWN) return k != KeyEvent.KEYCODE_BACK || super.dispatchKeyEvent(e);
        String cmd = null;
        switch (k) {
            case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                cmd = "R"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                cmd = "L"; break;
            case KeyEvent.KEYCODE_DPAD_UP: cmd = "U"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: cmd = "D"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                cmd = "PLAY"; break;
        }
        if (cmd != null) { sendControl(cmd); return true; }
        return super.dispatchKeyEvent(e);
    }

    private static void closeQuietly(Object c) {
        if (c == null) return;
        try {
            if (c instanceof Socket) ((Socket) c).close();
            else if (c instanceof ServerSocket) ((ServerSocket) c).close();
            else if (c instanceof AutoCloseable) ((AutoCloseable) c).close();
            else if (c instanceof java.io.Closeable) ((java.io.Closeable) c).close();
        } catch (Exception ignored) { }
    }
}
