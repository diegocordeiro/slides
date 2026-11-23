package dev.diego.cast;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lista de aulas do site https://diegocordeiro.github.io/slides/ (slides.json, com reserva no index.html). */
final class SlidesCatalog {

    static final String BASE = "https://diegocordeiro.github.io/slides/";

    static final class Aula {
        String secao, titulo, curso, url, versao;
        int slides;

        String fullUrl() { return url.startsWith("https://") ? url : BASE + url; }
    }

    private SlidesCatalog() {}

    /** Baixa a lista atual. Usa o slides.json; se ainda não estiver publicado, lê a página inicial. */
    static List<Aula> fetch() throws IOException {
        try {
            return parseJson(httpGet(BASE + "slides.json"));
        } catch (Exception jsonFalhou) {
            List<Aula> l = parseIndex(httpGet(BASE));
            if (l.isEmpty()) throw new IOException("nenhuma aula encontrada no site");
            return l;
        }
    }

    static String httpGet(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(10000);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[16 * 1024];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            c.disconnect();
        }
    }

    static List<Aula> parseJson(String s) throws Exception {
        JSONArray arr = new JSONObject(s).getJSONArray("aulas");
        List<Aula> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            Aula a = new Aula();
            a.secao = o.optString("secao", "Aulas");
            a.titulo = o.optString("titulo", "Aula");
            a.curso = o.optString("curso", "");
            a.url = o.getString("url");
            a.versao = o.optString("versao", "");
            a.slides = o.optInt("slides", 0);
            if (allowed(a.fullUrl())) out.add(a);
        }
        return out;
    }

    private static final Pattern BLOCO = Pattern.compile(
            "<h2>(.*?)</h2>|<a class=\"card\" href=\"([^\"]+)\">(.*?)</a>", Pattern.DOTALL);
    private static final Pattern H3 = Pattern.compile("<h3>(.*?)</h3>", Pattern.DOTALL);
    private static final Pattern SUB = Pattern.compile("<p class=\"sub\">(.*?)</p>", Pattern.DOTALL);
    private static final Pattern INFO = Pattern.compile("<p class=\"info\">\\s*(\\d+) slides", Pattern.DOTALL);

    /** Reserva: lê os cartões da página inicial (mesmo formato gerado pelo gerar_index.py). */
    static List<Aula> parseIndex(String html) {
        List<Aula> out = new ArrayList<>();
        String secao = "Aulas";
        Matcher m = BLOCO.matcher(html);
        while (m.find()) {
            if (m.group(1) != null) { secao = text(m.group(1)); continue; }
            String inner = m.group(3);
            Aula a = new Aula();
            a.secao = secao;
            a.url = m.group(2);
            Matcher t = H3.matcher(inner);
            a.titulo = t.find() ? text(t.group(1)) : a.url;
            Matcher sb = SUB.matcher(inner);
            a.curso = sb.find() ? text(sb.group(1)) : "";
            Matcher in = INFO.matcher(inner);
            a.slides = in.find() ? Integer.parseInt(in.group(1)) : 0;
            a.versao = "";
            if (allowed(a.fullUrl())) out.add(a);
        }
        return out;
    }

    private static String text(String h) {
        return h.replaceAll("<[^>]+>", "").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#x27;", "'").replace("&#39;", "'").trim();
    }

    /** O app só abre páginas do seu site de slides. */
    static boolean allowed(String url) {
        return url != null && url.startsWith(BASE) && !url.contains("..");
    }

    // ------------------------------------------------------------------ cópia guardada

    static void save(Context ctx, List<Aula> l) {
        try {
            JSONArray arr = new JSONArray();
            for (Aula a : l) {
                JSONObject o = new JSONObject();
                o.put("secao", a.secao); o.put("titulo", a.titulo); o.put("curso", a.curso);
                o.put("url", a.url); o.put("versao", a.versao); o.put("slides", a.slides);
                arr.put(o);
            }
            JSONObject root = new JSONObject();
            root.put("aulas", arr);
            root.put("salvo_em", System.currentTimeMillis());
            try (FileOutputStream f = new FileOutputStream(new File(ctx.getFilesDir(), "catalogo.json"))) {
                f.write(root.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) { }
    }

    /** {lista, quando foi salva} ou null. */
    static Object[] load(Context ctx) {
        File file = new File(ctx.getFilesDir(), "catalogo.json");
        if (!file.exists()) return null;
        try (FileInputStream f = new FileInputStream(file)) {
            byte[] b = new byte[(int) file.length()];
            int off = 0, n;
            while (off < b.length && (n = f.read(b, off, b.length - off)) > 0) off += n;
            String s = new String(b, StandardCharsets.UTF_8);
            return new Object[]{parseJson(s), new JSONObject(s).optLong("salvo_em", 0)};
        } catch (Exception e) {
            return null;
        }
    }
}
