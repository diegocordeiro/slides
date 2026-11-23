package dev.diego.cast;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Canal seguro do Diego Cast (Java puro, testável fora do Android).
 *
 * Pareamento: um código de 20 caracteres (base32, ~100 bits) mostrado na TV e digitado no Mac.
 *   master = HKDF-SHA256(ikm = código normalizado, salt = "DiegoCast-v1", info = "master")
 *
 * Aperto de mão (TV = servidor, Mac = cliente), por conexão:
 *   Mac → TV : "DCS1" | propósito (1 byte: 'V' vídeo, 'C' controle) | nonceMac (16)
 *   TV  → Mac: nonceTV (16) | HMAC(master, "srv" | propósito | nonceMac | nonceTV)
 *   Mac → TV : HMAC(master, "cli" | propósito | nonceMac | nonceTV)
 *   chaves   : HKDF(master, salt = nonceMac|nonceTV, info = "c2s"|propósito) e "s2c"|propósito
 *
 * Registros: tamanho (4 bytes, big-endian) | AES-256-GCM(chave, nonce = 0000 | contador 8 bytes,
 *   aad = os 4 bytes de tamanho). O contador começa em 0 e sobe 1 por registro em cada sentido:
 *   registro repetido, fora de ordem ou alterado é rejeitado e a conexão cai.
 */
public final class SecureChannel {

    public static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I, O, 0, 1
    public static final int CODE_LEN = 20;
    public static final int MAX_RECORD = 8 << 20;
    private static final byte[] MAGIC = {'D', 'C', 'S', '1'};

    private final DataInputStream in;
    private final DataOutputStream out;
    private byte[] recvKey, sendKey;
    private long recvCounter = 0, sendCounter = 0;
    private final Cipher dec, enc;

    private SecureChannel(InputStream i, OutputStream o) throws GeneralSecurityException {
        in = new DataInputStream(i);
        out = new DataOutputStream(o);
        dec = Cipher.getInstance("AES/GCM/NoPadding");
        enc = Cipher.getInstance("AES/GCM/NoPadding");
    }

    // ------------------------------------------------------------------ pareamento

