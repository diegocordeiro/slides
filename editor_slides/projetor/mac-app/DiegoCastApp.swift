// Diego Cast para Mac – app da barra de menus.
// Por dentro executa o projetar.sh / instalar-cast.sh (que vão dentro do app) e mostra o estado no menu.

import AppKit
import ServiceManagement

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

    func menuNeedsUpdate(_ menu: NSMenu) { rebuild(menu) }

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

        _ = add(m, "Espelhar tela", #selector(mirror), key: "1", on: running && currentMode == 1)
        _ = add(m, "Usar TV como monitor estendido", #selector(extend), key: "2", on: running && currentMode == 2)
        _ = add(m, "Projetar por outra rede Wi‑Fi…", #selector(otherNetwork))
        _ = add(m, "Parar", running ? #selector(stop) : nil, key: ".", enabled: running)
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
        startProjection(mode: r == .alertFirstButtonReturn ? 1 : 2, extra: ["--rede", ssid, pass.stringValue])
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

    private var lastMode = 1
    private var lastExtra: [String] = []

    private func restartIfRunning() {
        guard running, procKind == "projetar" else { return }
        let mode = lastMode, extra = lastExtra
        stopProcess()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.startProjection(mode: mode, extra: extra) }
    }

    private func startProjection(mode: Int, extra: [String]) {
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
        launch(kind: "projetar", args: args)
    }

    private func launch(kind: String, args: [String]) {
        lastError = nil
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
        p.standardInput = FileHandle.nullDevice
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
        if kind == "instalar" {
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
            if let e = lastError { alert("Diego Cast", e) }
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
            } else if line.contains("bloqueou a Gravação de Tela") || line.contains("SEM_PERMISSAO") {
                lastError = "Libere o Diego Cast em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela, e projete de novo."
            } else if line.hasPrefix("✔") || line.hasPrefix("→") || line.hasPrefix("!") {
                let text = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
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
