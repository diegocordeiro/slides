package dev.diego.cast;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.util.Log;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.util.Arrays;

/** Decodifica H.264 por hardware (MediaCodec) direto na tela, priorizando baixa latência. */
final class VideoDecoder implements AnnexBParser.Listener {

    interface Events {
        void onFirstFrame();
        /** O decodificador precisa de um quadro-chave (início ou recuperação): pedir ao Mac. */
        void onNeedKeyFrame();
        /** Esta TV não tem decodificador para o codec pedido (ex.: HEVC): o Mac deve voltar para H.264. */
        void onCodecUnsupported();
    }

    /** Horário de captura (µs, relógio do Mac) do próximo quadro; -1 = sem horário (Mac antigo). */
    volatile long nextPtsUs = -1;
    private long lastKeyRequest = 0;
    volatile int framesLate;

    private static final String TAG = "DiegoCast";
    private final Surface surface;
    private final Events events;
    private MediaCodec codec;
    private byte[] curSps;
    private boolean waitKey = true;
    private volatile boolean alive = true;
    private Thread outThread;
    private boolean firstShown = false;
    volatile int framesIn, framesQueued, framesShown, framesDropped;
    volatile String lastError;

    private final boolean hevc;
    private final String mime;

    String codecName() { return hevc ? "HEVC" : "H.264"; }

    VideoDecoder(Surface s, Events e, boolean hevc) {
        surface = s;
        events = e;
        this.hevc = hevc;
        this.mime = hevc ? "video/hevc" : "video/avc";
    }

    @Override
    public void onAccessUnit(byte[] data, int len, boolean key, byte[][] params) {
        if (!alive) return;
        framesIn++;
        if (params == null) { lastError = "sem parâmetros de vídeo (SPS/PPS)"; return; }
        byte[] sps = params[hevc ? 1 : 0];
        if (codec != null && !Arrays.equals(sps, curSps)) {
            Log.i(TAG, "Resolução mudou, recriando decodificador");
            stopCodec();
        }
        if (codec == null) {
            if (!key) return;
            try { startCodec(params); } catch (Exception ex) {
                Log.e(TAG, "Falha ao criar decodificador " + mime, ex);
                lastError = "decodificador " + mime + ": " + ex;
                if (hevc) { alive = false; events.onCodecUnsupported(); }
                return;
            }
        }
        if (waitKey && !key) { framesDropped++; requestKey(); return; }
        try {
            long deadline = System.currentTimeMillis() + (key ? 300 : 40);
            int idx;
            do {
                idx = codec.dequeueInputBuffer(10000);
            } while (idx < 0 && System.currentTimeMillis() < deadline && alive);
            if (idx < 0) { waitKey = !key; framesDropped++; if (waitKey) requestKey(); return; } // atrasou: descarta e espera próximo quadro-chave
            ByteBuffer ib = codec.getInputBuffer(idx);
            if (ib == null || ib.capacity() < len) {
                codec.queueInputBuffer(idx, 0, 0, 0, 0);
                waitKey = true;
                return;
            }
            ib.clear();
            ib.put(data, 0, len);
            long pts = nextPtsUs >= 0 ? nextPtsUs : System.nanoTime() / 1000;
            codec.queueInputBuffer(idx, 0, len, pts, 0);
            framesQueued++;
            waitKey = false;
        } catch (Exception ex) {
            Log.w(TAG, "Erro ao enviar quadro", ex);
            lastError = "envio: " + ex;
            stopCodec();
        }
    }

    private static byte[] withStart(byte[] nal) {
        byte[] r = new byte[nal.length + 4];
        r[3] = 1;
        System.arraycopy(nal, 0, r, 4, nal.length);
        return r;
    }

