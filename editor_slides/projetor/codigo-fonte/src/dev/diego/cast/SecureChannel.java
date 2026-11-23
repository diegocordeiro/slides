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
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PublicKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import javax.crypto.KeyAgreement;

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
 * v2 ("DCS2", sigilo futuro): o Mac manda também uma chave pública ECDH P-256 temporária (65 bytes);
 *   a TV responde nonceTV | chave temporária dela | HMAC(master, "srv2" | transcrição) e o Mac confirma
 *   com HMAC(master, "cli2" | transcrição), onde transcrição = propósito | nonces | as duas chaves públicas.
 *   chaves = HKDF(segredo ECDH | master, salt = nonces, info = "c2s"/"s2c" | propósito). As chaves
 *   temporárias são descartadas no fim: quem gravar o tráfego não decifra depois, nem com o código.
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
    private static final byte[] MAGIC2 = {'D', 'C', 'S', '2'};   // v2: + ECDH P-256 temporário (sigilo futuro)

    /** true quando a sessão usou chaves temporárias (ECDH): gravações antigas não podem ser decifradas depois. */
    public boolean forwardSecret;

    /** Propósito negociado: 'V' vídeo v1, 'v'/'h' vídeo v2 H.264/HEVC (registro começa com 8 bytes de horário), 'C' controle. */
    public byte purpose;
    private byte[] ctBuf = new byte[256 * 1024], ptBuf = new byte[256 * 1024];
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
        byte[] magic = new byte[4];
        ch.in.readFully(magic);
        boolean v2 = java.util.Arrays.equals(magic, MAGIC2);
        if (!v2 && !java.util.Arrays.equals(magic, MAGIC)) throw new IOException("protocolo desconhecido");
        byte purpose = ch.in.readByte();
        // vídeo: 'V' v1 · 'v' v2 H.264 · 'h' v2 HEVC (H.265)
        boolean ok = purpose == expectedPurpose || (expectedPurpose == 'V' && (purpose == 'v' || purpose == 'h'));
        if (!ok) throw new IOException("propósito inesperado");
        ch.purpose = purpose;
        byte[] cn = new byte[16];
        ch.in.readFully(cn);
        byte[] sn = new byte[16];
        rnd.nextBytes(sn);
        byte[] p = new byte[]{purpose};

        if (!v2) {
            byte[] tagS = hmac(master, concat(ascii("srv"), p, cn, sn));
            ch.out.write(concat(sn, tagS));
            ch.out.flush();
            byte[] tagC = new byte[32];
            ch.in.readFully(tagC);
            if (!MessageDigest.isEqual(tagC, hmac(master, concat(ascii("cli"), p, cn, sn))))
                throw new SecurityException("Mac não pareado");
            byte[] salt = concat(cn, sn);
            ch.recvKey = hkdf(master, salt, concat(ascii("c2s"), p));
            ch.sendKey = hkdf(master, salt, concat(ascii("s2c"), p));
            ch.forwardSecret = false;
            return ch;
        }

        byte[] macPub = new byte[65];
        ch.in.readFully(macPub);
        KeyPair eph = newEphemeral();
        byte[] shared = ecdh(eph, macPub);          // valida o ponto ANTES de responder qualquer coisa
        byte[] tvPub = encodePoint((ECPublicKey) eph.getPublic());
        byte[] transcript = concat(p, cn, sn, macPub, tvPub);
        ch.out.write(concat(sn, tvPub, hmac(master, concat(ascii("srv2"), transcript))));
        ch.out.flush();
        byte[] tagC = new byte[32];
        ch.in.readFully(tagC);
        if (!MessageDigest.isEqual(tagC, hmac(master, concat(ascii("cli2"), transcript))))
            throw new SecurityException("Mac não pareado");
        byte[] ikm = concat(shared, master);
        byte[] salt = concat(cn, sn);
        ch.recvKey = hkdf(ikm, salt, concat(ascii("c2s"), p));
        ch.sendKey = hkdf(ikm, salt, concat(ascii("s2c"), p));
        java.util.Arrays.fill(shared, (byte) 0);
        java.util.Arrays.fill(ikm, (byte) 0);
        ch.forwardSecret = true;
        return ch;
    }

    // ------------------------------------------------------------------ ECDH P-256 temporário

    static KeyPair newEphemeral() throws GeneralSecurityException {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        return g.generateKeyPair();
    }

    /** Ponto público no formato X9.63 não comprimido (65 bytes: 04 | X | Y), igual ao CryptoKit. */
    static byte[] encodePoint(ECPublicKey k) {
        byte[] out = new byte[65];
        out[0] = 4;
        put32(k.getW().getAffineX(), out, 1);
        put32(k.getW().getAffineY(), out, 33);
        return out;
    }

    private static void put32(BigInteger v, byte[] out, int off) {
        byte[] b = v.toByteArray();
        int n = Math.min(b.length, 32);
        System.arraycopy(b, b.length - n, out, off + 32 - n, n);
    }

    static byte[] ecdh(KeyPair mine, byte[] peerPoint) throws GeneralSecurityException {
        if (peerPoint.length != 65 || peerPoint[0] != 4) throw new SecurityException("chave temporária inválida");
        ECParameterSpec params = ((ECPublicKey) mine.getPublic()).getParams();
        BigInteger x = new BigInteger(1, java.util.Arrays.copyOfRange(peerPoint, 1, 33));
        BigInteger y = new BigInteger(1, java.util.Arrays.copyOfRange(peerPoint, 33, 65));
        PublicKey peer = KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), params));
        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(mine.getPrivate());
        ka.doPhase(peer, true);                     // valida que o ponto está na curva
        return ka.generateSecret();
    }

    /** Lado Mac v2 (usado nos testes; o Mac real usa a versão em Swift). */
    public static SecureChannel clientHandshake(InputStream i, OutputStream o, byte[] master, byte purpose,
                                                SecureRandom rnd) throws IOException, GeneralSecurityException {
        SecureChannel ch = new SecureChannel(i, o);
        byte[] cn = new byte[16];
        rnd.nextBytes(cn);
        KeyPair eph = newEphemeral();
        byte[] macPub = encodePoint((ECPublicKey) eph.getPublic());
        byte[] p = new byte[]{purpose};
        ch.out.write(concat(MAGIC2, p, cn, macPub));
        ch.out.flush();
        byte[] resp = new byte[16 + 65 + 32];
        ch.in.readFully(resp);
        byte[] sn = java.util.Arrays.copyOfRange(resp, 0, 16);
        byte[] tvPub = java.util.Arrays.copyOfRange(resp, 16, 81);
        byte[] tagS = java.util.Arrays.copyOfRange(resp, 81, 113);
        byte[] transcript = concat(p, cn, sn, macPub, tvPub);
        if (!MessageDigest.isEqual(tagS, hmac(master, concat(ascii("srv2"), transcript))))
            throw new SecurityException("TV não pareada");
        ch.out.write(hmac(master, concat(ascii("cli2"), transcript)));
        ch.out.flush();
        byte[] ikm = concat(ecdh(eph, tvPub), master);
        byte[] salt = concat(cn, sn);
        ch.sendKey = hkdf(ikm, salt, concat(ascii("c2s"), p));
        ch.recvKey = hkdf(ikm, salt, concat(ascii("s2c"), p));
        ch.forwardSecret = true;
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

    /**
     * Como readRecord, mas decifra para um buffer reaproveitado: retorna o tamanho (ou -1 no fim do fluxo);
     * os dados ficam em {@link #buffer()} até a próxima chamada.
     */
    public int readRecordInto() throws IOException, GeneralSecurityException {
        int n;
        try { n = in.readInt(); } catch (java.io.EOFException e) { return -1; }
        if (n < 16 || n > MAX_RECORD) throw new IOException("registro inválido");
        if (ctBuf.length < n) ctBuf = new byte[Math.max(n, ctBuf.length * 2)];
        if (ptBuf.length < n) ptBuf = new byte[Math.max(n, ptBuf.length * 2)];
        in.readFully(ctBuf, 0, n);
        dec.init(Cipher.DECRYPT_MODE, new SecretKeySpec(recvKey, "AES"), new GCMParameterSpec(128, nonce(recvCounter)));
        dec.updateAAD(be32(n));
        int len = dec.doFinal(ctBuf, 0, n, ptBuf, 0);
        recvCounter++;
        return len;
    }

    public byte[] buffer() { return ptBuf; }

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
