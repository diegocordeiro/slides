package dev.diego.cast;

import java.util.Arrays;

/**
 * Divide um fluxo H.264 "Annex B" (00 00 01 ...) em access units (quadros completos).
 * Java puro, sem dependências do Android, para poder ser testado no computador.
 */
public final class AnnexBParser {

    public interface Listener {
        /** data[0..len) contém o quadro inteiro, com start codes. */
        void onAccessUnit(byte[] data, int len, boolean keyFrame, byte[] sps, byte[] pps);
    }

    private static final byte[] START = {0, 0, 0, 1};

    private final Listener listener;
    private byte[] buf = new byte[1 << 20];
    private int len = 0;

    private byte[] au = new byte[1 << 20];
    private int auLen = 0;
    private boolean auHasVcl = false, auKey = false;

    private byte[] sps, pps;

    public AnnexBParser(Listener l) { this.listener = l; }

    public void feed(byte[] d, int off, int n) {
        if (len + n > buf.length) buf = Arrays.copyOf(buf, Math.max(buf.length * 2, len + n));
        System.arraycopy(d, off, buf, len, n);
        len += n;

        int start = findStart(0);
        if (start < 0) {
            // sem start code: guarda só o finalzinho (pode ser início de um start code)
            if (len > 3) { System.arraycopy(buf, len - 3, buf, 0, 3); len = 3; }
            return;
        }
        while (true) {
            int next = findStart(start + 3);
            if (next < 0) break;
            emit(start + 3, next);
            // Próxima NAL é um delimitador (AUD): o quadro atual acabou, entrega já (menos atraso)
            if (next + 3 < len && (buf[next + 3] & 0x1f) == 9) flushAu();
            start = next;
        }
        // compacta: mantém a partir do último start code (NAL ainda incompleta)
        int keep = len - start;
        System.arraycopy(buf, start, buf, 0, keep);
        len = keep;
    }

    /** Força a saída do quadro pendente (fim do fluxo). */
    public void flush() {
        int start = findStart(0);
        if (start >= 0) emit(start + 3, len);
        len = 0;
        flushAu();
    }

    private int findStart(int from) {
        for (int i = from; i + 2 < len; i++) {
            if ((buf[i + 2] & 0xff) > 1) { i += 2; continue; } // salto rápido
            if (buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1) return i;
        }
        return -1;
    }

    private void emit(int s, int e) {
        while (e > s && buf[e - 1] == 0) e--; // remove zeros do próximo start code de 4 bytes
        if (e <= s) return;
        onNal(buf, s, e - s);
    }

    private void onNal(byte[] b, int off, int n) {
        int type = b[off] & 0x1f;
        boolean vcl = type == 1 || type == 5;
        boolean firstMb = vcl && n > 1 && (b[off + 1] & 0x80) != 0;

        if (auHasVcl && (!vcl || firstMb)) flushAu();

        if (type == 7) sps = Arrays.copyOfRange(b, off, off + n);
        else if (type == 8) pps = Arrays.copyOfRange(b, off, off + n);

        if (auLen + n + 4 > au.length) au = Arrays.copyOf(au, Math.max(au.length * 2, auLen + n + 4));
        System.arraycopy(START, 0, au, auLen, 4);
        auLen += 4;
        System.arraycopy(b, off, au, auLen, n);
        auLen += n;
        if (vcl) {
            auHasVcl = true;
            if (type == 5) auKey = true;
        }
    }

    private void flushAu() {
        if (auHasVcl && auLen > 0) listener.onAccessUnit(au, auLen, auKey, sps, pps);
        auLen = 0;
        auHasVcl = false;
        auKey = false;
    }
}