    private void startCodec(byte[][] params) throws Exception {
        MediaFormat f = MediaFormat.createVideoFormat(mime, 1920, 1080);
        if (hevc) {
            // HEVC: VPS + SPS + PPS juntos em csd-0
            byte[] a = withStart(params[0]), b = withStart(params[1]), c = withStart(params[2]);
            byte[] all = new byte[a.length + b.length + c.length];
            System.arraycopy(a, 0, all, 0, a.length);
            System.arraycopy(b, 0, all, a.length, b.length);
            System.arraycopy(c, 0, all, a.length + b.length, c.length);
            f.setByteBuffer("csd-0", ByteBuffer.wrap(all));
        } else {
            f.setByteBuffer("csd-0", ByteBuffer.wrap(withStart(params[0])));
            f.setByteBuffer("csd-1", ByteBuffer.wrap(withStart(params[1])));
        }
        byte[] sps = params[hevc ? 1 : 0];
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 3 << 20);
        f.setInteger("max-width", 1920);
        f.setInteger("max-height", 1088);
        f.setInteger("priority", 0);           // tempo real
        f.setInteger("low-latency", 1);        // ignorado onde não existe
        final MediaCodec c = MediaCodec.createDecoderByType(mime);
        c.configure(f, surface, null, 0);
        c.start();
        codec = c;
        curSps = sps;
        waitKey = true;
        baseNs = Long.MIN_VALUE;
        outThread = new Thread(new Runnable() {
            @Override public void run() {
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                while (alive && codec == c) {
                    try {
                        int o = c.dequeueOutputBuffer(info, 20000);
                        if (o >= 0) {
                            if (nextPtsUs >= 0) c.releaseOutputBuffer(o, renderTime(info.presentationTimeUs));
                            else c.releaseOutputBuffer(o, true);
                            framesShown++;
                            if (!firstShown) { firstShown = true; events.onFirstFrame(); }
                        }
                    } catch (Exception e) {
                        break;
                    }
                }
            }
        }, "cast-out");
        outThread.start();
    }

    /**
     * Exibe cada quadro no mesmo compasso em que o Mac o capturou (algoritmo da versão 1.7):
     * o Wi‑Fi entrega em rajadas, mas a tela recebe um ritmo regular. Atrasou → reajusta a base
     * (mais folga); folga demais → reduz aos poucos.
     */
    private static final long START_DELAY_NS = 34_000_000L, MAX_AHEAD_NS = 120_000_000L;
    private long baseNs = Long.MIN_VALUE;
    volatile int bufferMs;                                     // folga atual (só para o diagnóstico)

    private long renderTime(long ptsUs) {
        long now = System.nanoTime();
        long ptsNs = ptsUs * 1000L;
        if (baseNs == Long.MIN_VALUE) baseNs = now - ptsNs + START_DELAY_NS;
        long target = baseNs + ptsNs;
        if (target < now) {                       // chegou atrasado: mostra já e dá mais folga
            baseNs += (now - target) + 4_000_000L;
            if (now - target > 8_000_000L) framesLate++;    // só conta o que perdeu a vez na tela
            bufferMs = 0;
            return now;
        }
        if (target - now > MAX_AHEAD_NS) {         // salto (pausa, reconexão): recomeça a base
            baseNs = now - ptsNs + START_DELAY_NS;
            bufferMs = (int) (START_DELAY_NS / 1_000_000L);
            return now + START_DELAY_NS;
        }
        if (target - now > START_DELAY_NS + 8_000_000L) baseNs -= 250_000L;  // devolve a folga aos poucos
        bufferMs = (int) ((target - now) / 1_000_000L);
        return target;
    }

    private void requestKey() {
        long t = System.currentTimeMillis();
        if (t - lastKeyRequest < 700) return;
        lastKeyRequest = t;
        events.onNeedKeyFrame();
    }

    private void stopCodec() {
        MediaCodec c = codec;
        codec = null;
        curSps = null;
        if (outThread != null) {
            try { outThread.join(300); } catch (InterruptedException ignored) { }
            outThread = null;
        }
        if (c != null) {
            try { c.stop(); } catch (Exception ignored) { }
            try { c.release(); } catch (Exception ignored) { }
        }
    }

    /** Descarta o que estiver atrasado e recomeça no próximo quadro-chave (no máx. 1s). */
    void resync() {
        if (!waitKey) { waitKey = true; resyncs++; requestKey(); }
    }
    volatile int resyncs;

    void release() {
        alive = false;
        stopCodec();
    }
}
