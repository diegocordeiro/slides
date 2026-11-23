package dev.lumen.cast;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.util.Log;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.util.Arrays;

/** Decodifica H.264 por hardware (MediaCodec) direto na tela, priorizando baixa latência. */
final class VideoDecoder implements AnnexBParser.Listener {

    interface Events { void onFirstFrame(); }

    private static final String TAG = "LumenCast";
    private final Surface surface;
    private final Events events;
    private MediaCodec codec;
    private byte[] curSps;
    private boolean waitKey = true;
    private volatile boolean alive = true;
    private Thread outThread;
    private boolean firstShown = false;

    VideoDecoder(Surface s, Events e) { surface = s; events = e; }

    @Override
    public void onAccessUnit(byte[] data, int len, boolean key, byte[] sps, byte[] pps) {
        if (!alive) return;
        if (sps == null || pps == null) return;
        if (codec != null && !Arrays.equals(sps, curSps)) {
            Log.i(TAG, "Resolução mudou, recriando decodificador");
            stopCodec();
        }
        if (codec == null) {
            if (!key) return;
            try { startCodec(sps, pps); } catch (Exception ex) {
                Log.e(TAG, "Falha ao criar decodificador", ex);
                return;
            }
        }
        if (waitKey && !key) return;
        try {
            long deadline = System.currentTimeMillis() + (key ? 300 : 40);
            int idx;
            do {
                idx = codec.dequeueInputBuffer(10000);
            } while (idx < 0 && System.currentTimeMillis() < deadline && alive);
            if (idx < 0) { waitKey = !key; return; } // atrasou: descarta e espera próximo quadro-chave
            ByteBuffer ib = codec.getInputBuffer(idx);
            if (ib == null || ib.capacity() < len) {
                codec.queueInputBuffer(idx, 0, 0, 0, 0);
                waitKey = true;
                return;
            }
            ib.clear();
            ib.put(data, 0, len);
            codec.queueInputBuffer(idx, 0, len, System.nanoTime() / 1000, 0);
            waitKey = false;
        } catch (Exception ex) {
            Log.w(TAG, "Erro ao enviar quadro", ex);
            stopCodec();
        }
    }

    private static byte[] withStart(byte[] nal) {
        byte[] r = new byte[nal.length + 4];
        r[3] = 1;
        System.arraycopy(nal, 0, r, 4, nal.length);
        return r;
    }

    private void startCodec(byte[] sps, byte[] pps) throws Exception {
        MediaFormat f = MediaFormat.createVideoFormat("video/avc", 1920, 1080);
        f.setByteBuffer("csd-0", ByteBuffer.wrap(withStart(sps)));
        f.setByteBuffer("csd-1", ByteBuffer.wrap(withStart(pps)));
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 3 << 20);
        f.setInteger("max-width", 1920);
        f.setInteger("max-height", 1088);
        f.setInteger("priority", 0);           // tempo real
        f.setInteger("low-latency", 1);        // ignorado onde não existe
        final MediaCodec c = MediaCodec.createDecoderByType("video/avc");
        c.configure(f, surface, null, 0);
        c.start();
        codec = c;
        curSps = sps;
        waitKey = true;
        outThread = new Thread(new Runnable() {
            @Override public void run() {
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                while (alive && codec == c) {
                    try {
                        int o = c.dequeueOutputBuffer(info, 20000);
                        if (o >= 0) {
                            c.releaseOutputBuffer(o, true);
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

    void release() {
        alive = false;
        stopCodec();
    }
}
