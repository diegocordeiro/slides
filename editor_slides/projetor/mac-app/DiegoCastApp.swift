// Diego Cast para Mac – app da barra de menus.
// Por dentro executa o projetar.sh / instalar-cast.sh (que vão dentro do app) e mostra o estado no menu.

import AppKit
import ServiceManagement

/// Uma aula do site diegocordeiro.github.io/slides (lida do slides.json ou, se ainda não existir, do index.html).
struct Aula { let secao: String; let titulo: String; let url: String; let slides: Int }

let siteSlides = "https://diegocordeiro.github.io/slides/"

func parseAulasJSON(_ d: Data) -> [Aula] {
    guard let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
          let arr = o["aulas"] as? [[String: Any]] else { return [] }
    return arr.compactMap { a in
        guard let t = a["titulo"] as? String, let u = a["url"] as? String else { return nil }
        return Aula(secao: (a["secao"] as? String) ?? "Aulas", titulo: t, url: u, slides: (a["slides"] as? Int) ?? 0)
    }
}

private func htmlText(_ h: String) -> String {
    var t = h.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    for (a, b) in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#x27;", "'"), ("&#39;", "'")] {
        t = t.replacingOccurrences(of: a, with: b)
    }
    return t.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func firstGroup(_ pattern: String, in s: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
          let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
          let r = Range(m.range(at: 1), in: s) else { return nil }
    return String(s[r])
}