    public static String newCode(SecureRandom rnd) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < CODE_LEN; i++) sb.append(ALPHABET.charAt(rnd.nextInt(ALPHABET.length())));
        return sb.toString();
    }

    /** "K7QF2M9X…" → "K7QF-2M9X-…" */
    public static String pretty(String code) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < code.length(); i++) {
            if (i > 0 && i % 4 == 0) sb.append('-');
            sb.append(code.charAt(i));
        }
        return sb.toString();
    }

    public static String normalize(String code) {
        return code.toUpperCase().replaceAll("[^A-Z0-9]", "");
    }

    public static byte[] masterKey(String code) throws GeneralSecurityException {
        return hkdf(normalize(code).getBytes(StandardCharsets.US_ASCII),
                "DiegoCast-v1".getBytes(StandardCharsets.US_ASCII),
                "master".getBytes(StandardCharsets.US_ASCII));
    }

    // ------------------------------------------------------------------ aperto de mão (lado TV)

    /** Retorna o canal autenticado, ou lança exceção (conexão deve ser fechada). */
    public static SecureChannel serverHandshake(InputStream i, OutputStream o, byte[] master, byte expectedPurpose,
                                                SecureRandom rnd) throws IOException, GeneralSecurityException {
        SecureChannel ch = new SecureChannel(i, o);
        byte[] hello = new byte[4 + 1 + 16];
        ch.in.readFully(hello);
        for (int k = 0; k < 4; k++) if (hello[k] != MAGIC[k]) throw new IOException("protocolo desconhecido");
        byte purpose = hello[4];
        if (purpose != expectedPurpose) throw new IOException("propósito inesperado");
        byte[] cn = new byte[16];
        System.arraycopy(hello, 5, cn, 0, 16);
        byte[] sn = new byte[16];
        rnd.nextBytes(sn);
        byte[] tagS = hmac(master, concat(ascii("srv"), new byte[]{purpose}, cn, sn));
        ch.out.write(concat(sn, tagS));
        ch.out.flush();
        byte[] tagC = new byte[32];
        ch.in.readFully(tagC);
        byte[] expect = hmac(master, concat(ascii("cli"), new byte[]{purpose}, cn, sn));
        if (!MessageDigest.isEqual(tagC, expect)) throw new SecurityException("Mac não pareado");
        byte[] salt = concat(cn, sn);
        ch.recvKey = hkdf(master, salt, concat(ascii("c2s"), new byte[]{purpose}));
        ch.sendKey = hkdf(master, salt, concat(ascii("s2c"), new byte[]{purpose}));
        return ch;
    }

    /** Lado Mac (usado nos testes; o Mac real usa a versão em Swift). */
    public static SecureChannel clientHandshake(InputStream i, OutputStream o, byte[] master, byte purpose,
                                                SecureRandom rnd) throws IOException, GeneralSecurityException {
        SecureChannel ch = new SecureChannel(i, o);
        byte[] cn = new byte[16];
        rnd.nextBytes(cn);
        ch.out.write(concat(MAGIC, new byte[]{purpose}, cn));
        ch.out.flush();
        byte[] resp = new byte[48];
        ch.in.readFully(resp);
        byte[] sn = java.util.Arrays.copyOfRange(resp, 0, 16);
        byte[] tagS = java.util.Arrays.copyOfRange(resp, 16, 48);
        if (!MessageDigest.isEqual(tagS, hmac(master, concat(ascii("srv"), new byte[]{purpose}, cn, sn))))
            throw new SecurityException("TV não pareada");
        ch.out.write(hmac(master, concat(ascii("cli"), new byte[]{purpose}, cn, sn)));
        ch.out.flush();
        byte[] salt = concat(cn, sn);
        ch.sendKey = hkdf(master, salt, concat(ascii("c2s"), new byte[]{purpose}));
        ch.recvKey = hkdf(master, salt, concat(ascii("s2c"), new byte[]{purpose}));
        return ch;
    }

    // ------------------------------------------------------------------ registros

    /** Lê e decifra o próximo registro; null no fim do fluxo. */
    public byte[] readRecord() throws IOException, GeneralSecurityException {
        int n;
        try { n = in.readInt(); } catch (java.io.EOFException e) { return null; }
        if (n < 16 || n > MAX_RECORD) throw new IOException("registro inválido");
        byte[] ct = new byte[n];
        in.readFully(ct);
        dec.init(Cipher.DECRYPT_MODE, new SecretKeySpec(recvKey, "AES"), new GCMParameterSpec(128, nonce(recvCounter)));
        dec.updateAAD(be32(n));
        byte[] pt = dec.doFinal(ct); // lança AEADBadTagException se alterado/reenviado
        recvCounter++;
        return pt;
    }

    public synchronized void writeRecord(byte[] pt) throws IOException, GeneralSecurityException {
        int n = pt.length + 16;
        enc.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(sendKey, "AES"), new GCMParameterSpec(128, nonce(sendCounter)));
        enc.updateAAD(be32(n));
        byte[] ct = enc.doFinal(pt);
        sendCounter++;
        out.writeInt(n);
        out.write(ct);
        out.flush();
    }

    public int available() throws IOException { return in.available(); }

    // ------------------------------------------------------------------ primitivas

    private static byte[] nonce(long counter) {
        byte[] n = new byte[12];
        for (int k = 0; k < 8; k++) n[11 - k] = (byte) (counter >>> (8 * k));
        return n;
    }

    private static byte[] be32(int v) {
        return new byte[]{(byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v};
    }

    static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(key, "HmacSHA256"));
        return m.doFinal(data);
    }

    /** HKDF-SHA256 (RFC 5869), 32 bytes. */
    static byte[] hkdf(byte[] ikm, byte[] salt, byte[] info) throws GeneralSecurityException {
        byte[] prk = hmac(salt, ikm);
        return hmac(prk, concat(info, new byte[]{1}));
    }

    private static byte[] ascii(String s) { return s.getBytes(StandardCharsets.US_ASCII); }

    static byte[] concat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] r = new byte[n];
        int o = 0;
        for (byte[] p : parts) { System.arraycopy(p, 0, r, o, p.length); o += p.length; }
        return r;
    }
}
