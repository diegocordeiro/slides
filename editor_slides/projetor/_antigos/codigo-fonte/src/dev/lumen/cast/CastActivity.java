package dev.lumen.cast;

import android.app.Activity;
import android.content.Context;
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

    static final String TAG = "LumenCast";
    static final int VIDEO_PORT = 7000, DISCOVERY_PORT = 7001, CONTROL_PORT = 7002;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private float u;

    private SurfaceView surfaceView;
    private volatile android.view.Surface surface;
    private FrameLayout panel;
    private TextView status, netInfo, howTo, hotspotBtn, hotspotInfo, hint;

    private volatile boolean running = false;
    private volatile boolean streaming = false;
    private ServerSocket videoServer, controlServer;
    private volatile Socket videoClient;
    private final List<OutputStream> controlOuts = new CopyOnWriteArrayList<>();
    private Thread videoThread, controlThread, discoveryThread;

    private Object hotspot; // WifiManager.LocalOnlyHotspotReservation (API 26+)
    private String hsSsid, hsPass;

    // ------------------------------------------------------------ ciclo de vida

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        u = getResources().getDisplayMetrics().widthPixels / 1920f;
        buildUi();
    }

    @Override
    protected void onStart() {
        super.onStart();
        running = true;
        startServers();
        refreshInfo();
    }

    @Override
    protected void onStop() {
        running = false;
        stopServers();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopHotspot();
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
        surfaceView.getHolder().addCallback(this);
        root.addView(surfaceView, new FrameLayout.LayoutParams(-1, -1));

        panel = new FrameLayout(this);
        panel.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFF14304A, 0xFF07090D}));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = text(84, Color.WHITE, true);
        title.setText("Lumen Cast");
        TextView name = text(30, 0x99FFFFFF, false);
        name.setText(deviceName());
        name.setPadding(0, px(10), 0, px(40));

        status = text(34, 0xFF7FC4FF, true);
        status.setText("Aguardando o Mac…");

        netInfo = text(30, Color.WHITE, false);
        netInfo.setPadding(0, px(30), 0, 0);

        howTo = text(28, 0xB3FFFFFF, false);
        howTo.setPadding(0, px(24), 0, px(40));

        hotspotBtn = text(30, Color.WHITE, true);
        hotspotBtn.setPadding(px(48), px(22), px(48), px(22));
        hotspotBtn.setFocusable(true);
        hotspotBtn.setClickable(true);
        final GradientDrawable btnBg = new GradientDrawable();
        btnBg.setCornerRadius(px(40));
        btnBg.setColor(0x33FFFFFF);
        hotspotBtn.setBackground(btnBg);
        hotspotBtn.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override public void onFocusChange(View v, boolean f) {
                btnBg.setColor(f ? Color.WHITE : 0x33FFFFFF);
                hotspotBtn.setTextColor(f ? 0xFF0B0C10 : Color.WHITE);
                v.animate().scaleX(f ? 1.08f : 1f).scaleY(f ? 1.08f : 1f).setDuration(150).start();
            }
        });
        hotspotBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleHotspot(); }
        });

        hotspotInfo = text(30, Color.WHITE, false);
        hotspotInfo.setPadding(0, px(30), 0, 0);

        col.addView(title);
        col.addView(name);
        col.addView(status);
        col.addView(netInfo);
        col.addView(howTo);
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(-2, -2);
        bl.gravity = Gravity.CENTER_HORIZONTAL;
        col.addView(hotspotBtn, bl);
        col.addView(hotspotInfo);

        panel.addView(col, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));

        hint = text(24, 0x80FFFFFF, false);
        hint.setText("Durante a projeção: ◀ ▶ / OK passam os slides  ·  ☰ mostra esta tela  ·  Voltar sai");
        FrameLayout.LayoutParams hl = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        hl.bottomMargin = px(50);
        panel.addView(hint, hl);

        root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        updateHotspotUi();
        hotspotBtn.requestFocus();
    }

    private String deviceName() {
        String n = null;
        try { n = Settings.Global.getString(getContentResolver(), "device_name"); } catch (Exception ignored) { }
        return n != null && !n.isEmpty() ? n : Build.MODEL;
    }

    private void refreshInfo() {
        StringBuilder sb = new StringBuilder();
        String ssid = currentSsid();
        List<String[]> ips = localIps();
        if (ssid != null) sb.append("Wi‑Fi: ").append(ssid).append("\n");
        for (String[] ip : ips) sb.append(ip[1]).append(ips.size() > 1 ? "  (" + ip[0] + ")" : "").append("\n");
        if (ips.isEmpty()) sb.append("Sem rede. Use a rede direta abaixo.\n");
        netInfo.setText(sb.toString().trim());
        String ip = ips.isEmpty() ? "IP" : ips.get(0)[1];
        howTo.setText("No Mac (mesma rede):  ./projetar.sh   ou   ./projetar.sh " + ip);
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
                    hotspotBtn.requestFocus();
                } else {
                    panel.animate().alpha(0f).setDuration(250).withEndAction(new Runnable() {
                        @Override public void run() { panel.setVisibility(View.GONE); }
                    }).start();
                }
            }
        });
    }

    private void setStatus(final String s) {
        ui.post(new Runnable() { @Override public void run() { status.setText(s); refreshInfo(); } });
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
        for (OutputStream o : controlOuts) closeQuietly(o);
        controlOuts.clear();
        if (discoveryThread != null) discoveryThread.interrupt();
    }

    private void videoLoop() {
        try {
            videoServer = new ServerSocket();
            videoServer.setReuseAddress(true);
            videoServer.bind(new java.net.InetSocketAddress(VIDEO_PORT));
            while (running) {
                final Socket s = videoServer.accept();
                closeQuietly(videoClient); // só um Mac por vez: o novo assume
                videoClient = s;
                new Thread(new Runnable() { @Override public void run() { handleVideo(s); } }, "cast-session").start();
            }
        } catch (Exception e) {
            if (running) Log.w(TAG, "servidor de vídeo", e);
        }
    }

    private void handleVideo(Socket s) {
        String who = s.getInetAddress().getHostAddress();
        VideoDecoder dec = null;
        try {
            s.setTcpNoDelay(true);
            s.setReceiveBufferSize(1 << 20);
            for (int i = 0; i < 50 && surface == null; i++) Thread.sleep(50);
            if (surface == null) return;
            setStatus("Conectando a " + who + "…");
            dec = new VideoDecoder(surface, new VideoDecoder.Events() {
                @Override public void onFirstFrame() {
                    streaming = true;
                    setStatus("Projetando de " + s.getInetAddress().getHostAddress());
                    showPanel(false);
                }
            });
            AnnexBParser parser = new AnnexBParser(dec);
            InputStream in = s.getInputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0 && videoClient == s) parser.feed(buf, 0, n);
        } catch (Exception e) {
            Log.i(TAG, "sessão encerrada: " + e);
        } finally {
            if (dec != null) dec.release();
            closeQuietly(s);
            if (videoClient == s) {
                videoClient = null;
                streaming = false;
                setStatus("Mac desconectado. Aguardando…");
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
                Socket s = controlServer.accept();
                s.setTcpNoDelay(true);
                controlOuts.add(s.getOutputStream());
            }
        } catch (Exception e) {
            if (running) Log.w(TAG, "servidor de controle", e);
        }
    }

    private void sendControl(final String cmd) {
        new Thread(new Runnable() {
            @Override public void run() {
                byte[] b = (cmd + "\n").getBytes();
                for (OutputStream o : controlOuts) {
                    try { o.write(b); o.flush(); } catch (Exception e) { controlOuts.remove(o); }
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
                byte[] msg = ("LUMENCAST|" + deviceName() + "|" + VIDEO_PORT).getBytes("UTF-8");
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

    private void toggleHotspot() {
        if (hotspot != null) { stopHotspot(); return; }
        if (Build.VERSION.SDK_INT < 26) { hotspotInfo.setText("Rede direta exige Android 8 ou superior."); return; }
        hotspotInfo.setText("Criando rede…");
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wm.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
                @Override public void onStarted(WifiManager.LocalOnlyHotspotReservation r) {
                    hotspot = r;
                    WifiConfiguration c = r.getWifiConfiguration();
                    hsSsid = c != null ? c.SSID : "?";
                    hsPass = c != null ? c.preSharedKey : "?";
                    updateHotspotUi();
                }
                @Override public void onStopped() {
                    hotspot = null;
                    updateHotspotUi();
                    hotspotInfo.setText("A rede direta foi encerrada pelo sistema.");
                }
                @Override public void onFailed(int reason) {
                    hotspot = null;
                    updateHotspotUi();
                    String why;
                    switch (reason) {
                        case 1: why = "sem canal Wi‑Fi disponível"; break;
                        case 3: why = "o Wi‑Fi deste aparelho não permite agora (modo incompatível)"; break;
                        case 4: why = "o sistema bloqueou o compartilhamento"; break;
                        default: why = "erro do sistema (" + reason + ")";
                    }
                    hotspotInfo.setText("Não foi possível criar a rede: " + why
                            + ".\nAlternativa: roteador sem internet ou o hotspot do celular.");
                }
            }, ui);
        } catch (SecurityException e) {
            hotspotInfo.setText("Falta permissão de localização.\nRode o instalar-cast.sh de novo no Mac.");
        } catch (Throwable t) {
            hotspotInfo.setText("Rede direta indisponível neste Fire OS: " + t.getClass().getSimpleName());
        }
    }

    private void stopHotspot() {
        if (hotspot != null) {
            try { ((AutoCloseable) hotspot).close(); } catch (Exception ignored) { }
            hotspot = null;
        }
        updateHotspotUi();
    }

    private void updateHotspotUi() {
        ui.post(new Runnable() {
            @Override public void run() {
                if (hotspot != null) {
                    hotspotBtn.setText("Encerrar rede direta");
                    hotspotInfo.setText("Rede direta ativa (não precisa de internet)\n"
                            + "Nome: " + hsSsid + "     Senha: " + hsPass + "\n"
                            + "No Mac:  ./projetar.sh --rede \"" + hsSsid + "\" \"" + hsPass + "\"");
                } else {
                    hotspotBtn.setText("Criar rede direta (sem internet)");
                    if (hotspotInfo.getText().toString().startsWith("Rede direta ativa")) hotspotInfo.setText("");
                }
                refreshInfo();
            }
        });
    }

    // ------------------------------------------------------------ controle remoto

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean panelShown = panel.getVisibility() == View.VISIBLE;

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