func parseAulasIndex(_ html: String) -> [Aula] {
    guard let re = try? NSRegularExpression(pattern: "<h2>(.*?)</h2>|<a class=\"card\" href=\"([^\"]+)\">(.*?)</a>",
                                            options: [.dotMatchesLineSeparators]) else { return [] }
    var out: [Aula] = []
    var secao = "Aulas"
    for m in re.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
        if let r = Range(m.range(at: 1), in: html) { secao = htmlText(String(html[r])); continue }
        guard let ru = Range(m.range(at: 2), in: html), let ri = Range(m.range(at: 3), in: html) else { continue }
        let url = String(html[ru]), inner = String(html[ri])
        if url.contains("..") || url.hasPrefix("http") || url.hasPrefix("/") { continue }
        let titulo = firstGroup("<h3>(.*?)</h3>", in: inner).map(htmlText) ?? url
        let n = firstGroup("<p class=\"info\">\\s*(\\d+) slides", in: inner).flatMap { Int($0) } ?? 0
        out.append(Aula(secao: secao, titulo: titulo, url: url, slides: n))
    }
    return out
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    private var statusItem: NSStatusItem!
    private var proc: Process?
    private var procKind = ""            // "projetar" ou "instalar"
    private var status = "Pronto para projetar"
    private var detail = ""
    private var lastError: String?
    private var userStopped = false
    private var currentMode = 0          // 1 espelhar, 2 estendida
    private var buffer = ""
    private var lastOk: String?
    private var aulas: [Aula] = []
    private var aulasAt: Date?
    private var aulasLoading = false
    private var aulasError: String?
    private var opener: Process?
    private let defaults = UserDefaults.standard
    private let res = Bundle.main.resourcePath!
    private let logURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/DiegoCast.log")

    private var quality: String {
        get { defaults.string(forKey: "qualidade") ?? "normal" }
        set { defaults.set(newValue, forKey: "qualidade") }
    }
    private var remoteControl: Bool {
        get { defaults.object(forKey: "controle") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "controle") }
    }
    private var manualIP: String {
        get { defaults.string(forKey: "ip") ?? "" }
        set { defaults.set(newValue, forKey: "ip") }
    }
    private var running: Bool { proc?.isRunning ?? false }

    // MARK: ciclo de vida

    func applicationDidFinishLaunching(_ n: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.loadLessons(force: false) }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        updateIcon()
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
    }

    func applicationWillTerminate(_ n: Notification) {
        stopProcess()
    }

    // MARK: ícone e menu

    private func updateIcon() {
        let symbol: String
        if lastError != nil && !running { symbol = "exclamationmark.triangle" }
        else if running && procKind == "projetar" { symbol = "tv.fill" }
        else { symbol = "tv" }
        let img = NSImage(systemSymbolName: symbol, accessibilityDescription: "Diego Cast")
        img?.isTemplate = true
        statusItem.button?.image = img
        statusItem.button?.imagePosition = .imageLeft
        statusItem.button?.title = (running && procKind == "projetar") ? " Ao vivo" : ""
    }

    func menuNeedsUpdate(_ menu: NSMenu) { loadLessons(force: false); rebuild(menu) }

    // MARK: aulas do site

    private func loadLessons(force: Bool) {
        if aulasLoading { return }
        if !force, let t = aulasAt, Date().timeIntervalSince(t) < 600, !aulas.isEmpty { return }
        aulasLoading = true
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 10
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: cfg)
        guard let jsonURL = URL(string: siteSlides + "slides.json"), let indexURL = URL(string: siteSlides) else { aulasLoading = false; return }
        session.dataTask(with: jsonURL) { [weak self] data, resp, _ in
            let ok = ((resp as? HTTPURLResponse)?.statusCode ?? 0) == 200
            if ok, let d = data, !parseAulasJSON(d).isEmpty {
                DispatchQueue.main.async { self?.lessonsLoaded(parseAulasJSON(d), error: nil) }
                return
            }
            // slides.json ainda não publicado: lê os cartões da página principal
            session.dataTask(with: indexURL) { data2, _, err in
                let html = data2.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let list = parseAulasIndex(html)
                let msg = list.isEmpty ? "Sem acesso ao site (\(err?.localizedDescription ?? "lista vazia"))" : nil
                DispatchQueue.main.async { self?.lessonsLoaded(list, error: msg) }
            }.resume()
        }.resume()
    }

    private func lessonsLoaded(_ list: [Aula], error: String?) {
        aulasLoading = false
        if !list.isEmpty { aulas = list; aulasAt = Date() }
        aulasError = error
        if let m = statusItem.menu, m.highlightedItem == nil { rebuild(m) }
    }

    @objc private func reloadLessons() { loadLessons(force: true) }

    @objc private func openSite() {
        if let u = URL(string: siteSlides) { NSWorkspace.shared.open(u) }
    }

    /// Manda a TV abrir a aula pelo canal de controle cifrado. Roda à parte: não interrompe uma projeção.
    @objc private func openLesson(_ it: NSMenuItem) {
        guard let url = it.representedObject as? String,
              let a = aulas.first(where: { $0.url == url }) else { return }
        if let o = opener, o.isRunning { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        var args = [res + "/projetar.sh"]
        if !manualIP.isEmpty { args.append(manualIP) }
        args += ["--abrir", a.url, "--titulo", a.titulo]
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: res)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
        env["TERM"] = "dumb"
        p.environment = env
        p.standardInput = FileHandle.nullDevice
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        let title = a.titulo
        p.terminationHandler = { [weak self] pr in
            let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let code = pr.terminationStatus
            DispatchQueue.main.async { self?.lessonOpened(title: title, code: code, output: out) }
        }
        log("\n=== \(Date()) \(args.joined(separator: " "))\n")
        do { try p.run(); opener = p; if !running { status = "Abrindo \"\(title)\" na TV…" } }
        catch { alert("Diego Cast", "Não consegui iniciar: \(error.localizedDescription)") }
    }

    private func lessonOpened(title: String, code: Int32, output: String) {
        opener = nil
        log(output)
        if code == 0 {
            if !running { status = "Aula na TV: \(title)" }
        } else {
            if !running { status = "Pronto para projetar" }
            let clean = output.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
            let err = clean.components(separatedBy: "\n").last(where: { $0.hasPrefix("✘") })
                .map { String($0.dropFirst()).trimmingCharacters(in: .whitespaces) } ?? "Veja o registro para detalhes."
            alert("Não foi possível abrir a aula na TV",
                  err.replacingOccurrences(of: "./projetar.sh --parear", with: "menu Segurança → Parear com a TV…")
                     .replacingOccurrences(of: "./instalar-cast.sh", with: "menu Instalar/atualizar o app na TV"))
        }
        updateIcon()
    }

    private func add(_ m: NSMenu, _ title: String, _ sel: Selector?, key: String = "",
                     on: Bool = false, enabled: Bool = true, obj: Any? = nil) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        it.target = self
        it.state = on ? .on : .off
        it.isEnabled = enabled && sel != nil
        it.representedObject = obj
        m.addItem(it)
        return it
    }

    private func rebuild(_ m: NSMenu) {
        m.removeAllItems()
        m.autoenablesItems = false

        let head = NSMenuItem(title: "Diego Cast", action: nil, keyEquivalent: "")
        head.attributedTitle = NSAttributedString(string: "Diego Cast",
            attributes: [.font: NSFont.boldSystemFont(ofSize: 13)])
        m.addItem(head)
        let st = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        st.isEnabled = false
        m.addItem(st)
        if !detail.isEmpty {
            let dt = NSMenuItem(title: detail, action: nil, keyEquivalent: "")
            dt.isEnabled = false
            m.addItem(dt)
        }
        if let e = lastError, !running {
            let it = NSMenuItem(title: "⚠︎ " + e, action: nil, keyEquivalent: "")
            it.isEnabled = false
            m.addItem(it)
        }
        m.addItem(.separator())

        if !isPaired() {
            let np = NSMenuItem(title: "⚠︎ Este Mac ainda não está pareado com a TV", action: nil, keyEquivalent: "")
            np.isEnabled = false
            m.addItem(np)
            _ = add(m, "Parear com a TV…", running ? nil : #selector(pair), key: "p", enabled: !running)
            m.addItem(.separator())
        }
        _ = add(m, "Espelhar tela", #selector(mirror), key: "1", on: running && currentMode == 1)
        _ = add(m, "Usar TV como monitor estendido", #selector(extend), key: "2", on: running && currentMode == 2)
        _ = add(m, "Projetar por outra rede Wi‑Fi…", #selector(otherNetwork))
        _ = add(m, "Parar", running ? #selector(stop) : nil, key: ".", enabled: running)
        m.addItem(.separator())
        let aMenu = NSMenu()
        aMenu.autoenablesItems = false
        if aulas.isEmpty {
            let it = NSMenuItem(title: aulasLoading ? "Carregando as aulas do site…" : (aulasError ?? "Nenhuma aula encontrada"),
                                action: nil, keyEquivalent: "")
            it.isEnabled = false
            aMenu.addItem(it)
        } else {
            var lastSec: String? = nil
            for a in aulas {
                if a.secao != lastSec {
                    if lastSec != nil { aMenu.addItem(.separator()) }
                    let h = NSMenuItem(title: a.secao.uppercased(), action: nil, keyEquivalent: "")
                    h.attributedTitle = NSAttributedString(string: a.secao.uppercased(),
                        attributes: [.font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: NSColor.secondaryLabelColor])
                    h.isEnabled = false
                    aMenu.addItem(h)
                    lastSec = a.secao
                }
                let it = add(aMenu, a.titulo + (a.slides > 0 ? "  ·  \(a.slides) slides" : ""),
                             isPaired() ? #selector(openLesson(_:)) : nil, enabled: isPaired(), obj: a.url)
                it.indentationLevel = 1
            }
        }
        aMenu.addItem(.separator())
        _ = add(aMenu, "Atualizar a lista", #selector(reloadLessons))
        _ = add(aMenu, "Abrir o site no navegador", #selector(openSite))
        let aItem = NSMenuItem(title: "Abrir aula na TV", action: nil, keyEquivalent: "")
        aItem.image = NSImage(systemSymbolName: "play.rectangle", accessibilityDescription: nil)
        aItem.submenu = aMenu
        m.addItem(aItem)
        m.addItem(.separator())

        let qMenu = NSMenu()
        let qs: [(String, String)] = [("normal", "Normal · 1080p 60 fps"), ("alta", "Alta · 1080p 60 fps, mais nítida"),
                                      ("slides", "Slides · 1080p 30 fps, economiza rede"), ("leve", "Leve · 720p 30 fps, Wi‑Fi fraco")]
        for (k, t) in qs { _ = add(qMenu, t, #selector(setQuality(_:)), on: quality == k, obj: k) }
        let q = NSMenuItem(title: "Qualidade", action: nil, keyEquivalent: "")
        q.submenu = qMenu
        m.addItem(q)
        _ = add(m, "Passar slides pelo controle do Fire TV", #selector(toggleControl), on: remoteControl)
        _ = add(m, manualIP.isEmpty ? "TV: encontrar automaticamente…" : "TV: \(manualIP)…", #selector(setIP))
        m.addItem(.separator())

        let sec = NSMenu()
        _ = add(sec, isPaired() ? "Parear de novo com a TV…" : "Parear com a TV…", running ? nil : #selector(pair), enabled: !running)
        _ = add(sec, "Esquecer o pareamento deste Mac", (running || !isPaired()) ? nil : #selector(forgetPairing), enabled: !running && isPaired())
        _ = add(sec, "Desligar a depuração ADB da TV", running ? nil : #selector(disableADB), enabled: !running)
        sec.addItem(.separator())
        let info = NSMenuItem(title: "Vídeo e controle cifrados (AES‑256‑GCM)", action: nil, keyEquivalent: "")
        info.isEnabled = false
        sec.addItem(info)
        let secItem = NSMenuItem(title: "Segurança", action: nil, keyEquivalent: "")
        secItem.submenu = sec
        m.addItem(secItem)
        _ = add(m, "Instalar/atualizar o app na TV", running ? nil : #selector(installTV), enabled: !running)
        _ = add(m, "Abrir ao iniciar o Mac", #selector(toggleLogin), on: loginEnabled())
        _ = add(m, "Ajuda", #selector(help))
        _ = add(m, "Ver registro", #selector(openLog))
        m.addItem(.separator())
        _ = add(m, "Sair do Diego Cast", #selector(quit), key: "q")
    }

    // MARK: ações

    @objc private func mirror() { startProjection(mode: 1, extra: []) }
    @objc private func extend() { startProjection(mode: 2, extra: []) }

    @objc private func otherNetwork() {
        let a = NSAlert()
        a.messageText = "Projetar por outra rede Wi‑Fi"
        a.informativeText = "Ex.: o hotspot do celular com os dados móveis desligados (não precisa de internet). "
            + "Conecte o Fire TV nessa mesma rede. Ao parar, o Mac volta para a rede de sempre."
        let name = NSTextField(frame: NSRect(x: 0, y: 30, width: 260, height: 24))
        name.placeholderString = "Nome da rede"
        let pass = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        pass.placeholderString = "Senha"
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 260, height: 54))
        box.addSubview(name); box.addSubview(pass)
        a.accessoryView = box
        a.addButton(withTitle: "Espelhar")
        a.addButton(withTitle: "Monitor estendido")
        a.addButton(withTitle: "Cancelar")
        NSApp.activate(ignoringOtherApps: true)
        a.window.initialFirstResponder = name
        let r = a.runModal()
        let ssid = name.stringValue.trimmingCharacters(in: .whitespaces)
        if ssid.isEmpty || r == .alertThirdButtonReturn { return }
        pendingInput = pass.stringValue + "\n"   // senha pela entrada padrão; depois fica no Chaveiro
        startProjection(mode: r == .alertFirstButtonReturn ? 1 : 2, extra: ["--rede", ssid])
    }

    @objc private func pair() {
        let a = NSAlert()
        a.messageText = "Parear com a TV"
        a.informativeText = "Na TV, abra o Diego Cast e escolha “Parear um Mac”. Digite o código de 20 caracteres que aparece (os traços são opcionais). Ele fica guardado no Chaveiro deste Mac."
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        f.placeholderString = "XXXX-XXXX-XXXX-XXXX-XXXX"
        a.accessoryView = f
        a.addButton(withTitle: "Parear")
        a.addButton(withTitle: "Cancelar")
        NSApp.activate(ignoringOtherApps: true)
        a.window.initialFirstResponder = f
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let code = f.stringValue.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        var args = [res + "/projetar.sh", "--parear"]
        if !manualIP.isEmpty { args.append(manualIP) }
        status = "Pareando com a TV…"
        launch(kind: "parear", args: args, input: code + "\n")   // código pela entrada padrão, nunca na linha de comando
    }

    @objc private func forgetPairing() {
        launch(kind: "esquecer", args: [res + "/projetar.sh", "--esquecer-pareamento"])
    }

    @objc private func disableADB() {
        var args = [res + "/projetar.sh", "--desligar-adb"]
        if !manualIP.isEmpty { args.append(manualIP) }
        status = "Desligando o ADB da TV…"
        launch(kind: "adb", args: args)
    }

    private func isPaired() -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        p.arguments = ["find-generic-password", "-s", "DiegoCast", "-a", "tv"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 } catch { return false }
    }

    @objc private func stop() {
        userStopped = true
        status = "Parando…"
        stopProcess()
    }

    @objc private func setQuality(_ s: NSMenuItem) {
        guard let k = s.representedObject as? String else { return }
        quality = k
        restartIfRunning()
    }

    @objc private func toggleControl() {
        remoteControl.toggle()
        restartIfRunning()
    }

    @objc private func setIP() {
        let a = NSAlert()
        a.messageText = "IP do Fire TV"
        a.informativeText = "Deixe vazio para encontrar a TV automaticamente na rede (recomendado)."
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
        f.stringValue = manualIP
        f.placeholderString = "ex.: 192.168.1.22"
        a.accessoryView = f
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancelar")
        NSApp.activate(ignoringOtherApps: true)
        a.window.initialFirstResponder = f
        if a.runModal() == .alertFirstButtonReturn {
            manualIP = f.stringValue.trimmingCharacters(in: .whitespaces)
        }
    }

    @objc private func installTV() {
        var args = [res + "/instalar-cast.sh"]
        if !manualIP.isEmpty { args.append(manualIP) }
        status = "Instalando o app na TV…"
        launch(kind: "instalar", args: args)
    }

    @objc private func toggleLogin() {
        do {
            if loginEnabled() { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            alert("Não foi possível alterar", error.localizedDescription)
        }
    }

    private func loginEnabled() -> Bool { SMAppService.mainApp.status == .enabled }

    @objc private func help() {
        alert("Como usar o Diego Cast", """
        Primeira vez: no Fire TV, abra o Diego Cast → “Parear um Mac”; aqui, Segurança → Parear com a TV… \
        e digite o código. Vídeo e controle passam a ir cifrados, e o Mac só transmite para a sua TV.

        1. Abra o app Diego Cast no Fire TV (o Mac também tenta abrir sozinho).
        2. Aqui no menu: “Espelhar tela” ou “Usar TV como monitor estendido”.

        Monitor estendido: no Keynote, Ajustes → Apresentação → “Diego Cast (TV)”. \
        No PowerPoint, use o Modo do Apresentador.

        Controle do Fire TV durante a projeção:
        ▶ / OK  próximo slide     ◀  slide anterior
        ▲ ▼  setas     ⏯  espaço     ☰  informações     Voltar  sai

        Sem internet: use “Projetar por outra rede Wi‑Fi…” com o hotspot do celular \
        (dados móveis desligados) e conecte o Fire TV nele.

        Primeira vez: o macOS pede “Gravação de Tela” e “Acessibilidade” para o Diego Cast. \
        Autorize e projete de novo.
        """)
    }

    @objc private func openLog() { NSWorkspace.shared.open(logURL) }

    @objc private func quit() {
        stopProcess()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { NSApp.terminate(nil) }
    }

    // MARK: processo

    private var pendingInput: String?
    private var lastMode = 1
    private var lastExtra: [String] = []

    private func restartIfRunning() {
        guard running, procKind == "projetar" else { return }
        let mode = lastMode, extra = lastExtra
        stopProcess()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startProjection(mode: mode, extra: extra) }
    }

    private func startProjection(mode: Int, extra: [String]) {
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess()
            permissionAlert(firstTime: true)
            return
        }
        if running {
            stopProcess()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startProjection(mode: mode, extra: extra) }
            return
        }
        lastMode = mode; lastExtra = extra
        var args = [res + "/projetar.sh"]
        if !manualIP.isEmpty && extra.isEmpty { args.append(manualIP) }
        args += ["--tela", String(mode), "--qualidade", quality]
        if !remoteControl { args.append("--sem-controle") }
        args += extra
        currentMode = mode
        status = "Preparando…"
        let input = pendingInput
        pendingInput = nil
        launch(kind: "projetar", args: args, input: input)
    }

    private func launch(kind: String, args: [String], input: String? = nil) {
        lastError = nil
        lastOk = nil
        detail = ""
        userStopped = false
        buffer = ""
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: res)
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
        env["TERM"] = "dumb"
        p.environment = env
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        let inPipe = Pipe()
        p.standardInput = input == nil ? FileHandle.nullDevice : inPipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard !d.isEmpty, let s = String(data: d, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.consume(s) }
        }
        p.terminationHandler = { [weak self] pr in
            pipe.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async { self?.finished(pr.terminationStatus, kind: kind) }
        }
        log("\n=== \(Date()) \(args.joined(separator: " "))\n")
        do {
            try p.run()
            proc = p
            procKind = kind
            if let text = input, let d = text.data(using: .utf8) {
                inPipe.fileHandleForWriting.write(d)
                try? inPipe.fileHandleForWriting.close()
            }
        } catch {
            lastError = "Não consegui iniciar: \(error.localizedDescription)"
        }
        updateIcon()
    }

    private func stopProcess() {
        guard let p = proc, p.isRunning else { return }
        p.interrupt()   // Ctrl+C: o script limpa tudo (rede, tela virtual, captura)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { if p.isRunning { p.terminate() } }
    }

    private func finished(_ code: Int32, kind: String) {
        proc = nil
        currentMode = 0
        if kind == "parear" || kind == "esquecer" || kind == "adb" {
            status = code == 0 ? "Pronto para projetar" : "Falha"
            if code == 0 { alert("Diego Cast", lastOk ?? "Concluído.") }
            else { alert("Diego Cast", lastError ?? "Veja o registro para detalhes.") }
            lastError = nil
        } else if kind == "instalar" {
            if code == 0 {
                status = "App instalado na TV"
                alert("Pronto!", "O Diego Cast foi instalado/atualizado no Fire TV.")
            } else {
                status = "Falha ao instalar"
                alert("Não foi possível instalar na TV", lastError ?? "Veja o registro para detalhes.")
            }
        } else if userStopped {
            status = "Projeção encerrada"
            lastError = nil
        } else {
            status = "Projeção interrompida"
            if let e = lastError {
                if e.contains("Gravação de Tela") { lastError = nil; permissionAlert(firstTime: false) }
                else { alert("Diego Cast", e) }
            }
        }
        detail = ""
        updateIcon()
    }

    private func consume(_ chunk: String) {
        log(chunk)
        buffer += chunk
        let clean = buffer.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
        var parts = clean.components(separatedBy: CharacterSet(charactersIn: "\r\n"))
        buffer = parts.popLast() ?? ""   // pedaço incompleto fica para depois
        for raw in parts {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if line.contains(" fps ·") {
                let bits = line.components(separatedBy: "·").map { $0.trimmingCharacters(in: .whitespaces) }
                status = "Ao vivo · " + bits.prefix(2).joined(separator: " · ")
            } else if line.hasPrefix("✘") {
                lastError = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
                    .replacingOccurrences(of: "./projetar.sh --parear", with: "menu Segurança → Parear com a TV…")
            } else if line.hasPrefix("AVISO_ACESSIBILIDADE") {
                detail = "Libere o Diego Cast em Acessibilidade para passar slides pelo controle"
            } else if line.contains("bloqueou a Gravação de Tela") || line.contains("SEM_PERMISSAO") {
                lastError = "Libere o Diego Cast em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela, e projete de novo."
            } else if line.hasPrefix("✔") || line.hasPrefix("→") || line.hasPrefix("!") {
                let text = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("✔") { lastOk = text }
                if line.hasPrefix("✔") && text.hasPrefix("Encontrado") { detail = text }
                else if !text.hasPrefix("Projetando") { status = text }
                else { detail = text }
            } else if line.hasPrefix("CAPTURANDO") || line.hasPrefix("Tela estendida") || line.hasPrefix("Criando a tela") {
                status = line
            }
        }
        if let m = statusItem.menu, m.highlightedItem == nil { rebuild(m) }
        updateIcon()
    }

    /// Cada compilação local muda a assinatura do app; o macOS mantém a autorização antiga "presa".
    /// Redefinir apaga esse registro e faz o macOS perguntar de novo.
    private func permissionAlert(firstTime: Bool) {
        let a = NSAlert()
        a.messageText = firstTime ? "Autorize a Gravação de Tela" : "O macOS bloqueou a Gravação de Tela"
        a.informativeText = firstTime
            ? "Na janela do macOS, escolha Permitir (ou ative o Diego Cast em Ajustes → Privacidade e Segurança → Gravação de Tela). Depois o Diego Cast precisa ser reaberto.\n\nSe o Diego Cast já aparece ativado e mesmo assim não funciona, use Redefinir."
            : "Como o Diego Cast é compilado no seu Mac, cada nova versão precisa ser autorizada de novo e a autorização antiga fica presa (aparece ativada, mas não vale).\n\nClique em Redefinir: o Diego Cast reabre e o macOS pergunta de novo. Escolha Permitir."
        a.addButton(withTitle: "Redefinir e reabrir")
        a.addButton(withTitle: "Abrir Ajustes")
        a.addButton(withTitle: firstTime ? "Já autorizei, reabrir" : "Cancelar")
        NSApp.activate(ignoringOtherApps: true)
        switch a.runModal() {
        case .alertFirstButtonReturn:
            for service in ["ScreenCapture", "Accessibility"] {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
                p.arguments = ["reset", service, Bundle.main.bundleIdentifier ?? "dev.diego.cast.mac"]
                try? p.run(); p.waitUntilExit()
            }
            relaunch()
        case .alertSecondButtonReturn:
            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        default:
            if firstTime { relaunch() }
        }
    }

    private func relaunch() {
        let path = Bundle.main.bundlePath
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", path]
        try? p.run()
        stopProcess()
        NSApp.terminate(nil)
    }

    private func log(_ s: String) {
        guard let d = s.data(using: .utf8), let h = try? FileHandle(forWritingTo: logURL) else { return }
        h.seekToEndOfFile(); h.write(d); try? h.close()
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}

@main
struct DiegoCastMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}
